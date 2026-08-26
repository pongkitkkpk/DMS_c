/**
 * `attachmentService.js` is what closed the old system's static-mount leak —
 * any uploaded file was fetchable by URL with no token and no scope check.
 * `resolveWithin`/`extensionOf`/`repairMultipartFilename` are pure enough to
 * test directly against the real module; `add`/`remove` write real bytes to a
 * throwaway temp directory used as `UPLOAD_ROOT` (so the actual traversal
 * guard and the "unlink on failed commit" cleanup run for real) while the
 * database is a fake `conn`, same approach as the other service tests.
 */
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

function makeConn(overrides = {}) {
  const state = {
    attachmentCount: 0,
    nextInsertId: 1,
    inserted: [],
    events: [],
    deleteAffectedRows: 1,
    failInsert: false,
    ...overrides,
  };

  const query = jest.fn(async (sql, params = []) => {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.includes('AS count FROM project_attachment')) return [[{ count: state.attachmentCount }]];
    if (text.startsWith('INSERT INTO project_attachment')) {
      if (state.failInsert) throw new Error('simulated commit failure');
      const insertId = state.nextInsertId++;
      state.inserted.push({ insertId, params });
      return [{ insertId }];
    }
    if (text.startsWith('INSERT INTO project_event')) {
      state.events.push(params);
      return [{ insertId: 1 }];
    }
    if (text.startsWith('DELETE FROM project_attachment')) {
      return [{ affectedRows: state.deleteAffectedRows }];
    }

    throw new Error(`makeConn: unhandled query: ${text}`);
  });

  return { query, state };
}

const tempRoots = [];

/** Fresh module registry per test, `UPLOAD_ROOT` pointed at a throwaway temp directory. */
async function loadAttachmentService(connState = {}) {
  jest.resetModules();
  const uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dms-attachments-'));
  tempRoots.push(uploadRoot);
  process.env.UPLOAD_ROOT = uploadRoot;

  const conn = makeConn(connState);
  jest.doMock('../db/pool', () => ({
    pool: conn,
    transaction: jest.fn((fn) => fn(conn)),
    isTransient: () => false,
  }));

  const attachmentService = require('./attachmentService');
  return { attachmentService, conn, state: conn.state, uploadRoot };
}

