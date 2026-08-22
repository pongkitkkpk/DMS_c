/**
 * Turning a payload and a template into a `.docx`.
 *
 * The engine setup is not a choice: `docxtemplater` with its `expressions.js`
 * parser (angular-expressions) is **mandatory**, because temp04 contains 630
 * expression tags — the whole Gantt — that the default parser cannot evaluate.
 * Without it the render does not degrade, it throws. `paragraphLoop` and
 * `linebreaks` are equally load-bearing; the forms rely on both.
 *
 * Templates are read once and cached. They are fixed inputs (`templates/README.md`
 * — "do not edit"), so re-reading 165 KB per download would buy nothing.
 */
const fs = require('fs');
const path = require('path');
const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
const expressionParser = require('docxtemplater/expressions.js');
const ImageModule = require('docxtemplater-image-module-free');

const { HttpError } = require('../lib/httpError');
const { assertPrintable } = require('./arity');
const { build } = require('./assembler');

/**
 * A fresh `ImageModule` per render, bound to one `document` — docxtemplater
 * refuses to attach one module instance to a second document ("cannot attach
 * a module that was already attached"), verified against `check-phase4.js`,
 * which renders many documents in one process.
 *
 * Embeds กนศ.04's three signature images (migration 007). The payload's
 * `signatureX` value is a plain string key ('sh'/'advisor'/'stuact'), never
 * the image buffer directly: `docxtemplater-image-module-free` branches on
 * `typeof tagValue`, and a `Buffer` is `typeof 'object'`, which the module
 * misreads as its own internal "already resolved" shape (`{rId, sizePixel}`)
 * instead of a value to hand to `getImage` — found by rendering a project
 * with a real signature and reading the module's own source at the line that
 * threw. `getImage` here is what turns the key back into the bytes
 * `loadDocument` already fetched once. A falsy tag value (no signature yet)
 * never reaches `getImage` at all — the template wraps every `{%signatureX}`
 * in `{#hasSignatureX}...{/hasSignatureX}`, each its own paragraph (see
 * `scripts/patch-signature-images.js`), and docxtemplater drops a falsy
 * section before its module runs, leaving the template's own blank dotted
 * line as the fallback.
 *
 * The fixed 150x60px size is a print size, not a measurement of what was
 * drawn: `SignaturePad.js`'s canvas is a fixed 380x160, and stretching every
 * signature to one box is what keeps the cover letter's layout stable
 * regardless of how large or small a signature was drawn.
 */
function newImageModule(document) {
  const bytesFor = { sh: document.signatures.sh, advisor: document.signatures.advisor, stuact: document.signatures.stuact };
  return new ImageModule({
    fileType: 'docx',
    getImage: (key) => bytesFor[key],
    getSize: () => [150, 60],
  });
}

const TEMPLATES_DIR = path.resolve(__dirname, '../../../templates');

const FORMS = {
  temp04: { file: 'temp04.docx', code: 'กนศ.04', title: 'แบบเสนอโครงการ' },
  temp06: { file: 'temp06.docx', code: 'กนศ.06', title: 'แบบสรุปผลโครงการ' },
};

const cache = new Map();

function templateBytes(form) {
  if (!cache.has(form)) {
    const file = path.join(TEMPLATES_DIR, FORMS[form].file);
    if (!fs.existsSync(file)) {
      throw new Error(`template ${FORMS[form].file} is missing from templates/`);
    }
    cache.set(form, fs.readFileSync(file));
  }
  return cache.get(form);
}

/**
 * An unresolved tag is a blank on a government form, so it is not left to
 * chance: `nullGetter` returns the empty string for a plain field and `false`
 * for a section, which is what makes an absent value print as nothing rather
 * than as the literal text `undefined`.
 *
 * The old render passed the database rows straight through, so a column that
 * was `NULL` printed as `null` — and several did.
 */
function nullGetter(part) {
  if (!part.module) return '';
  if (part.module === 'rawxml') return '';
  return false;
}

/**
 * Render one form for one loaded project document.
 *
 * Arity is checked **before** the render, not after: docxtemplater would
 * happily produce a file with eight budget lines missing and no complaint, and
 * that file is the thing somebody signs.
 *
 * @returns {{buffer: Buffer, filename: string, form: object}}
 */
function render(form, document) {
  const spec = FORMS[form];
  if (!spec) throw HttpError.notFound(`ไม่รู้จักแบบฟอร์ม ${form}`);

  assertPrintable(form, document);

  const zip = new PizZip(templateBytes(form));
  const doc = new Docxtemplater(zip, {
    parser: expressionParser,
    paragraphLoop: true,
    linebreaks: true,
    nullGetter,
    modules: [newImageModule(document)],
  });

  try {
    doc.render(build(form, document));
  } catch (err) {
    // docxtemplater collects every template error into `properties.errors`.
    // Reporting only `err.message` gives "Multi error" and nothing else, which
    // is useless against a 1,426-tag template.
    const detail = (err.properties && err.properties.errors || [])
      .map((e) => `${e.properties && e.properties.id}: ${e.properties && e.properties.explanation}`)
      .join('; ');
    throw new Error(`${spec.code} render failed: ${err.message}${detail ? ` — ${detail}` : ''}`);
  }

  const buffer = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  const project = document.project;
  const stem = project.project_number || `ร่างที่${project.draft_sequence}`;

  return { buffer, filename: `${spec.code}-${stem}.docx`, form: spec };
}

module.exports = { render, FORMS };
