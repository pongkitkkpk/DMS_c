/**
 * A repeating-row editor for one of a project's ordered child lists.
 *
 * All seven lists have the same shape — an ordered set of rows, replaced whole
 * — so they get one editor rather than the seven near-identical screens the old
 * frontend had (`TableAddStudent`, `TableAddPersonel`, `DTableAddBudget` and
 * friends, each with its own copy of the add/remove logic).
 *
 * **No row carries an ordinal.** Position in this list is the order, and the
 * server assigns `ordinal` from it on save. A client-chosen ordinal decides
 * which box a row prints in on a government form, so it is not the client's to
 * choose (deviation 16) — which is also why the move-up/move-down controls edit
 * the array rather than a number on the row.
 */
import React from 'react';
import { Button, Input } from 'reactstrap';

/**
 * @param {object[]} columns `{ key, label, type?, width?, placeholder?, options? }`
 * @param {object[]} rows    the current values
 * @param {function} onChange called with the whole new array
 * @param {number}   [max]   the form's capacity, when one applies
 */
export default function ListEditor({
  title, hint, columns, rows, onChange, max, addLabel = '+ เพิ่มแถว', empty = 'ยังไม่มีรายการ',
}) {
  const blank = Object.fromEntries(columns.map((c) => [c.key, c.type === 'number' ? '' : '']));

  const edit = (index, key, value) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  const add = () => onChange([...rows, { ...blank }]);
  const remove = (index) => onChange(rows.filter((_, i) => i !== index));

  const move = (index, by) => {
    const to = index + by;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  };

  const over = max !== undefined && rows.length > max;

  return (
    <section className="card-x">
      <header className="card-x__head">
        <span>{title}</span>
        <span className="u-spacer u-dim u-small">
          {rows.length} รายการ{max !== undefined ? ` · แบบฟอร์มพิมพ์ได้ ${max}` : ''}
        </span>
      </header>

      <div className="card-x__body">
        {hint && <p className="u-small u-muted mb-3">{hint}</p>}

        {/* The limit is stated where the rows are added, not only at save time:
            the form's capacity is a fact about the government document, and
            finding out after typing thirteen rows is worse than knowing. */}
        {over && (
          <div className="notice notice--danger mb-3">
            <span className="notice__mark" aria-hidden="true">!</span>
            <span>
              มี {rows.length} รายการ แต่แบบฟอร์มพิมพ์ได้ {max} รายการ —
              บันทึกได้ แต่จะออกเอกสารไม่ได้จนกว่าจะลดจำนวนลง
            </span>
          </div>
        )}

        {rows.length === 0 && <p className="u-small u-dim mb-3">{empty}</p>}

        {rows.map((row, index) => (
          <div
            key={index}
            className="u-row mb-3"
            style={{ alignItems: 'flex-start', gap: 'var(--s-2)' }}
          >
            <span
              className="u-small u-dim u-mono"
              style={{ width: '1.6rem', paddingTop: '0.5rem', flex: 'none', textAlign: 'right' }}
            >
              {index + 1}.
            </span>

            <div
              className="le-fields"
              style={{
                display: 'grid',
                gap: 'var(--s-2)',
                // `minmax(0, 1fr)`, not a bare `1fr`: an unconstrained `1fr`
                // track cannot shrink past its content's min-content width,
                // which for a text `<input>` is wide enough on its own that
                // four of them side by side (e.g. the indicators row) ran the
                // whole row off the edge of a phone screen rather than
                // narrowing to fit it — found live at 390px. Below that,
                // `.le-fields`'s own phone-width rule in theme.css takes
                // over: a `date` or `number` input has a real, un-shrinkable
                // native minimum width no `minmax(0, …)` can get under, so
                // narrowing the tracks stops being enough and they need to
                // wrap onto more than one line instead.
                gridTemplateColumns: columns.map((c) => c.width || 'minmax(0, 1fr)').join(' '),
                flex: 1,
                minWidth: 0,
              }}
            >
              {columns.map((column) => (
                <Input
                  key={column.key}
                  bsSize="sm"
                  type={column.type || 'text'}
                  value={row[column.key] === null || row[column.key] === undefined ? '' : row[column.key]}
                  placeholder={column.placeholder || column.label}
                  aria-label={`${column.label} แถวที่ ${index + 1}`}
                  onChange={(e) => edit(index, column.key, e.target.value)}
                >
                  {column.options && [
                    <option key="" value="">{column.placeholder || '—'}</option>,
                    ...column.options.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    )),
                  ]}
                </Input>
              ))}
            </div>

            <div className="u-row" style={{ gap: 2, flex: 'none', paddingTop: 2 }}>
              <Button size="sm" outline color="secondary" aria-label="เลื่อนขึ้น"
                disabled={index === 0} onClick={() => move(index, -1)}>↑</Button>
              <Button size="sm" outline color="secondary" aria-label="เลื่อนลง"
                disabled={index === rows.length - 1} onClick={() => move(index, 1)}>↓</Button>
              <Button close aria-label="ลบแถว" onClick={() => remove(index)} />
            </div>
          </div>
        ))}

        <Button size="sm" outline color="secondary" onClick={add}>{addLabel}</Button>
      </div>
    </section>
  );
}
