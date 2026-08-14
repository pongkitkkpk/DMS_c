/**
 * The eight checkbox vocabularies, from the API.
 *
 * Q34: `setCode.json` seeds the taxonomy and the API serves it, rather than the
 * client shipping its own copy. The old frontend hard-coded all 56 labels in
 * JSX, so a corrected label meant a frontend release — and the seed corrects
 * several (`docs/DECISIONS.md`, deviation 7).
 *
 * The ordinal is what matters, not the label: it decides which `is_*` tag the
 * document assembler emits, so a set's numbering is stable even when its
 * wording is fixed.
 */
import React from 'react';

export default function TagPicker({ tagSets, selected, onChange }) {
  const chosen = new Set(selected);

  const toggle = (id) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange([...next]);
  };

  return (
    <section className="card-x">
      <header className="card-x__head">
        <span>แท็กและยุทธศาสตร์</span>
        <span className="u-spacer u-dim u-small">เลือกแล้ว {chosen.size} รายการ</span>
      </header>

      <div className="card-x__body u-stack">
        {tagSets.map((set) => (
          <fieldset key={set.code} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="u-small u-muted" style={{ fontSize: '0.85rem', marginBottom: 'var(--s-2)' }}>
              {set.nameTh}
            </legend>
            <div style={{ display: 'grid', gap: 'var(--s-2)', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
              {set.tags.map((tag) => (
                <label key={tag.id} className="u-small" style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'flex-start', margin: 0, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={chosen.has(tag.id)}
                    onChange={() => toggle(tag.id)}
                    style={{ marginTop: '0.2rem', flex: 'none' }}
                  />
                  <span><span className="u-dim u-mono">{tag.ordinal}.</span> {tag.nameTh}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </section>
  );
}
