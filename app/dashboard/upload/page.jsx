'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '@/components/Modal';
import { UPLOAD_ACCEPT, UPLOAD_HELP, validateUploadMetadata } from '@/lib/uploads/policy';

const buttonClass = 'rounded-md border px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50';
const downloadPath = (file) => `/api/uploads/download/${file.id}`;

export default function UploadPage() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [detailFile, setDetailFile] = useState(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);
  const uploadLock = useRef(false);

  const loadFiles = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/uploads', { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load files. Please try again.');
      setFiles((await response.json()).files || []);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { loadFiles(); }, [loadFiles]);

  async function handleFiles(selected) {
    if (uploadLock.current || !selected.length) return;
    setError('');
    if (selected.length !== 1) { setError('Upload one file at a time.'); return; }
    try { validateUploadMetadata(selected[0]); }
    catch (err) { setError(err.message); if (fileInputRef.current) fileInputRef.current.value = ''; return; }
    uploadLock.current = true; setIsUploading(true);
    try {
      const form = new FormData(); form.append('file', selected[0]);
      const response = await fetch('/api/uploads', { method: 'POST', body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || (response.status === 413 ? 'File too large (maximum 4 MB).' : 'Upload failed. Please try again.'));
      setFiles((previous) => [data.file, ...previous]);
    } catch (err) { setError(err.message || 'Upload failed. Please try again.'); }
    finally {
      uploadLock.current = false; setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function deleteFile(file) {
    setDeleting(file.id); setError('');
    try {
      const response = await fetch(`/api/uploads/${file.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Unable to delete this file. Please try again.');
      setFiles((previous) => previous.filter((item) => item.id !== file.id));
      if (detailFile?.id === file.id) setDetailFile(null);
    } catch (err) { setError(err.message); }
    finally { setDeleting(null); }
  }

  return <div className="space-y-6">
    <header className="border-b pb-3">
      <h1 className="text-2xl font-semibold text-gray-800">Uploaded Files</h1>
      <p className="mt-1 text-sm text-gray-500">Manage your resumes, cover letters and job-related documents.</p>
    </header>
    {error && <p role="alert" className="rounded-md bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    <div className={`rounded-lg border-2 border-dashed p-6 text-center ${dragActive ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}`}
      onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => { event.preventDefault(); setDragActive(false); handleFiles(event.dataTransfer.files); }}>
      <input ref={fileInputRef} type="file" accept={UPLOAD_ACCEPT} disabled={isUploading || loading} className="hidden" aria-label="Choose a document or image"
        onChange={(event) => handleFiles(event.target.files)} />
      <button className={buttonClass} disabled={isUploading || loading} onClick={() => fileInputRef.current?.click()}>{isUploading ? 'Uploading…' : 'Upload file'}</button>
      <p className="mt-2 text-sm text-gray-600">or drag and drop one file here</p>
      <p className="mt-2 text-xs text-gray-500">{UPLOAD_HELP}</p>
      <p className="mt-1 text-xs text-gray-500">Convert older DOC files to PDF or DOCX before uploading. Files open through downloads.</p>
      {isUploading && <p role="status" className="mt-3 text-sm text-blue-700">Checking and uploading your file…</p>}
    </div>
    <div className="flex items-center justify-between">
      <h2 className="font-medium">Your files</h2>
      <button className={buttonClass} disabled={loading || isUploading || !!deleting} onClick={loadFiles}>Refresh files</button>
    </div>
    {loading ? <p role="status">Loading files…</p> : files.length === 0 ? <p className="rounded-lg border bg-white p-6 text-gray-500">No files uploaded yet.</p> : <ul className="divide-y rounded-lg border bg-white">
      {files.map((file) => <li key={file.id} data-upload-id={file.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><p className="break-words font-medium text-gray-900">{file.name}</p><p className="mt-1 text-sm text-gray-500">{file.size} · {new Date(file.uploadDate).toLocaleDateString()}</p></div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button className={buttonClass} onClick={() => setDetailFile(file)}>Details</button>
          <a className={buttonClass} href={downloadPath(file)} download>Download</a>
          <button className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700 disabled:opacity-50" disabled={!!deleting} onClick={() => deleteFile(file)}>{deleting === file.id ? 'Deleting…' : 'Delete'}</button>
        </div>
      </li>)}
    </ul>}
    {detailFile && <Modal title="File details" onClose={() => setDetailFile(null)}>
      <dl className="space-y-3 break-words text-sm">
        <div><dt className="text-gray-500">Name</dt><dd>{detailFile.name}</dd></div>
        <div><dt className="text-gray-500">Type</dt><dd>{detailFile.type}</dd></div>
        <div><dt className="text-gray-500">Size</dt><dd>{detailFile.size}</dd></div>
        <div><dt className="text-gray-500">Uploaded</dt><dd>{new Date(detailFile.uploadDate).toLocaleString()}</dd></div>
      </dl>
      <p className="mt-4 text-sm text-gray-500">Download this file to open it on your device.</p>
      <a className={`${buttonClass} mt-4 inline-block`} href={downloadPath(detailFile)} download>Download file</a>
    </Modal>}
  </div>;
}
