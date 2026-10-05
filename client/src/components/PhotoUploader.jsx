import { useRef, useState } from 'react';
import { uploadWithProgress } from '../api.js';

const BATCH = 5;
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

/** Drag-and-drop bulk uploader. Sends photos in small batches with progress; failed files can be retried. */
export default function PhotoUploader({ teamId, onUploaded }) {
  const input = useRef(null);
  const [drag, setDrag] = useState(false);
  const [state, setState] = useState(null); // { total, done, progress, failed: File[], errors: string[] }

  async function uploadFiles(fileList) {
    const files = [...fileList].filter((f) => ACCEPT.includes(f.type));
    const skipped = fileList.length - files.length;
    if (!files.length) { setState({ total: 0, done: 0, progress: 1, failed: [], errors: ['Only JPEG, PNG or WebP photos can be uploaded.'] }); return; }

    let done = 0;
    const failed = [];
    const errors = skipped ? [`${skipped} file(s) skipped (not JPEG/PNG/WebP).`] : [];
    setState({ total: files.length, done: 0, progress: 0, failed, errors });

    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      const form = new FormData();
      batch.forEach((f) => form.append('photos', f, f.name));
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        try {
          const r = await uploadWithProgress(`/teams/${teamId}/photos`, form, (p) =>
            setState((s) => ({ ...s, progress: (done + p * batch.length) / files.length })));
          r.results.forEach((res, idx) => {
            if (!res.ok) { failed.push(batch[idx]); errors.push(`${res.name}: ${res.error}`); }
          });
          ok = true;
        } catch (e) {
          if (attempt === 3 || e.status === 401 || e.status === 403) { failed.push(...batch); errors.push(e.message); break; }
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
      done += batch.length;
      setState({ total: files.length, done, progress: done / files.length, failed: [...failed], errors: [...errors] });
    }
    onUploaded?.();
  }

  const uploading = state && state.done < state.total;

  return (
    <div
      className={`dropzone ${drag ? 'drag' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (!uploading) uploadFiles(e.dataTransfer.files); }}
    >
      <input ref={input} type="file" multiple accept={ACCEPT.join(',')} hidden
        onChange={(e) => { uploadFiles(e.target.files); e.target.value = ''; }} />
      {!uploading && (
        <p>Drop photos here or <button className="link" onClick={() => input.current.click()}>choose files</button></p>
      )}
      {state && (
        <div className="upload-status">
          <div className="progress"><div style={{ width: `${Math.round(state.progress * 100)}%` }} /></div>
          <p className="small">{uploading ? `Uploading ${state.done} / ${state.total}…` : `Uploaded ${state.total - state.failed.length} of ${state.total}. Faces are being found in the background.`}</p>
          {state.errors.length > 0 && <ul className="error small">{state.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}</ul>}
          {!uploading && state.failed.length > 0 && (
            <button className="btn small" onClick={() => uploadFiles(state.failed)}>Retry {state.failed.length} failed</button>
          )}
        </div>
      )}
    </div>
  );
}
