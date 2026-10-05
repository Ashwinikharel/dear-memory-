import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import SelfieCamera from '../components/SelfieCamera.jsx';
import { PhotoCanvas } from '../components/SecureCanvas.jsx';

const LivenessCheck = lazy(() => import('../components/LivenessCheck.jsx'));
const block = (e) => e.preventDefault();

export default function Guest() {
  const { token } = useParams();
  const [step, setStep] = useState('loading'); // loading | error | intro | capture | verifying | gallery | ended
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [livenessId, setLivenessId] = useState(null);
  const [session, setSession] = useState(null); // { token, expiresAt }
  const [photos, setPhotos] = useState([]);
  const [hidden, setHidden] = useState(false);
  const cache = useRef(new Map());

  useEffect(() => {
    api.get(`/guest/teams/${encodeURIComponent(token)}`, { token: null })
      .then((r) => { setInfo(r); setStep('intro'); })
      .catch((e) => { setError(e.message); setStep('error'); });
  }, [token]);

  /* ---------- View-only protections for the whole guest page ---------- */
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'u'].includes(e.key.toLowerCase())) e.preventDefault();
    };
    const onVis = () => setHidden(document.visibilityState === 'hidden'); // hides photos in the app switcher
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVis);
    document.body.classList.add('guest-mode');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVis);
      document.body.classList.remove('guest-mode');
    };
  }, []);

  const clearPhotos = useCallback(() => {
    cache.current.forEach((p) => p.then((b) => b.close?.()).catch(() => {}));
    cache.current.clear();
    setPhotos([]);
  }, []);

  const endSession = useCallback(async (reason = '') => {
    if (session) api.post('/guest/logout', null, { token: session.token }).catch(() => {});
    clearPhotos();
    setSession(null);
    setError(reason);
    setStep('ended');
  }, [session, clearPhotos]);

  // End the session when the page is closed
  useEffect(() => {
    if (!session) return undefined;
    const onHide = () => navigator.sendBeacon?.('/api/guest/logout-beacon', new Blob([session.token], { type: 'text/plain' }));
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [session]);

  // Auto-end at expiry
  useEffect(() => {
    if (!session) return undefined;
    const ms = new Date(session.expiresAt).getTime() - Date.now();
    const t = setTimeout(() => endSession('Your viewing time is over. Scan the QR code again to see your photos.'), Math.max(ms, 0));
    return () => clearTimeout(t);
  }, [session, endSession]);

  /* ---------- Loading photos as ImageBitmaps (memory only, no URLs) ---------- */
  const load = useCallback((id) => {
    if (!cache.current.has(id)) {
      const p = api.blob(`/guest/photos/${id}/image`, { token: session?.token })
        .then((blob) => createImageBitmap(blob))
        .catch((e) => {
          cache.current.delete(id);
          if (e.status === 401) endSession('Your viewing session has ended. Scan the QR code again.');
          throw e;
        });
      cache.current.set(id, p);
    }
    return cache.current.get(id);
  }, [session, endSession]);

  /* ---------- Verification ---------- */
  async function startCapture() {
    setError('');
    if (info.livenessMode === 'aws') {
      try {
        const r = await api.post('/guest/liveness-session', { token }, { token: null });
        setLivenessId(r.sessionId);
      } catch (e) { setError(e.message); return; }
    }
    setStep('capture');
  }

  async function verify({ selfie, livenessSessionId }) {
    setStep('verifying'); setError('');
    const form = new FormData();
    form.append('token', token);
    form.append('consent', String(consent));
    if (selfie) form.append('selfie', selfie, 'selfie.jpg');
    if (livenessSessionId) form.append('livenessSessionId', livenessSessionId);
    try {
      const r = await api.post('/guest/verify', form, { token: null });
      const list = await api.get('/guest/photos', { token: r.token });
      setSession({ token: r.token, expiresAt: r.expiresAt });
      setPhotos(list.photos);
      setStep('gallery');
    } catch (e) {
      setError(e.message);
      setLivenessId(null);
      setStep('intro');
    }
  }

  async function forgetMe() {
    if (!confirm('Delete your face data from this event? You will not be able to find your photos with a selfie again.')) return;
    try { await api.post('/guest/forget-me', null, { token: session.token }); } catch { /* session may have ended */ }
    clearPhotos();
    setSession(null);
    setError('Your face data has been deleted from this event.');
    setStep('ended');
  }

  /* ---------- Screens ---------- */
  return (
    <div className={`guest ${hidden ? 'veiled' : ''}`} onContextMenu={block} onDragStart={block}>
      <header className="guest-head">
        <span className="brand">Dear Memory</span>
        {info && <span className="guest-event">{info.eventName} · {info.teamName}</span>}
      </header>

      {step === 'loading' && <div className="guest-center muted">Loading…</div>}

      {step === 'error' && (
        <div className="guest-center"><div className="guest-card"><h2>Can't open this QR code</h2><p>{error}</p></div></div>
      )}

      {step === 'intro' && info && (
        <div className="guest-center">
          <div className="guest-card">
            <h1 className="display">Find your photos</h1>
            <p>Take a quick selfie and we'll show you the photos from <strong>{info.teamName}</strong> that you appear in.</p>
            <div className="consent">
              <h3>Before we start</h3>
              <ul>
                <li>Your selfie is compared with faces in this team's photos, then <strong>immediately discarded</strong>. It is never saved.</li>
                <li>Faces found in the event photos are deleted automatically {info.retentionDays} days after the event ends.</li>
                <li>You can <strong>view</strong> your photos for {info.sessionMinutes} minutes. Downloading is not available.</li>
                <li>You can delete your face data at any time from the photo page.</li>
              </ul>
              <label className="check">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                I agree to use my face to find my photos.
              </label>
            </div>
            {error && <p className="error">{error}</p>}
            <button className="btn primary big" disabled={!consent} onClick={startCapture}>Continue</button>
            {info.mock && <p className="small warn-text">Test mode: face matching is simulated.</p>}
          </div>
        </div>
      )}

      {step === 'capture' && (
        <div className="guest-center">
          <div className="guest-card">
            <h2>{info.livenessMode === 'aws' ? 'Quick face check' : 'Take a selfie'}</h2>
            {info.livenessMode === 'aws' && livenessId ? (
              <Suspense fallback={<p className="muted">Starting camera…</p>}>
                <LivenessCheck
                  sessionId={livenessId}
                  region={info.region}
                  onComplete={() => verify({ livenessSessionId: livenessId })}
                  onCancel={() => { setLivenessId(null); setStep('intro'); }}
                  onError={(msg) => { setError(msg); setLivenessId(null); setStep('intro'); }}
                />
              </Suspense>
            ) : (
              <SelfieCamera onCapture={(blob) => verify({ selfie: blob })} />
            )}
            <button className="link" onClick={() => { setLivenessId(null); setStep('intro'); }}>Back</button>
          </div>
        </div>
      )}

      {step === 'verifying' && (
        <div className="guest-center"><div className="guest-card center"><div className="spinner" /><p>Looking for you in the photos…</p></div></div>
      )}

      {step === 'gallery' && session && (
        <Gallery photos={photos} load={load} expiresAt={session.expiresAt} onDone={() => endSession('')} onForget={forgetMe} />
      )}

      {step === 'ended' && (
        <div className="guest-center">
          <div className="guest-card center">
            <h2>Thank you</h2>
            <p>{error || 'Your viewing session has ended.'}</p>
            <button className="btn" onClick={() => { setError(''); setConsent(false); setStep('intro'); }}>Start again</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Gallery({ photos, load, expiresAt, onDone, onForget }) {
  const [open, setOpen] = useState(null); // index
  const left = useCountdown(expiresAt);

  return (
    <div className="gallery">
      <div className="gallery-bar">
        <span>{photos.length} photo{photos.length === 1 ? '' : 's'} of you</span>
        <span className="timer" title="Time left to view">{left}</span>
        <button className="btn small" onClick={onDone}>Done</button>
      </div>
      <div className="gallery-grid">
        {photos.map((p, i) => (
          <button key={p.id} className="gallery-item" onClick={() => setOpen(i)} aria-label={`Open photo ${i + 1}`}>
            <PhotoCanvas photoId={p.id} load={load} fit="cover" className="gallery-canvas" />
          </button>
        ))}
      </div>
      <p className="small muted center">Photos are view-only and protected by Dear Memory.</p>
      <button className="link small center-block" onClick={onForget}>Delete my face data</button>
      {open !== null && <Viewer photos={photos} index={open} setIndex={setOpen} load={load} />}
    </div>
  );
}

function Viewer({ photos, index, setIndex, load }) {
  const touchX = useRef(null);
  const prev = useCallback(() => setIndex((i) => (i > 0 ? i - 1 : i)), [setIndex]);
  const next = useCallback(() => setIndex((i) => (i < photos.length - 1 ? i + 1 : i)), [setIndex, photos.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setIndex(null);
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, setIndex]);

  return (
    <div
      className="viewer"
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - (touchX.current ?? 0);
        if (Math.abs(dx) > 50) (dx > 0 ? prev : next)();
      }}
    >
      <PhotoCanvas photoId={photos[index].id} load={load} fit="contain" className="viewer-canvas" />
      <button className="viewer-close" onClick={() => setIndex(null)} aria-label="Close">×</button>
      {index > 0 && <button className="viewer-nav left" onClick={prev} aria-label="Previous">‹</button>}
      {index < photos.length - 1 && <button className="viewer-nav right" onClick={next} aria-label="Next">›</button>}
      <span className="viewer-count">{index + 1} / {photos.length}</span>
    </div>
  );
}

function useCountdown(until) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
