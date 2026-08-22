#!/usr/bin/env node
/**
 * One-off: give กนศ.04's own cover-letter signature lines somewhere to print
 * a real signature (migration 007, owner-confirmed). `npm run forms:read`
 * showed the mismatch that started this: the form's three signature blocks —
 * ประธานชมรม (SH), อาจารย์ที่ปรึกษา (AD), and a blank "ที่ปรึกษาฝ่าย...
 * สำหรับกองกิจการนักศึกษา" line — are not the ADMIN/STUACT roles migration
 * 006 captured a signature from at all.
 *
 * Same discipline as `patch-form-literals.js`: addressed by index and
 * asserted before anything is written, so a template that has moved fails
 * loudly instead of being edited in the wrong place. A paragraph reading
 * exactly "ลงชื่อ" appears **six** times in this document, not three — a
 * second, numbered block appears much later, in an unrelated section, and is
 * deliberately left alone. That is exactly why this walks real `<w:p>`
 * paragraph boundaries and asserts the *plain text* of the three paragraphs
 * following each "ลงชื่อ" (the dotted line, the name/tags, the title) rather
 * than trusting position or a raw byte offset.
 *
 * Technique: clone the dotted-line paragraph's own shape three times —
 * already valid, already carrying this document's formatting, lower-risk than
 * hand-building new OOXML — one holding only `{#hasSignatureX}`, one holding
 * only `{%signatureX}`, one holding only `{/hasSignatureX}`. The image tag
 * **must** be alone in its own paragraph — `docxtemplater-image-module-free`
 * throws `"Raw tag not in paragraph"` at compile time otherwise, found by
 * actually constructing a `Docxtemplater` against a first attempt that
 * combined all three into one run. `paragraphLoop: true` (already set in
 * `render.js`) is what makes three paragraphs act as one section: with no
 * signature yet, docxtemplater drops all three whole paragraphs, and the
 * template's own blank dotted line — a separate, untouched paragraph — is
 * what a reader sees, unchanged from before this patch.
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const TEMPLATE = path.resolve(__dirname, '../../templates/temp04.docx');

/** A top-level `<w:p ...>...</w:p>` block. `<w:pPr>`/`<w:pStyle>` never match
 *  `<w:p( |>)` — the character right after "w:p" must be a space or ">". */
const PARAGRAPH = /<w:p( [^>]*)?>[\s\S]*?<\/w:p>/g;

const plainText = (p) => p.replace(/<[^>]+>/g, '');

/** Cloned from the real dotted-line paragraph immediately after each "ลงชื่อ", holding one raw text value. */
const paragraphWith = (text) =>
  '<w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="TH Sarabun New" w:hAnsi="TH Sarabun New" w:cs="TH Sarabun New"/>' +
  '<w:color w:val="000000"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="TH Sarabun New" ' +
  'w:hAnsi="TH Sarabun New" w:cs="TH Sarabun New"/><w:color w:val="000000"/><w:sz w:val="32"/><w:szCs w:val="32"/><w:cs/></w:rPr>' +
  `<w:t>${text}</w:t></w:r></w:p>`;

/** Three paragraphs: the section open, the image alone, the section close — see the header comment for why the image cannot share a paragraph with the others. */
const paragraphsFor = (tag) => [
  paragraphWith(`{#hasSignature${tag}}`),
  paragraphWith(`{%signature${tag}}`),
  paragraphWith(`{/hasSignature${tag}}`),
].join('');

/** Which of the six "ลงชื่อ" paragraphs is which, and what must follow it — asserted before anything is touched. */
const PLAN = [
  { hitIndex: 0, tag: 'Sh', afterDots: '({#userSH}{prefix}{name_student}{/userSH})' },
  { hitIndex: 1, tag: 'Advisor', afterDots: '({#user}{prefix}{/user}{#detail}{advisor_name}{/detail})' },
  { hitIndex: 2, tag: 'Stuact', afterDots: '(.................................................)' },
];

const zip = new PizZip(fs.readFileSync(TEMPLATE));
const xml = zip.file('word/document.xml').asText();

if (xml.includes('{%signatureSh}')) {
  console.log('temp04.docx: already patched, nothing to do');
  process.exit(0);
}

const paragraphs = [...xml.matchAll(PARAGRAPH)];
const signHits = [];
paragraphs.forEach((m, i) => { if (plainText(m[0]) === 'ลงชื่อ') signHits.push(i); });

if (signHits.length !== 6) {
  console.error(`temp04.docx: expected 6 "ลงชื่อ" paragraphs, found ${signHits.length} — template has moved, stopping`);
  process.exit(1);
}

let failed = false;
for (const { hitIndex, afterDots } of PLAN) {
  const para = signHits[hitIndex];
  const found = plainText(paragraphs[para + 2][0]);   // +1 = dots, +2 = "(name/tags)"
  if (found !== afterDots) {
    console.error(`temp04.docx: "ลงชื่อ" #${hitIndex} — expected the paragraph two below it to read:\n  ${afterDots}\nfound:\n  ${found}`);
    failed = true;
  }
}
if (failed) process.exit(1);

// Insert right after each "ลงชื่อ" paragraph's own </w:p>, back to front so
// earlier match offsets stay valid as the string grows.
let out = xml;
for (const { hitIndex, tag } of [...PLAN].reverse()) {
  const match = paragraphs[signHits[hitIndex]];
  const insertAt = match.index + match[0].length;
  out = out.slice(0, insertAt) + paragraphsFor(tag) + out.slice(insertAt);
}

zip.file('word/document.xml', out);
// DEFLATE explicitly: pizzip stores uncompressed by default, which turned a
// 165 KB government template into a multi-MB one — same content, absurd artefact.
fs.writeFileSync(TEMPLATE, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`temp04.docx: inserted ${PLAN.length} signature-image paragraph(s)`);
