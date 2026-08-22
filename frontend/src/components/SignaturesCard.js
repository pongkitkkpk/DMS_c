/**
 * Signatures captured on this project's approvals (docs/DECISIONS.md,
 * "E-signature", closed 2026-08-22).
 *
 * Not rendered onto กนศ.04/06 yet — the owner's decision was to keep this in
 * the system first (an audit trail: who, in which role, when, from where) and
 * revisit printing it on the government forms later. So this card is the only
 * place a signature is currently seen at all, which is also why it shows
 * every field the record carries rather than a summary.
 *
 * The image is fetched the same way an attachment is: there is no static URL
 * for it, so each thumbnail is an authorized request turned into an object
 * URL, not a bare `<img src="...">` (Q21, deviation 8) — even though the
 * bytes are server-verified PNG and safe to render inline, the *route* to
 * them is still behind a bearer token.
 */
import React, { useCallback, useEffect, useState } from 'react';

import { api } from '../api';
import { Card, dateTime, LoadFailed, ROLE_LABELS, Skeleton } from './ui';

function SignatureThumbnail({ projectId, signature }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    api.downloadSignature(projectId, signature.id).then((response) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(response.data);
      setUrl(objectUrl);
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, signature.id]);

  if (!url) return <div className="skel" style={{ width: 160, height: 64 }} />;
  return (
    <img
      src={url}
      alt={`ลายเซ็นของ ${signature.signerName}`}
      style={{ maxWidth: 160, maxHeight: 64, background: '#fff', border: '1px solid var(--c-border)', borderRadius: 6 }}
    />
  );
}

export default function SignaturesCard({ projectId }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    api.signatures(projectId)
      .then((loaded) => setData(loaded.signatures))
      .catch(() => { setData(null); setFailed(true); });
  }, [projectId]);

  useEffect(load, [load]);

  if (failed) {
    return <Card title="ลายเซ็นอนุมัติ"><LoadFailed what="ลายเซ็น" onRetry={load} /></Card>;
  }
  if (!data) return <Card title="ลายเซ็นอนุมัติ"><Skeleton rows={2} /></Card>;
  if (!data.length) return null;   // most projects have signed nothing yet — no card is quieter than an empty one

  return (
    <Card title="ลายเซ็นอนุมัติ" aside={`${data.length} รายการ`}>
      <div className="u-stack" style={{ gap: 'var(--s-3)' }}>
        {data.map((signature) => (
          <div key={signature.id} className="u-row" style={{ gap: 'var(--s-2)', alignItems: 'flex-start' }}>
            <SignatureThumbnail projectId={projectId} signature={signature} />
            <div style={{ minWidth: 0 }}>
              <div className="u-small">
                {signature.toPhaseNameTh && `อนุมัติเป็น “${signature.toPhaseNameTh}” · `}
                {signature.signerName}
                <span className="u-dim"> ({ROLE_LABELS[signature.signerRole] || signature.signerRole})</span>
              </div>
              <div className="u-small u-dim">
                {dateTime(signature.signedAt)} · {signature.ipAddress}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
