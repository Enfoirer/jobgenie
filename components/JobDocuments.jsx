'use client';
import { useEffect, useState } from 'react';
import DocumentPDFPreview from './DocumentPDFPreview';
import { UPLOAD_ACCEPT, UPLOAD_HELP } from '@/lib/uploads/policy';
const kinds = { resume: 'Resume', coverLetter: 'Cover letter', portfolio: 'Portfolio' };
export default function JobDocuments({ jobId }) {
  const [documents, setDocuments] = useState([]), [files, setFiles] = useState([]);
  const [fileId, setFileId] = useState(''), [kind, setKind] = useState('resume'), [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [preview, setPreview] = useState(null);
  const endpoint = `/api/jobs/${jobId}/documents`;
  async function json(url, options) { const r = await fetch(url, options); const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Unable to load documents'); return data; }
  useEffect(() => {
    let active = true;
    Promise.all([json(endpoint), json('/api/uploads')]).then(([d, f]) => { if (active) { setDocuments(d.documents); setFiles(f.files); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [endpoint]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  async function link() {
    setBusy(true); setError('');
    try {
      await json(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId, kind, label }) });
      setDocuments((await json(endpoint)).documents); setLabel('');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function upload(file) {
    if (!file) return; setBusy(true); setError('');
    try {
      const body = new FormData(); body.append('file', file);
      const data = await json('/api/uploads', { method: 'POST', body });
      setFiles(previous => [data.file, ...previous]); setFileId(data.file.id);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function view(file) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${endpoint}/${file.id}`);
      if (!response.ok) throw new Error('Unable to load document');
      setPreview({ ...file, url: URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: file.type })) });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <section aria-label="Application documents" className="my-5 space-y-3 rounded border p-4">
    <h3 className="font-semibold">Application documents</h3>
    <p className="text-sm text-gray-600">Keep the exact files used for this application. Each new version preserves older snapshots, even if the library file is deleted.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <fieldset disabled={busy} className="flex flex-col gap-2">
      <label className="text-sm">Document type<select aria-label="Document type" value={kind} onChange={e => setKind(e.target.value)} className="block w-full rounded border p-2">{Object.entries(kinds).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="text-sm">Library file<select aria-label="Library file" value={fileId} onChange={e => setFileId(e.target.value)} className="block w-full rounded border p-2"><option value="">Choose an attachment</option>{files.map(f => <option key={f.id} value={f.id}>{f.name} · {new Date(f.uploadDate).toLocaleString()}</option>)}</select></label>
      <label className="text-sm">Or upload a new file<input aria-label="Upload application document" type="file" accept={UPLOAD_ACCEPT} onChange={e => { upload(e.target.files[0]); e.target.value = ''; }} className="block w-full" /></label>
      <p className="text-xs text-gray-500">{UPLOAD_HELP}. Upload first, then save a version.</p>
      <input aria-label="Version note" placeholder="Version note (optional), e.g. submitted on Nov 3" maxLength={200} value={label} onChange={e => setLabel(e.target.value)} className="rounded border p-2" />
      <button type="button" disabled={!fileId} onClick={link} className="rounded bg-blue-600 p-2 text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save document version'}</button>
    </fieldset>
    {Object.entries(kinds).map(([key, title]) => <div key={key}><h4 className="font-medium">{title}</h4>
      {documents.filter(d => d.kind === key).map((d, i) => <div key={d.id} className="my-2 rounded bg-gray-50 p-2 text-sm">
        <p className="break-words">v{d.version}{i === 0 ? ' · Latest' : ''} · {d.name}</p><p>{d.label}</p><p className="text-gray-500">{new Date(d.uploadDate).toLocaleString()} · {d.size}</p>
        <div className="flex gap-4">{['application/pdf','image/png','image/jpeg'].includes(d.type) && <button type="button" disabled={busy} onClick={() => view(d)} className="text-blue-700">View</button>}
        <a className="text-blue-700" href={`${endpoint}/${d.id}`}>Download{d.type.includes('wordprocessing') ? ' / open DOCX' : ''}</a></div>
      </div>)}
    </div>)}
    {!documents.length && <p className="text-sm text-gray-500">No linked documents yet.</p>}
    {preview && <div className="space-y-2"><button type="button" onClick={() => setPreview(null)}>Close preview</button><p className="text-sm">{preview.name}</p>
      {preview.type.startsWith('image/') ? <img src={preview.url} alt={preview.name} className="max-h-96 max-w-full" /> : <DocumentPDFPreview key={preview.url} url={preview.url} />}
    </div>}
  </section>;
}
