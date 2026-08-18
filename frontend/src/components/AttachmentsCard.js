/**
 * A project's uploaded files.
 *
 * Every filename here is a **label**, never a link: there is no URL that serves
 * these bytes statically, so each download is an authorized request whose
 * response is turned into a file locally. The old system mounted its upload
 * directory as static files, which made a guessable filename someone else's
 * document (Q21, deviation 8) — an `<a href>` here would be the shape of that
 * mistake even though the route behind it now checks.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from 'reactstrap';
import Swal from 'sweetalert2';

import { api, filenameOf, messageOf } from '../api';
import { calendarDate, Card, Empty, LoadFailed, Skeleton } from './ui';

/** Bytes as something a person reads. */
function size(bytes) {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A refusal arrives as a blob when a blob is what was asked for. */
async function messageOfBlobError(error) {
  const data = error.response && error.response.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (parsed.error) return parsed.error;
    } catch { /* not JSON */ }
  }
  return messageOf(error);
}

export default function AttachmentsCard({ projectId, onChanged }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(null);
  const input = useRef(null);

  // Three states, not two: loading, loaded, and could-not-load. Collapsing the
  // third into the first left the skeleton up for as long as the tab stayed
  // open — see `LoadFailed`.
  const load = useCallback(() => {
    setFailed(false);
    api.attachments(projectId)
      .then((loaded) => { setData(loaded); })
      .catch(() => { setData(null); setFailed(true); });
  }, [projectId]);

  useEffect(load, [load]);

  const upload = async (event) => {
    const file = event.target.files && event.target.files[0];
    // Clearing the input immediately means the same file can be chosen twice in
    // a row — otherwise `change` never fires the second time.
    event.target.value = '';
    if (!file) return;

    setBusy('upload');
    try {
      await api.uploadAttachment(projectId, file);
      load();
      // Both of these are recorded on the project's timeline, which is a
      // sibling card and would otherwise show them only after a reload.
      if (onChanged) onChanged();
    } catch (err) {
      await Swal.fire({ icon: 'error', title: 'อัปโหลดไม่สำเร็จ', text: messageOf(err) });
    } finally {
      setBusy(null);
    }
  };

  const download = async (attachment) => {
    setBusy(`d${attachment.id}`);
    try {
      const response = await api.downloadAttachment(projectId, attachment.id);
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = filenameOf(response, attachment.originalName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      await Swal.fire({ icon: 'error', title: 'ดาวน์โหลดไม่สำเร็จ', text: await messageOfBlobError(err) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (attachment) => {
    const confirmed = await Swal.fire({
      title: 'ลบไฟล์แนบนี้?',
      text: attachment.originalName,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'ลบ',
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true,
      focusCancel: true,
    });
    if (!confirmed.isConfirmed) return;

    try {
      await api.deleteAttachment(projectId, attachment.id);
      load();
      if (onChanged) onChanged();
    } catch (err) {
      await Swal.fire({ icon: 'error', title: 'ลบไม่สำเร็จ', text: messageOf(err) });
    }
  };

  if (failed) {
    return <Card title="ไฟล์แนบ"><LoadFailed what="ไฟล์แนบ" onRetry={load} /></Card>;
  }
  if (!data) return <Card title="ไฟล์แนบ"><Skeleton rows={2} /></Card>;

  const maxMb = Math.round(data.maxBytes / (1024 * 1024));

  return (
    <Card title="ไฟล์แนบ" aside={`${data.attachments.length} ไฟล์`}>
      {data.attachments.length === 0 ? (
        <Empty mark="📎" title="ยังไม่มีไฟล์แนบ" />
      ) : (
        <div className="u-stack" style={{ gap: 'var(--s-2)' }}>
          {data.attachments.map((attachment) => (
            <div key={attachment.id} className="u-row" style={{ gap: 'var(--s-2)' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="u-small" style={{ wordBreak: 'break-word' }}>
                  {attachment.originalName}
                </div>
                <div className="u-small u-dim">
                  {size(attachment.byteSize)} · {attachment.uploadedByName} ·{' '}
                  {calendarDate(attachment.uploadedAt)}
                </div>
              </div>
              {/* One "ดาวน์โหลด" and one "×" per file, all reading the same —
                  the file they act on is in a different element, which a reader
                  using the buttons alone never reaches. Same rule as the two
                  form buttons in `DocumentsCard`, and the ถอน buttons on the
                  roles screen: the name says its object. */}
              <Button size="sm" outline color="secondary" disabled={busy === `d${attachment.id}`}
                aria-label={`ดาวน์โหลด ${attachment.originalName}`}
                onClick={() => download(attachment)}>
                {busy === `d${attachment.id}` ? '…' : 'ดาวน์โหลด'}
              </Button>
              {data.canEdit && (
                <Button close aria-label={`ลบไฟล์แนบ ${attachment.originalName}`}
                  onClick={() => remove(attachment)} />
              )}
            </div>
          ))}
        </div>
      )}

      {data.canEdit && (
        <div className="lines__foot" style={{ flexWrap: 'wrap' }}>
          <input
            ref={input}
            type="file"
            style={{ display: 'none' }}
            accept={data.allowedExtensions.join(',')}
            onChange={upload}
          />
          <Button size="sm" outline color="secondary" disabled={busy === 'upload'}
            onClick={() => input.current && input.current.click()}>
            {busy === 'upload' ? 'กำลังอัปโหลด…' : '+ แนบไฟล์'}
          </Button>
          <span className="u-small u-dim">
            ไม่เกิน {maxMb} MB · {data.allowedExtensions.join(' ')}
          </span>
        </div>
      )}
    </Card>
  );
}
