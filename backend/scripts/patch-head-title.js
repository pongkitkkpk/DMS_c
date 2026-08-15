#!/usr/bin/env node
/**
 * One-off: replace the baked-in signatory title in both government forms with a
 * `{clubHeadTitle}` tag, so the system can print the right one.
 *
 * **Why the templates had to be edited.** The title was literal text in the
 * document — กนศ.04 said `ประธานชมรม`, and กนศ.06 said `นายก / ประธาน` in one
 * signature block and `นายก / ประธานชมรม` in another — followed by the
 * organisation's own name. Since every name already carries its kind (ชมรม…,
 * สภานักศึกษา…, สโมสร…, องค์การนักศึกษา…), that produced `ประธานชมรมชมรมกรีฑา` for
 * the 47 clubs and called the other 22 organisations ชมรม when they are not. No
 * change on the data side could fix it: the wrong word was in the form, not in
 * the value.
 *
 * The rule, from the owner (2026-08-16): องค์การนักศึกษา and สโมสร take **นายก**;
 * everything else takes **ประธาน**. The organisation's name supplies the rest.
 * `assembler.js` computes it as `clubHeadTitle`.
 *
 * **Runs are addressed by index, not by searching for their text.** The first
 * attempt replaced "the first run reading `/`" and blanked a slash somewhere
 * else entirely in a 2,000-run document. Indices are read back and asserted
 * before anything is written, so a template that has moved on fails loudly
 * instead of being edited in the wrong place.
 *
 * Kept in the repository rather than run and deleted: it is the only readable
 * record of what changed inside two binary files that git can only report as
 * "modified", and it is idempotent.
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const TAG = '{clubHeadTitle}';
const TEMPLATES = path.resolve(__dirname, '../../templates');

/**
 * Each entry: the run index, the text that run must currently hold (asserted),
 * and what it becomes. The title run takes the tag; the slash and the second
 * word are emptied.
 */
const PLAN = {
  // Two signature blocks each, written inconsistently even within one file.
  // Found by listing every run containing นายก or ประธาน and keeping the ones
  // followed by `{#userSH}{clubName}` — the first attempt patched only the
  // block that happened to be searched for, and a third block went on printing
  // "นายก/ประธานชมรมพุทธศาสน์" until a rendered form was read again.
  'temp04.docx': [
    [73, 'ประธานชมรม', TAG],
    [8991, 'นายก', TAG], [8992, '/', ''], [8993, 'ประธาน', ''],
  ],
  'temp06.docx': [
    [91, 'นายก', TAG], [92, '/', ''], [93, 'ประธาน', ''],
    [2211, 'นายก', TAG], [2212, '/', ''], [2213, 'ประธานชมรม', ''],
  ],
};

/**
 * Left alone on purpose: temp04 runs 113, 116 and 123 read "เรียน
 * ประธานสภานักศึกษา", "นายกองค์การนักศึกษา" and "ประธานสภานักศึกษา". Those are
 * the approval chain naming real university office-holders, not this project's
 * signatory, and they are correct as they stand. The signatory blocks are the
 * ones followed by `{#userSH}` — that is the test, not the wording.
 */

const RUN = /<w:t[^>]*>([^<]*)<\/w:t>/g;

function runsOf(xml) {
  return [...xml.matchAll(RUN)];
}

let failed = false;

for (const [file, plan] of Object.entries(PLAN)) {
  const full = path.join(TEMPLATES, file);
  const zip = new PizZip(fs.readFileSync(full));
  const xml = zip.file('word/document.xml').asText();

  if (xml.includes(TAG)) {
    console.log(`${file}: already patched, nothing to do`);
    continue;
  }

  const runs = runsOf(xml);
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
