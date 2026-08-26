/**
 * `signatureService.js`'s image validation is the one place client-supplied
 * bytes are trusted enough to serve back inline — its own header names three
 * things a bare magic-number check would miss: a declared PNG size with no
 * data behind it (decompression-bomb shape), a missing/wrong `IEND`, and
 * bytes appended after a valid `IEND` (a polyglot file). These tests build
 * crafted PNG byte streams by hand — no CRC needed, since `readChunks` never
 * verifies one — to exercise each guard directly. `stage`/`discard` and
 * `endorseAsAdvisor`'s one-time guard are exercised against a real temp
 * directory (same approach as `attachmentService.test.js`) plus a fake `conn`
 * for the database half.
 */
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]); // CRC unchecked, zeros are fine
}

function ihdrData(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8; // bit depth
  data[9] = 0; // colour type
  return data;
}

/** A crafted, minimal PNG byte stream — real enough for `readChunks` to walk. */
function buildPng({ width = 1, height = 1, includeIend = true, trailing = null, ihdr = true } = {}) {
  const parts = [PNG_MAGIC];
  if (ihdr) parts.push(pngChunk('IHDR', ihdrData(width, height)));
  if (includeIend) parts.push(pngChunk('IEND', Buffer.alloc(0)));
  let bytes = Buffer.concat(parts);
  if (trailing) bytes = Buffer.concat([bytes, trailing]);
  return bytes;
}

const dataUrlOf = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
const TINY_PNG = buildPng();

function makeConn(overrides = {}) {
  const state = {
    signatureRow: null,   // hasSignature's lookup
    nextEventId: 1,
    events: [],
    signatures: [],
    ...overrides,
  };
  const query = jest.fn(async (sql, params = []) => {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.startsWith('SELECT id FROM project WHERE id = ? FOR UPDATE')) return [[{ id: params[0] }]];
    if (text.includes('AS present')) return [state.signatureRow ? [{ present: 1 }] : []];
    if (text.startsWith('INSERT INTO project_event')) {
      const id = state.nextEventId++;
      state.events.push({ id, type: params[1] });
      return [{ insertId: id }];
    }
    if (text.startsWith('INSERT INTO project_signature')) {
      state.signatures.push(params);
      return [{ affectedRows: 1 }];
    }
    if (text.includes('pt.requires_signature')) return [state.requiresSignatureRows || []];

    throw new Error(`makeConn: unhandled query: ${text}`);
  });
  return { query, state };
}

const tempRoots = [];

async function loadSignatureService(connState = {}) {
  jest.resetModules();
  const uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dms-signatures-'));
  tempRoots.push(uploadRoot);
  process.env.UPLOAD_ROOT = uploadRoot;

  const conn = makeConn(connState);
  jest.doMock('../db/pool', () => ({
    pool: conn,
    transaction: jest.fn((fn) => fn(conn)),
    isTransient: () => false,
  }));

  const signatureService = require('./signatureService');
  return { signatureService, conn, state: conn.state, uploadRoot };
}

