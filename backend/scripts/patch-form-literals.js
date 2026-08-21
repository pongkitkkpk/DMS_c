#!/usr/bin/env node
/**
 * One-off: fix two more literal words baked into the government form
 * templates, found while reading a fully-filled form ("Two more literals in
 * the forms, for the owner — same shape as ประธานชมรม", strategy log
 * 2026-08-17) and confirmed by the owner on 2026-08-21. Same shape as
 * `patch-head-title.js` — the wrong word is in the template, not in any value
 * the assembler supplies, so no data-side change could reach either one.
 *
 * 1. **กนศ.04 §19 doubled "บาทถ้วน".** `{thailistSAll}` (the Thai spelled-out
 *    amount, `bahtText` in `src/lib/thai.js`) already ends its own output in
 *    "…บาทถ้วน" — that word means "exactly". The cover letter wraps the tag in
 *    a bare `(…)` and reads correctly; §19 wraps it in `(… บาทถ้วน)`, a second,
 *    literal "บาทถ้วน" typed straight into the template, so every amount
 *    printed there doubles the word. Fix: drop the template's own "บาทถ้วน",
 *    leaving the tag's own output as the only one.
 *
 * 2. **กนศ.06 §10 row 4 mislabelled.** The attendee table's fourth row reads
 *    "- นักศึกษาเข้าร่วมโครงการ" — the same literal as row 3 — but its tags are
 *    `grandTotalExpert`/`Fperson`/`persen` for that field, i.e. the
 *    ผู้ทรงคุณวุฒิ/วิทยากร headcount. So a project's guest-speaker count prints
 *    under the students' own label, once per document, while the row above it
 *    (grandTotalStudent) already carries that label correctly. Fix: relabel
 *    row 4 to match what it actually counts.
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const TEMPLATES = path.resolve(__dirname, '../../templates');

/** Each entry: run index, the text it must currently hold (asserted), and
 * what it becomes. Same discipline as `patch-head-title.js`: addressed by
 * index and asserted before anything is written, so a template that has
 * moved on fails loudly instead of being edited in the wrong place. */
const PLAN = {
  'temp04.docx': [
    [7670, ' บาทถ้วน)', ')'],
  ],
  'temp06.docx': [
    [1884, '- นักศึกษาเข้าร่วมโครงการ', '- ผู้ทรงคุณวุฒิ / วิทยากร'],
  ],
};

const RUN = /<w:t[^>]*>([^<]*)<\/w:t>/g;

function runsOf(xml) {
  return [...xml.matchAll(RUN)];
}

let failed = false;

for (const [file, plan] of Object.entries(PLAN)) {
  const full = path.join(TEMPLATES, file);
  const zip = new PizZip(fs.readFileSync(full));
  const xml = zip.file('word/document.xml').asText();

  const runs = runsOf(xml);
  const already = plan.every(([i, , next]) => runs[i] && runs[i][1] === next);
  if (already) {
    console.log(`${file}: already patched, nothing to do`);
    continue;
  }

  const wrong = plan.filter(([i, expected]) => !runs[i] || runs[i][1] !== expected);
  if (wrong.length) {
    console.error(`${file}: the template has moved — these runs are not what this patch expects:`);
    for (const [i, expected] of wrong) {
      console.error(`  run[${i}] expected ${JSON.stringify(expected)}, found ${JSON.stringify(runs[i] && runs[i][1])}`);
    }
    failed = true;
    continue;
  }

  // Rebuilt back to front so earlier offsets stay valid.
  let out = xml;
  for (const [i, , next] of [...plan].reverse()) {
    const m = runs[i];
    const open = m[0].slice(0, m[0].indexOf('>') + 1);
    out = out.slice(0, m.index) + open + next + '</w:t>' + out.slice(m.index + m[0].length);
  }

  zip.file('word/document.xml', out);
  // DEFLATE explicitly: pizzip stores uncompressed by default, which turned a
  // 165 KB government template into a 4 MB one — same content, absurd artefact.
  fs.writeFileSync(full, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log(`${file}: ${plan.length} run(s) rewritten`);
}

process.exit(failed ? 1 : 0);
