import { useEffect, useState } from 'react';
import { api, downloadProtected, fmtBytes } from '../api.js';

/** Photographer view of a team's photos: status, preview, original download, retry, delete. */
export default function TeamPhotos({ teamId, onChange }) {
  const [photos, setPhotos] = useState(null);
  const [error, setError] = useState('');

  const load = () => api.get(`/teams/${teamId}/photos`).then((r) => setPhotos(r.photos)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [teamId]);

  // Poll while anything is still processing
  useEffect(() => {
    if (!photos?.some((p) => p.status === 'pending' || p.status === 'processing')) return;
    const t = setTimeout(load, 3000);
    return () => clearTimeout(t);
  }, [photos]);

  const act = (fn) => async () => { try { await fn(); load(); onChange?.(); } catch (e) { setError(e.message); } };

  if (!photos) return <p className="muted small">Loading photos…</p>;
  if (!photos.length) return <p className="muted small">No photos yet.</p>;

  return (
    <>
      {error && <p className="error small">{error}</p>}
      <div className="photo-grid">
        {photos.map((p) => (
          <figure key={p.id} className="photo-tile">
            {p.status === 'done' ? <Thumb id={p.id} /> : <div className={`thumb-status ${p.status}`}>{p.status}</div>}
            <figcaption>
              <span className="small" title={p.original_name}>{p.original_name}</span>
              <span className="small muted">{fmtBytes(p.size_bytes)} · {p.faces_count} faces</span>
              {p.error && <span className="error small" title={p.error}>Failed: {p.error.slice(0, 60)}</span>}
              <span className="btn-row">
                <button className="link small" onClick={() => downloadProtected(`/photos/${p.id}/original`, p.original_name || `${p.id}.jpg`)}>Original</button>
                {p.status === 'failed' && <button className="link small" onClick={act(() => api.post(`/photos/${p.id}/retry`))}>Retry</button>}
                <button className="link small danger-text" onClick={act(() => confirm('Delete this photo and its face data?') && api.del(`/photos/${p.id}`))}>Delete</button>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </>
  );
}

function Thumb({ id }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url;
    api.blob(`/photos/${id}/preview`).then((b) => { url = URL.createObjectURL(b); setSrc(url); }).catch(() => {});
    return () => url && URL.revokeObjectURL(url);
  }, [id]);
  return src ? <img src={src} alt="" loading="lazy" /> : <div className="thumb-status">…</div>;
}