afterAll(async () => {
  await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('stage — PNG validation (decodeImage/assertWellFormedPng)', () => {
  test('accepts a small, well-formed PNG', async () => {
    const { signatureService } = await loadSignatureService();
    const staged = await signatureService.stage(1, dataUrlOf(TINY_PNG));
    expect(staged.byteSize).toBe(TINY_PNG.length);
  });

  test('refuses anything without the data-URL prefix', async () => {
    const { signatureService } = await loadSignatureService();
    await expect(signatureService.stage(1, TINY_PNG.toString('base64'))).rejects.toMatchObject({ status: 400 });
  });

  test('refuses an empty drawing', async () => {
    const { signatureService } = await loadSignatureService();
    await expect(signatureService.stage(1, 'data:image/png;base64,')).rejects.toMatchObject({ status: 400 });
  });

  test('refuses bytes that are not a PNG at all', async () => {
    const { signatureService } = await loadSignatureService();
    const notPng = Buffer.from('this is not a png');
    await expect(signatureService.stage(1, dataUrlOf(notPng))).rejects.toMatchObject({ status: 400 });
  });

  test('refuses a file over the size cap, before ever parsing its structure', async () => {
    const { signatureService } = await loadSignatureService();
    const oversized = Buffer.concat([TINY_PNG, Buffer.alloc(300 * 1024)]);
    await expect(signatureService.stage(1, dataUrlOf(oversized))).rejects.toMatchObject({ status: 400 });
  });

  test('refuses a PNG whose first chunk is not a proper 13-byte IHDR', async () => {
    const { signatureService } = await loadSignatureService();
    const broken = buildPng({ ihdr: false, includeIend: true });
    await expect(signatureService.stage(1, dataUrlOf(broken))).rejects.toMatchObject({ status: 400 });
  });

  test('refuses a declared width/height past the dimension cap — the decompression-bomb shape', async () => {
    // A tiny file that *claims* to be a huge image: the byte-size cap alone
    // does not catch this, because a flat-colour image compresses to almost
    // nothing regardless of its declared dimensions.
    const { signatureService } = await loadSignatureService();
    const bomb = buildPng({ width: 999999, height: 999999 });
    await expect(signatureService.stage(1, dataUrlOf(bomb))).rejects.toMatchObject({ status: 400 });
  });

  test('refuses a declared width or height of zero', async () => {
    const { signatureService } = await loadSignatureService();
    const zeroed = buildPng({ width: 0, height: 1 });
    await expect(signatureService.stage(1, dataUrlOf(zeroed))).rejects.toMatchObject({ status: 400 });
  });

  test('refuses a PNG with no IEND terminator', async () => {
    const { signatureService } = await loadSignatureService();
    const noEnd = buildPng({ includeIend: false });
    await expect(signatureService.stage(1, dataUrlOf(noEnd))).rejects.toMatchObject({ status: 400 });
  });

  test('refuses extra bytes appended after a valid IEND — the polyglot-file shape', async () => {
    const { signatureService } = await loadSignatureService();
    const polyglot = buildPng({ trailing: Buffer.from('<script>alert(1)</script>') });
    await expect(signatureService.stage(1, dataUrlOf(polyglot))).rejects.toMatchObject({ status: 400 });
  });
});

describe('stage / discard — real files on disk', () => {
  test('writes the image under UPLOAD_ROOT/signatures/<projectId>/, and discard removes it', async () => {
    const { signatureService, uploadRoot } = await loadSignatureService();

    const staged = await signatureService.stage(42, dataUrlOf(TINY_PNG));
    expect(staged.relativePath.startsWith('signatures/42/')).toBe(true);
    await expect(fs.access(path.join(uploadRoot, staged.relativePath))).resolves.toBeUndefined();

    await signatureService.discard(staged);
    await expect(fs.access(path.join(uploadRoot, staged.relativePath))).rejects.toThrow();
  });

  test('discard is a no-op for a falsy staged value, rather than throwing', async () => {
    const { signatureService } = await loadSignatureService();
    await expect(signatureService.discard(null)).resolves.toBeUndefined();
  });
});

describe('endorseAsAdvisor — the one-time guard', () => {
  const actor = () => ({ person: { id: 7 } });
  const project = () => ({ id: 1 });

  test('records the endorsement and the signature together when none exists yet', async () => {
    const { signatureService, state } = await loadSignatureService({ signatureRow: null });

    const result = await signatureService.endorseAsAdvisor(actor(), project(), { signatureImage: dataUrlOf(TINY_PNG) });

    expect(result.endorsed).toBe(true);
    expect(state.events.map((e) => e.type)).toContain('ADVISOR_ENDORSED');
    expect(state.signatures).toHaveLength(1);
  });

  test('refuses a second endorsement, and discards the newly staged image', async () => {
    const { signatureService, uploadRoot } = await loadSignatureService({ signatureRow: { present: 1 } });

    await expect(
      signatureService.endorseAsAdvisor(actor(), project(), { signatureImage: dataUrlOf(TINY_PNG) })
    ).rejects.toMatchObject({ status: 409 });

    // The image was written before the conflict was discovered inside the
    // transaction; nothing should be left behind under signatures/1/.
    const leftovers = await fs.readdir(path.join(uploadRoot, 'signatures', '1')).catch(() => []);
    expect(leftovers).toEqual([]);
  });
});
