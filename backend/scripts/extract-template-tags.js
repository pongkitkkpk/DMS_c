#!/usr/bin/env node
/**
 * Extract every tag the two government forms demand.
 *
 *   npm run templates:tags          # print the summary
 *   npm run templates:tags -- --json  # rewrite docs/template-tags.json
 *
 * `docs/template-contract.md` establishes the shape, the arities and the
 * semantics of these forms, and closes by naming what it did not do: "the full
 * 433-field mapping table is not yet written… and is the input to the
 * assembler's implementation". This is that extraction, mechanised — the
 * assembler is built against its output and `check-phase4.js` asserts against
 * it, so the contract is checked rather than remembered.
 *
 * The one thing that makes this non-trivial: **Word splits a tag across runs.**
 * `{listSAll}` is routinely stored as `<w:t>{listS</w:t>…<w:t>All}</w:t>`
 * because a spell-check mark or a formatting change fell in the middle of it.
 * Matching `\{[^}]*\}` per `<w:t>` therefore finds a fraction of the tags and
 * misses exactly the long ones that matter. Runs are concatenated in document
 * order first, and only then matched — which is how the counts here reproduce
 * the ones in `templates/README.md`.
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const TEMPLATES_DIR = path.resolve(__dirname, '../../templates');
const OUTPUT = path.resolve(__dirname, '../../docs/template-tags.json');

/** Every part of the package that can carry a tag, not just the body. */
const TEXT_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

/**
 * The document's text with the run boundaries removed.
 *
 * `<w:tab/>` and `<w:br/>` become nothing rather than whitespace: a tag is
 * never split across a tab, and inserting one would break a name.
 */
function flatten(xml) {
  const parts = [];
  const runs = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let match;
  while ((match = runs.exec(xml)) !== null) parts.push(match[1]);
  return parts
    .join('')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Classify one tag body.
 *
 * `{ grandTypeETC }` is written with inner spaces in temp06 — defect 3 in the
 * contract. docxtemplater trims, so the payload key is the trimmed name, and
 * anything here that matched on the raw body would look for a field nobody
 * supplies. Every name is trimmed before it is classified.
 */
function classify(raw) {
  const body = raw.trim();
  if (!body) return null;

  const kind =
    body[0] === '#' ? 'section' :
    body[0] === '/' ? 'close' :
    body[0] === '^' ? 'inverted' :
    body[0] === '>' ? 'partial' :
    'field';

  const name = kind === 'field' ? body : body.slice(1).trim();
  // Anything that is not a bare identifier is evaluated by angular-expressions
  // rather than looked up — the Gantt's 630 comparison tags are all of this
  // shape, and none of them is a payload key.
  const isExpression = !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);

  return { kind, name, isExpression, raw: body };
}

/**
 * The payload roots, from the two `doc.render(...)` calls in the old
 * `studentRoutes.js` (:1179 and :1361) and confirmed by the section list.
 * Every other `{#…}` is either a row-present guard or a checkbox.
 */
const ROOTS = ['detail', 'person', 'Fperson', 'persen', 'timestep', 'indicator',
  'budget', 'Fbudget', 'user', 'userSH'];

/**
 * Which root each field is read from.
 *
 * This is the half of the contract `docs/template-contract.md` closes by saying
 * it did not write. The templates scope nearly every field inside a
 * `{#root}…{/root}` block, so a field's owner is decided by *position*, not by
 * its name — and a field placed under the wrong root renders blank with no
 * error at all, which is exactly how กนศ.06's approved total has been printing
 * empty. So the section stack is walked and the answer read off it rather than
 * guessed from naming.
 *
 * A field can legitimately appear under more than one root (the attendance
 * numbers are printed planned-then-actual side by side), so this returns a list
 * per field rather than a single owner.
 */
function owners(occurrences) {
  const stack = [];
  const fields = new Map();
  const sections = new Map();

  const record = (map, name, root) => {
    const list = map.get(name) || new Set();
    list.add(root);
    map.set(name, list);
  };

  for (const tag of occurrences) {
    if (tag.kind === 'section' || tag.kind === 'inverted') {
      // A section's own owner is read *before* it is pushed: a checkbox bank
      // inside `{#detail}` is read from `detail`, not from itself.
      if (!tag.isExpression && !ROOTS.includes(tag.name)) {
        record(sections, tag.name, [...stack].reverse().find((n) => ROOTS.includes(n)) || null);
      }
      stack.push(tag.name);
      continue;
    }
    if (tag.kind === 'close') {
      // Templates in the wild do not always close in order; unwind to the
      // matching open rather than assuming the top of the stack is it.
      const at = stack.lastIndexOf(tag.name);
      if (at >= 0) stack.length = at;
      continue;
    }
    if (tag.kind !== 'field' || tag.isExpression) continue;

    record(fields, tag.name, [...stack].reverse().find((name) => ROOTS.includes(name)) || null);
  }

  const settle = (map) => {
    const out = {};
    for (const [name, roots] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      out[name] = [...roots].sort();
    }
    return out;
  };

  return { fields: settle(fields), sections: settle(sections) };
}