afterAll(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const actor = () => ({ person: { id: 1 } });
const project = (overrides = {}) => ({ id: 7, ...overrides });
const file = (overrides = {}) => ({
  originalname: 'report.pdf',
  buffer: Buffer.from('%PDF-1.4 fake'),
  size: 13,
  ...overrides,
});

describe('resolveWithin', () => {
  test('resolves an ordinary relative path under the upload root', async () => {
    const { attachmentService, uploadRoot } = await loadAttachmentService();
    expect(attachmentService.resolveWithin('projects/7/x.pdf')).toBe(
      path.join(uploadRoot, 'projects', '7', 'x.pdf')
    );
  });

  test('refuses a path that climbs out of the upload root', async () => {
    const { attachmentService } = await loadAttachmentService();
    expect(() => attachmentService.resolveWithin('../../etc/passwd')).toThrow();
  });

  test('refuses a sibling directory that merely shares the root’s name as a string prefix', async () => {
    // The bug the code comment names by name: without a trailing separator on
    // the comparison, a root of `/uploads` would let `/uploads-evil` pass a
    // bare `startsWith('/uploads')`. Built from the real temp root's own name
    // so the same shape is exercised whatever that name happens to be.
    const { attachmentService, uploadRoot } = await loadAttachmentService();
    const siblingPath = path.join('..', `${path.basename(uploadRoot)}-evil`, 'x.pdf');
    expect(() => attachmentService.resolveWithin(siblingPath)).toThrow();
  });
});

describe('extensionOf (via add)', () => {
  test('accepts an allow-listed extension, case-insensitively', async () => {
    const { attachmentService } = await loadAttachmentService();
    const result = await attachmentService.add(actor(), project(), file({ originalname: 'Report.PDF' }));
    expect(result.originalName).toBe('Report.PDF');
  });

  test('refuses an extension outside the allow-list, naming it in the message', async () => {
    const { attachmentService } = await loadAttachmentService();
    await expect(
      attachmentService.add(actor(), project(), file({ originalname: 'malware.exe' }))
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('.exe') });
  });

  test('refuses a file with no extension at all', async () => {
    const { attachmentService } = await loadAttachmentService();
    await expect(
      attachmentService.add(actor(), project(), file({ originalname: 'noext' }))
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('repairMultipartFilename', () => {
  test('leaves pure ASCII names untouched', async () => {
    const { attachmentService } = await loadAttachmentService();
    expect(attachmentService.repairMultipartFilename('report-2026.pdf')).toBe('report-2026.pdf');
  });

  test('repairs a UTF-8 filename that busboy mis-read as latin1', async () => {
    const { attachmentService } = await loadAttachmentService();
    const thai = 'เอกสารแนบ.pdf';
    const mangled = Buffer.from(thai, 'utf8').toString('latin1');
    expect(attachmentService.repairMultipartFilename(mangled)).toBe(thai);
  });

  test('leaves genuinely non-UTF-8 bytes as they arrived, rather than mangling them further', async () => {
    const { attachmentService } = await loadAttachmentService();
    const invalid = Buffer.from([0xff, 0xfe, 0x41]).toString('latin1');
    expect(attachmentService.repairMultipartFilename(invalid)).toBe(invalid);
  });
});

describe('add', () => {
  test('refuses when no file was sent', async () => {
    const { attachmentService } = await loadAttachmentService();
    await expect(attachmentService.add(actor(), project(), null)).rejects.toMatchObject({ status: 400 });
  });

  test('refuses once the project already holds the per-project maximum', async () => {
    const { attachmentService } = await loadAttachmentService({ attachmentCount: 50 });
    await expect(attachmentService.add(actor(), project(), file())).rejects.toMatchObject({ status: 400 });
  });

  test('writes the bytes under the upload root and records a matching row and event', async () => {
    const { attachmentService, state, uploadRoot } = await loadAttachmentService();

    const result = await attachmentService.add(actor(), project({ id: 7 }), file());

    expect(state.inserted).toHaveLength(1);
    const [{ params }] = state.inserted;
    const [projectId, originalName, storagePath, byteSize] = params;
    expect(projectId).toBe(7);
    expect(originalName).toBe('report.pdf');
    expect(byteSize).toBe(13);
    expect(storagePath.startsWith('projects/7/')).toBe(true);

    const bytesOnDisk = await fs.readFile(path.join(uploadRoot, storagePath));
    expect(bytesOnDisk.toString()).toBe('%PDF-1.4 fake');
    expect(state.events).toEqual([expect.arrayContaining(['ATTACHMENT_ADDED'])]);
    expect(result.id).toBeDefined();
  });

  test('deletes the written file if the database transaction never commits', async () => {
    // The rule this exercises: the row is written after the bytes, and the
    // bytes are removed if the row fails — a half-succeeded upload should
    // leave neither an orphan file nor a row pointing at nothing.
    const { attachmentService, uploadRoot } = await loadAttachmentService({ failInsert: true });

    await expect(attachmentService.add(actor(), project({ id: 7 }), file())).rejects.toThrow(
      'simulated commit failure'
    );

    const projectDir = path.join(uploadRoot, 'projects', '7');
    const leftovers = await fs.readdir(projectDir).catch(() => []);
    expect(leftovers).toEqual([]);
  });
});

describe('remove', () => {
  test('deletes the row, records the event, and unlinks the file when the delete actually matched a row', async () => {
    const { attachmentService, state, uploadRoot } = await loadAttachmentService();
    const added = await attachmentService.add(actor(), project({ id: 7 }), file());
    const [{ params }] = state.inserted;
    const storagePath = params[2];
    const row = { id: added.id, original_name: 'report.pdf', byte_size: 13, storage_path: storagePath };

    const removed = await attachmentService.remove(actor(), project({ id: 7 }), row);

    expect(removed).toBe(true);
    expect(state.events.some((e) => e.includes('ATTACHMENT_REMOVED'))).toBe(true);
    await expect(fs.access(path.join(uploadRoot, storagePath))).rejects.toThrow();
  });

  test('does nothing when another caller already removed the same row (the delete matched nothing)', async () => {
    const { attachmentService, state } = await loadAttachmentService({ deleteAffectedRows: 0 });
    const row = { id: 99, original_name: 'x.pdf', byte_size: 1, storage_path: 'projects/7/ghost.pdf' };

    const removed = await attachmentService.remove(actor(), project({ id: 7 }), row);

    expect(removed).toBe(false);
    expect(state.events).toEqual([]);
  });
});

describe('read', () => {
  test('returns the stored bytes for a row the caller was already authorized to see', async () => {
    const { attachmentService, state } = await loadAttachmentService();
    await attachmentService.add(actor(), project({ id: 7 }), file());
    const [{ params }] = state.inserted;
    const row = { storage_path: params[2] };

    const bytes = await attachmentService.read(row);

    expect(bytes.toString()).toBe('%PDF-1.4 fake');
  });

  test('answers not-found rather than crashing when the row’s file is missing from disk', async () => {
    const { attachmentService } = await loadAttachmentService();
    const row = { storage_path: 'projects/7/does-not-exist.pdf' };
    await expect(attachmentService.read(row)).rejects.toMatchObject({ status: 404 });
  });
});
