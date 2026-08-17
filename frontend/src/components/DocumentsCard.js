/**
 * The two government forms, and whether this project can produce them.
 *
 * Availability comes from the server, which knows both reasons a form may be
 * unavailable — the project is too early in the phase machine, or it holds more
 * rows than the form has boxes for. The second is the one worth showing
 * prominently: a project with thirteen ค่าใช้สอย lines is perfectly valid, and
 * the old system printed twelve of them and said nothing.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button } from 'reactstrap';
import Swal from 'sweetalert2';

import { api, filenameOf, messageOf } from '../api';
import { Card, Skeleton } from './ui';

/**
 * A refused download arrives as a blob, because that is what was asked for —
 * so the server's Thai sentence has to be read back out of it rather than off
 * `error.response.data.error`.
 */
async function messageOfBlobError(error) {
  const data = error.response && error.response.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (parsed.error) return parsed.error;
    } catch { /* not JSON — fall through */ }
  }
  return messageOf(error);
}

export default function DocumentsCard({ projectId }) {
  const [documents, setDocuments] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    api.documents(projectId).then((d) => setDocuments(d.documents)).catch(() => setDocuments([]));
  }, [projectId]);

  useEffect(load, [load]);

  const download = async (doc) => {
    setBusy(doc.form);
    try {
      const response = await api.downloadDocument(projectId, doc.form);
      const name = filenameOf(response, `${doc.code}.docx`);
      // Object URL rather than a data: URI — these are ~90 KB and a data URI
      // would be base64'd into the DOM.
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      await Swal.fire({ icon: 'error', title: 'ออกเอกสารไม่ได้', text: await messageOfBlobError(err) });
    } finally {
      setBusy(null);
    }
  };

  if (!documents) return <Card title="เอกสาร"><Skeleton rows={2} /></Card>;

  return (
    <Card title="เอกสาร" aside="กนศ.04 · กนศ.06">
      <div className="u-stack" style={{ gap: 'var(--s-3)' }}>
        {documents.map((doc) => (
          <div key={doc.form}>
            <div className="u-row">
              <div style={{ minWidth: 0 }}>
                <div className="u-mono u-small">{doc.code}</div>
                <div className="u-small u-muted">{doc.title}</div>
              </div>
              <Button
                className="u-spacer"
                size="sm"
                color={doc.available ? 'primary' : 'secondary'}
                outline={!doc.available}
                disabled={!doc.available || busy === doc.form}
                // "ดาวน์โหลด" twice in a row says which button but not which
                // form, and the two are กนศ.04 and กนศ.06 — different documents
                // for different stages of the same project.
                aria-label={`ดาวน์โหลด ${doc.code} ${doc.title}`}
                onClick={() => download(doc)}
              >
                {busy === doc.form ? 'กำลังสร้าง…' : 'ดาวน์โหลด'}
              </Button>
            </div>
            {!doc.available && doc.reason && (
              <div className={`notice notice--${doc.violations.length ? 'danger' : 'warn'} mt-2`}>
                <span className="notice__mark" aria-hidden="true">
                  {doc.violations.length ? '!' : '△'}
                </span>
                <span>
                  {doc.reason}
                  {doc.violations.length > 1 && (
                    <div className="u-small mt-1">
                      และอีก {doc.violations.length - 1} รายการ
                    </div>
                  )}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
