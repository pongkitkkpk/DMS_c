/**
 * The budget of one project: the figures, the three limits as meters, the line
 * items for both variants, and the disbursement ledger.
 *
 * Two rules shape all of it.
 *
 * **The server decides.** Which controls appear comes from `budget.permissions`,
 * which the API computed by asking the same assertions its writes run. Nothing
 * here infers a capability from the user's role — the old screen did, from a
 * value in `sessionStorage`, and drew buttons for endpoints that checked
 * nothing. Hiding a control is a courtesy; every write is refused on the server
 * regardless of what this file believes.
 *
 * **No total is computed here to be sent back.** Line totals are shown from the
 * server's `amount`, which is a generated column, and the sums come from the
 * API. The one place this file multiplies anything is the preview on an unsaved
 * row, which is labelled as such and never submitted — the old client computed
 * `remainingBudget` and posted it, which is how a ledger stops adding up.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Input } from 'reactstrap';
import Swal from 'sweetalert2';

import { api, messageOf } from '../api';
import { calendarDate, Card, dateTime, Empty, Skeleton, money } from './ui';

/**
 * The categories as the government form names them (docs/schema-current.md →
 * "What are the expense categories"). The form prints three; the database
 * splits ค่าใช้สอย in two because `BT` carries a second quantity and `BNT` does
 * not, so both appear here and the assembler recombines them for the document.
 */
const CATEGORY_LABELS = {
  A: 'ก. ค่าตอบแทน',
  BT: 'ข. ค่าใช้สอย (สองหน่วยนับ)',
  BNT: 'ข. ค่าใช้สอย (หน่วยนับเดียว)',
  C: 'ค. ค่าวัสดุ',
  ETC: 'อื่น ๆ',
};

const VARIANT_LABELS = {
  PLANNED: { title: 'รายการงบประมาณที่ขอ', hint: 'ตามแผน (กนศ.04)' },
  ACTUAL: { title: 'รายการค่าใช้จ่ายจริง', hint: 'ตามที่จ่ายจริง (กนศ.06)' },
};

const num = (value) => (value === null || value === undefined || value === '' ? 0 : Number(value));

/** A finding, with a mark and the server's own sentence. Never colour alone. */
function Notice({ finding, tone = 'warn' }) {
  return (
    <div className={`notice notice--${tone}`}>
      <span className="notice__mark" aria-hidden="true">{tone === 'danger' ? '!' : '△'}</span>
      <span>{finding.message}</span>
    </div>
  );
}

/**
 * One ratio against a limit.
 *
 * Over the limit the bar stays full and the caption carries the overage, so the
 * drawing never claims a width it does not have. Severity steps accent → warning
 * → danger, and the unfilled track is the lighter step of whichever ramp the
 * fill is using.
 */
function Meter({ label, value, limit, overLabel = 'เกิน' }) {
  if (limit === null || limit === undefined) return null;
  const used = num(value);
  const cap = num(limit);
  const ratio = cap > 0 ? used / cap : (used > 0 ? Infinity : 0);
  // Exactly at the limit is green, not amber: a project that requests precisely
  // what it planned has done the right thing, and colouring the designed outcome
  // as a caution teaches people to ignore the colour. Amber is for approaching
  // a limit that has not been reached.
  const state = ratio > 1 ? 'over' : (ratio >= 0.9 && ratio < 1) ? 'near' : 'ok';
  const width = `${Math.min(ratio, 1) * 100}%`;

  return (
    <div className={`meter meter--${state}`}>
      <div className="meter__head">
        <span>{label}</span>
        <span className="meter__amount">
          {money(value)} / {money(limit)}
          {ratio > 1 && ` · ${overLabel} ${money(used - cap)}`}
        </span>
      </div>
      <div
        className="meter__track"
        role="meter"
        aria-label={label}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={cap}
      >
        <div className="meter__fill" style={{ width }} />
      </div>
    </div>
  );
}

function Kpi({ label, value, note }) {
  return (
    <div className="kpi">
      <div className="kpi__label">{label}</div>
      <div className="kpi__value">{money(value)}</div>
      {note && <div className="kpi__note">{note}</div>}
    </div>
  );
}

