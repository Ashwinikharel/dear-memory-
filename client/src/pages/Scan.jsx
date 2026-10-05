import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

/** Pulls the team token out of a scanned QR / pasted link: https://<site>/t/<token> */
export function tokenFromText(text) {
  const m = String(text || '').trim().match(/\/t\/([A-Za-z0-9_-]{20,64})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

/** In-app QR scanner, so guests who installed the app can scan without leaving it. */
export default function Scan() {
  const navigate = useNavigate();
  const video = useRef(null);
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');

  useEffect(() => {
    document.body.classList.add('guest-mode');
    let stream; let raf; let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError('The camera needs a secure (https://) connection. You can paste the link below instead.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch {
        setError('Camera permission is needed to scan. You can also use your phone camera app, or paste the link below.');
        return;
      }
      video.current.srcObject = stream;
      await video.current.play().catch(() => {});

      // Fast native detector where available (Android Chrome); jsQR everywhere else (iPhone).
      let detect;
      if ('BarcodeDetector' in window) {
        const bd = new window.BarcodeDetector({ formats: ['qr_code'] });
        detect = async () => (await bd.detect(video.current))[0]?.rawValue;
      } else {
        const jsQR = (await import('jsqr')).default;
        detect = async () => {
          const v = video.current;
          const w = 640; const h = Math.round((v.videoHeight / v.videoWidth) * w) || 480;
          canvas.width = w; canvas.height = h;
          ctx.drawImage(v, 0, 0, w, h);
          return jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data;
        };
      }

      const tick = async () => {
        if (stopped) return;
        if (video.current?.readyState >= 2) {
          try {
            const text = await detect();
            const token = tokenFromText(text);
            if (token) { stopped = true; navigate(`/t/${token}`); return; }
            if (text) setError("That QR code isn't a Dear Memory code.");
          } catch { /* keep scanning */ }
        }
        raf = setTimeout(tick, 250);
      };
      tick();
    })();

    return () => {
      stopped = true;
      clearTimeout(raf);
      stream?.getTracks().forEach((t) => t.stop());
      document.body.classList.remove('guest-mode');
    };
  }, [navigate]);

  function openManual(e) {
    e.preventDefault();
    const token = tokenFromText(manual);
    if (token) navigate(`/t/${token}`);
    else setError("That doesn't look like a Dear Memory link.");
  }

  return (
    <div className="guest">
      <header className="guest-head">
        <Link to="/welcome" className="brand">Dear Memory</Link>
        <span className="guest-event">Scan QR code</span>
      </header>
      <div className="guest-center">
        <div className="guest-card">
          <h2>Scan your team's QR code</h2>
          <div className="camera-frame scan-frame">
            <video ref={video} playsInline muted />
            <div className="scan-guide" aria-hidden="true" />
          </div>
          {error && <p className="error small">{error}</p>}
          <form onSubmit={openManual} className="stack">
            <label className="small">Or paste the link
              <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="https://…/t/…" />
            </label>
            <button className="btn">Open</button>
          </form>
        </div>
      </div>
    </div>
  );
}