function extract(file) {
  const zip = new PizZip(fs.readFileSync(file));
  const text = Object.keys(zip.files)
    .filter((entry) => TEXT_PARTS.test(entry))
    .sort()
    .map((entry) => flatten(zip.files[entry].asText()))
    .join('\n');

  const occurrences = [];
  const tags = /\{([^{}]*)\}/g;
  let match;
  while ((match = tags.exec(text)) !== null) {
    const tag = classify(match[1]);
    if (tag) occurrences.push(tag);
  }

  const unique = new Map();
  for (const tag of occurrences) {
    const key = `${tag.kind}:${tag.raw}`;
    unique.set(key, (unique.get(key) || 0) + 1);
  }

  const named = (kind) => [...new Set(
    occurrences.filter((t) => t.kind === kind && !t.isExpression).map((t) => t.name)
  )].sort();

  return {
    textLength: text.length,
    occurrences: occurrences.length,
    unique: unique.size,
    owners: owners(occurrences),
    // These three are the payload's surface: a plain field is a value the
    // assembler must supply, a simple section is a key whose truthiness shows or
    // hides a block, and an inverted section is the same key read the other way.
    fields: named('field'),
    sections: named('section'),
    inverted: named('inverted'),
    expressions: [...new Set(
      occurrences.filter((t) => t.isExpression && t.kind !== 'close').map((t) => t.raw)
    )].sort(),
  };
}

/**
 * Split a flat field list into families and their arities.
 *
 * The templates are fixed-arity by construction (the `{#…}` blocks are scoping
 * blocks, not loops), so a family is a name plus a trailing index, and the
 * highest index that appears **is** the form's capacity for it. That is where
 * the arity table in the contract comes from, and deriving it here rather than
 * copying it means the assembler's limits cannot fall out of step with the
 * files they describe.
 */
function families(names) {
  const out = new Map();
  for (const name of names) {
    const match = /^(.*?)(\d+)$/.exec(name);
    if (!match) continue;
    const [, stem, index] = match;
    const seen = out.get(stem) || { stem, indices: [] };
    seen.indices.push(Number(index));
    out.set(stem, seen);
  }
  return [...out.values()]
    .map(({ stem, indices }) => {
      const sorted = [...indices].sort((a, b) => a - b);
      const max = sorted[sorted.length - 1];
      return {
        stem,
        count: sorted.length,
        max,
        // A family that skips an index is worth seeing: it means either a
        // defect in the form or a name this parser split wrongly.
        contiguous: sorted.length === max && sorted.every((n, i) => n === i + 1),
      };
    })
    .sort((a, b) => a.stem.localeCompare(b.stem));
}

function report(label, data) {
  console.log(`\n${label}`);
  console.log(`  text ${data.textLength.toLocaleString()} chars · ${data.occurrences.toLocaleString()} occurrences · ${data.unique.toLocaleString()} unique`);
  console.log(`  plain fields ${data.fields.length} · simple sections ${data.sections.length} · inverted ${data.inverted.length} · expressions ${data.expressions.length}`);

  const scalar = data.fields.filter((name) => !/\d+$/.test(name));
  console.log(`  un-indexed fields (${scalar.length}): ${scalar.slice(0, 12).join(', ')}${scalar.length > 12 ? ' …' : ''}`);

  const fam = families(data.fields);
  console.log(`  indexed families (${fam.length}):`);
  for (const f of fam) {
    console.log(`    ${f.stem.padEnd(28)} 1..${String(f.max).padStart(2)}  ${f.contiguous ? '' : `GAPS (${f.count} of ${f.max})`}`);
  }

  // Grouped the other way round: what each root has to carry.
  for (const [what, table] of [['fields', data.owners.fields], ['sections', data.owners.sections]]) {
    const byRoot = new Map();
    for (const [name, roots] of Object.entries(table)) {
      for (const root of roots) {
        const key = root || '(top level)';
        byRoot.set(key, (byRoot.get(key) || []).concat(name));
      }
    }
    console.log(`  ${what} per payload root:`);
    for (const [root, names] of [...byRoot.entries()].sort()) {
      const stems = [...new Set(names.map((f) => f.replace(/\d+$/, '')))].sort();
      console.log(`    ${root.padEnd(16)} ${String(names.length).padStart(3)} · ${stems.slice(0, 7).join(', ')}${stems.length > 7 ? ` … (+${stems.length - 7})` : ''}`);
    }
  }
}

const temp04 = extract(path.join(TEMPLATES_DIR, 'temp04.docx'));
const temp06 = extract(path.join(TEMPLATES_DIR, 'temp06.docx'));

report('temp04 — กนศ.04', temp04);
report('temp06 — กนศ.06', temp06);

if (process.argv.includes('--json')) {
  const payload = {
    note: 'Generated by backend/scripts/extract-template-tags.js — do not hand-edit. '
        + 'Regenerate after any change to templates/*.docx.',
    generatedFrom: { temp04: 'templates/temp04.docx', temp06: 'templates/temp06.docx' },
    temp04: { ...temp04, families: families(temp04.fields) },
    temp06: { ...temp06, families: families(temp06.fields) },
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`\nwrote ${path.relative(path.resolve(__dirname, '../..'), OUTPUT)}`);
}
