#!/usr/bin/env node
/**
 * Render a project's government forms and print them as text.
 *
 *   npm run forms:read -- --project 9 --as fixture.student
 *
 * The forms are what this system exists to produce, and until this existed
 * nothing could look at one without opening Word. That gap is not theoretical:
 * the roles screen shipped appointing advisers without the agency กนศ.04 prints,
 * and 397 passing checks said nothing, because every check asserted the API and
 * the screens and none of them read the document (2026-08-16).
 *
 * Crude on purpose. It strips the XML rather than laying the page out, so word
 * breaks appear where Word splits a run mid-word — "นั กศึกษา" is the template's
 * own run boundary, not a defect. What it is good for is checking that a field
 * arrived at all, and what the sentence around it reads like.
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const B = process.env.API_BASE || 'http://localhost:3001';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=');
    if (!flag.startsWith('--')) continue;
    args[flag.slice(2)] = inline !== undefined ? inline : argv[++i];
  }
  return args;
}

/** Text runs in document order, one line per paragraph. */
function linesOf(buffer) {
  const xml = new PizZip(buffer).file('word/document.xml').asText();
  return xml
    .replace(/<w:p[ >]/g, '\n<w:p ')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = Number(args.project);
  const username = args.as || 'fixture.student';
  const outDir = args.out || null;

  if (!Number.isInteger(projectId)) {
    console.error('usage: npm run forms:read -- --project <id> [--as <username>] [--out <dir>]');
    process.exit(2);
  }

  const auth = await fetch(`${B}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'dev' }),
  });
  if (!auth.ok) { console.error(`login ${username} -> ${auth.status}`); process.exit(1); }
  const { token } = await auth.json();
  const headers = { Authorization: `Bearer ${token}` };

  const listed = await fetch(`${B}/api/projects/${projectId}/documents`, { headers });
  if (!listed.ok) { console.error(`documents -> ${listed.status}`); process.exit(1); }
  const { documents } = await listed.json();

  for (const doc of documents) {
    if (!doc.available) {
      console.log(`\n===== ${doc.form} — not available =====\n  ${doc.reason}`);
      continue;
    }
    const res = await fetch(`${B}/api/projects/${projectId}/documents/${doc.form}`, { headers });
    const buffer = Buffer.from(await res.arrayBuffer());
    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, `${doc.form}.docx`), buffer);
    }
    const lines = linesOf(buffer);
    console.log(`\n===== ${doc.form} — ${buffer.length} bytes, ${lines.length} paragraphs =====`);
    for (const line of lines) console.log('  ', line);
  }
}

main().catch((err) => { console.error('\nforms:read failed:', err.message); process.exit(1); });