/**
 * One variant's lines, edited as a whole.
 *
 * The API replaces the list rather than merging row by row, because these are
 * ordered rows on a fixed-arity form: `ordinal` decides which box a line prints
 * in, and it is the server's to assign from position. So the editor holds a
 * draft and submits the whole list — the same shape as every other child list
 * in the system.
 */
function LineEditor({ projectId, variant, rows, editable, onSaved }) {
  const [draft, setDraft] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(rows.map((r) => ({
      category: r.category,
      description: r.description,
      qty1: r.qty1 === null ? '' : String(Number(r.qty1)),
      unit1: r.unit1 || '',
      qty2: r.qty2 === null ? '' : String(Number(r.qty2)),
      unit2: r.unit2 || '',
      unitPrice: String(Number(r.unit_price)),
      amount: r.amount,
    })));
    setDirty(false);
  }, [rows]);

  const edit = (index, field, value) => {
    setDraft((current) => current.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
    setDirty(true);
  };

  const add = () => {
    setDraft((current) => [...current, {
      category: 'C', description: '', qty1: '1', unit1: '', qty2: '', unit2: '', unitPrice: '', amount: null,
    }]);
    setDirty(true);
  };

  const remove = (index) => {
    setDraft((current) => current.filter((_, i) => i !== index));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const items = draft.map((row) => ({
        category: row.category,
        description: row.description,
        qty1: row.qty1 === '' ? null : row.qty1,
        unit1: row.unit1 || null,
        qty2: row.qty2 === '' ? null : row.qty2,
        unit2: row.unit2 || null,
        unitPrice: row.unitPrice,
      }));
      const result = await api.setLines(projectId, variant, items);
      setDirty(false);
      onSaved(result);
    } catch (err) {
      await Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: messageOf(err) });
    } finally {
      setBusy(false);
    }
  };

  const label = VARIANT_LABELS[variant];
  const saved = rows.reduce((total, r) => total + num(r.amount), 0);

  return (
    <Card title={label.title} aside={label.hint}>
      {draft.length === 0 && !editable ? (
        <Empty mark="฿" title="ยังไม่มีรายการ" />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="lines">
            <thead>
              <tr>
                <th style={{ minWidth: 170 }}>หมวด</th>
                <th style={{ minWidth: 200 }}>รายการ</th>
                <th style={{ width: 90 }}>จำนวน</th>
                <th style={{ width: 90 }}>หน่วย</th>
                <th style={{ width: 90 }}>× จำนวน</th>
                <th style={{ width: 90 }}>หน่วย</th>
                <th style={{ width: 110 }}>ราคา/หน่วย</th>
                <th style={{ width: 120, textAlign: 'right' }}>รวม</th>
                {editable && <th style={{ width: 40 }} aria-label="ลบ" />}
              </tr>
            </thead>
            <tbody>
              {draft.map((row, index) => (
                <tr key={index}>
                  <td>
                    <Input type="select" bsSize="sm" value={row.category} disabled={!editable}
                      onChange={(e) => edit(index, 'category', e.target.value)}>
                      {Object.entries(CATEGORY_LABELS).map(([code, text]) => (
                        <option key={code} value={code}>{text}</option>
                      ))}
                    </Input>
                  </td>
                  <td>
                    <Input bsSize="sm" value={row.description} disabled={!editable}
                      placeholder="รายละเอียด"
                      onChange={(e) => edit(index, 'description', e.target.value)} />
                  </td>
                  <td>
                    <Input bsSize="sm" className="lines__num" value={row.qty1} disabled={!editable}
                      onChange={(e) => edit(index, 'qty1', e.target.value)} />
                  </td>
                  <td>
                    <Input bsSize="sm" value={row.unit1} disabled={!editable} placeholder="ชุด"
                      onChange={(e) => edit(index, 'unit1', e.target.value)} />
                  </td>
                  <td>
                    <Input bsSize="sm" className="lines__num" value={row.qty2} disabled={!editable}
                      onChange={(e) => edit(index, 'qty2', e.target.value)} />
                  </td>
                  <td>
                    <Input bsSize="sm" value={row.unit2} disabled={!editable} placeholder="ชม."
                      onChange={(e) => edit(index, 'unit2', e.target.value)} />
                  </td>
                  <td>
                    <Input bsSize="sm" className="lines__num" value={row.unitPrice} disabled={!editable}
                      onChange={(e) => edit(index, 'unitPrice', e.target.value)} />
                  </td>
                  <td className="lines__amount">
                    {/* The saved total is the database's generated column. An
                        unsaved row has none yet, so it shows a preview in dim
                        text — a preview is not a figure, and it is never sent. */}
                    {row.amount !== null && !dirty ? money(row.amount) : (
                      <span className="u-dim">
                        ≈ {money(
                          (row.qty1 === '' ? 1 : num(row.qty1)) *
                          (row.qty2 === '' ? 1 : num(row.qty2)) *
                          num(row.unitPrice)
                        )}
                      </span>
                    )}
                  </td>
                  {editable && (
                    <td>
                      <Button close aria-label="ลบรายการ" onClick={() => remove(index)} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="lines__foot">
        {editable && (
          <>
            <Button size="sm" outline color="secondary" onClick={add} disabled={busy}>+ เพิ่มรายการ</Button>
            <Button size="sm" color="primary" onClick={save} disabled={busy || !dirty}>
              {busy ? 'กำลังบันทึก…' : 'บันทึกรายการ'}
            </Button>
          </>
        )}
        <span className="u-spacer u-small u-muted">
          รวมที่บันทึกไว้ <strong className="u-mono">{money(saved)}</strong> บาท
          {dirty && <span className="u-dim"> · ยังไม่ได้บันทึกการแก้ไข</span>}
        </span>
      </div>
    </Card>
  );
}

/** The ledger. Append-only on the server, so append-only here: no edit, no delete. */
function Disbursements({ projectId, rows, editable, onSaved }) {
  const [form, setForm] = useState({ amount: '', receivedByName: '', issuedByName: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.disburse(projectId, form);
      setForm({ amount: '', receivedByName: '', issuedByName: '' });
      onSaved(result);
    } catch (err) {
      await Swal.fire({ icon: 'error', title: 'บันทึกการเบิกจ่ายไม่สำเร็จ', text: messageOf(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="การเบิกจ่าย" aside={`${rows.length} ครั้ง`}>
      {rows.length === 0 ? (
        <Empty mark="฿" title="ยังไม่มีการเบิกจ่าย" />
      ) : (
        <div className="timeline">
          {rows.map((row) => (
            <div key={row.id} className="tl-item">
              <div className="tl-item__title">
                <span className="u-mono">{money(row.amount)}</span> บาท · รับโดย {row.received_by_name}
              </div>
              <div className="tl-item__meta">
                จ่ายโดย {row.issued_by_name} · {dateTime(row.disbursed_at)}
              </div>
            </div>
          ))}
        </div>
      )}

      {editable && (
        <form className="lines__foot" style={{ flexWrap: 'wrap' }} onSubmit={submit}>
          <Input bsSize="sm" style={{ width: 120 }} required placeholder="จำนวนเงิน"
            value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <Input bsSize="sm" style={{ width: 160 }} required placeholder="ผู้รับเงิน"
            value={form.receivedByName} onChange={(e) => setForm({ ...form, receivedByName: e.target.value })} />
          <Input bsSize="sm" style={{ width: 160 }} required placeholder="ผู้จ่ายเงิน"
            value={form.issuedByName} onChange={(e) => setForm({ ...form, issuedByName: e.target.value })} />
          <Button size="sm" color="primary" disabled={busy}>
            {busy ? 'กำลังบันทึก…' : 'บันทึกการเบิกจ่าย'}
          </Button>
        </form>
      )}
    </Card>
  );
}

export default function BudgetPanel({ projectId, onChange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api.budget(projectId).then(setData).catch((err) => setError(messageOf(err)));
  }, [projectId]);

  useEffect(load, [load]);

  // A budget write can change a project's warnings and what the phase machine
  // will allow next, so the page reloads with the panel rather than after it.
  const refresh = () => { load(); if (onChange) onChange(); };

  const askAmount = async (title, current, submit) => {
    const asked = await Swal.fire({
      title,
      input: 'text',
      inputValue: current === null || current === undefined ? '' : String(Number(current)),
      inputLabel: 'จำนวนเงิน (บาท)',
      showCancelButton: true,
      confirmButtonText: 'บันทึก',
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true,
    });
    if (!asked.isConfirmed) return;
    try {
      await submit(asked.value);
      refresh();
    } catch (err) {
      await Swal.fire({ icon: 'error', title: 'ไม่สำเร็จ', text: messageOf(err) });
    }
  };

  if (error) return <Card title="งบประมาณ"><div className="notice notice--danger">
    <span className="notice__mark" aria-hidden="true">!</span><span>{error}</span>
  </div></Card>;
  if (!data) return <Card title="งบประมาณ"><Skeleton rows={4} /></Card>;

  const { money: figures, lines, disbursements, warnings, permissions } = data;

  return (
    <div className="u-stack">
      <Card
        title="งบประมาณ"
        aside={permissions.edit || permissions.approve ? undefined : 'อ่านอย่างเดียว'}
      >
        {warnings.length > 0 && (
          <div className="mb-4">
            {warnings.map((w) => <Notice key={w.code} finding={w} />)}
          </div>
        )}

        <div className="kpi-row">
          <Kpi label="ตามแผน" value={figures.plannedAmount} note="เพดานของรายการที่ขอ" />
          <Kpi label="ขอมา" value={figures.requestedTotal} note="ผลรวมของรายการ" />
          <Kpi label="อนุมัติ" value={figures.approvedAmount}
            note={figures.approvedAt ? calendarDate(figures.approvedAt) : 'ยังไม่อนุมัติ'} />
          <Kpi label="เบิกแล้ว" value={figures.disbursedTotal}
            note={figures.remaining === null ? undefined : `คงเหลือ ${money(figures.remaining)}`} />
          <Kpi label="ใช้จริง" value={figures.actualTotal}
            note={figures.refundTotal === null ? undefined : `ต้องคืน ${money(figures.refundTotal)}`} />
        </div>

        {/* The three limits, as the three ratios they are. */}
        <Meter label="รายการที่ขอ เทียบ งบประมาณตามแผน"
          value={figures.requestedTotal} limit={figures.plannedAmount} />
        <Meter label="เบิกจ่ายแล้ว เทียบ วงเงินที่อนุมัติ"
          value={figures.disbursedTotal} limit={figures.approvedAmount} />
        <Meter label="ค่าใช้จ่ายจริง เทียบ วงเงินที่อนุมัติ"
          value={figures.actualTotal} limit={figures.approvedAmount} />
        <Meter label="วงเงินที่ชมรมอนุมัติแล้วทั้งปี เทียบ วงเงินจัดสรร"
          value={figures.clubYearCommitted} limit={figures.allocation} />

        {(permissions.edit || permissions.approve) && (
          <div className="lines__foot">
            {permissions.edit && (
              <Button size="sm" outline color="secondary"
                onClick={() => askAmount('งบประมาณตามแผน', figures.plannedAmount,
                  (value) => api.setPlan(projectId, value))}>
                แก้ไขงบประมาณตามแผน
              </Button>
            )}
            {permissions.approve && (
              <Button size="sm" color="primary"
                onClick={() => askAmount('อนุมัติวงเงินโครงการ', figures.approvedAmount,
                  (value) => api.approveBudget(projectId, value))}>
                {figures.approvedAmount === null ? 'อนุมัติวงเงิน' : 'แก้ไขวงเงินที่อนุมัติ'}
              </Button>
            )}
          </div>
        )}
      </Card>

      {/* Stacked rather than side by side: a line is eight fields wide, and two
          of these in one row leaves each too narrow to read without scrolling
          sideways — which hides the very column that matters, the total. */}
      <LineEditor projectId={projectId} variant="PLANNED" rows={lines.planned}
        editable={permissions.edit} onSaved={refresh} />
      <LineEditor projectId={projectId} variant="ACTUAL" rows={lines.actual}
        editable={permissions.edit} onSaved={refresh} />

      <Disbursements projectId={projectId} rows={disbursements}
        editable={permissions.disburse} onSaved={refresh} />
    </div>
  );
}
