import { useEffect, useRef, useState } from 'react';

/** Live front-camera selfie. Only camera capture is allowed (no gallery upload), to make photo-of-a-photo harder. */
export default function SelfieCamera({ onCapture, busy }) {
  const video = useRef(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    let stream;
    (async () => {
      if (!window.isSecureContext) {
        setError('The camera only works on a secure (https://) link. Ask the organiser for the https QR code.');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Your browser cannot open the camera. Open this page in Chrome or Safari.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false,
        });
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play();
          setReady(true);
        }
      } catch (e) {
        setError(e.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in your browser settings, then reload.'
          : 'Could not open the camera. Close other apps using it and try again.');
      }
    })();
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const t = setTimeout(() => {
      if (countdown === 1) capture();
      setCountdown(countdown - 1);
    }, 700);
    return () => clearTimeout(t);
  }, [countdown]);

  function capture() {
    const v = video.current;
    if (!v?.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0); // un-mirrored, as the camera sees it
    c.toBlob((blob) => blob && onCapture(blob), 'image/jpeg', 0.92);
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <div className="camera">
      <div className="camera-frame">
        <video ref={video} playsInline muted />
        <div className="face-guide" aria-hidden="true" />
        {countdown > 0 && <div className="countdown">{countdown}</div>}
      </div>
      <p className="small muted center">Face the camera in good light. Remove sunglasses or masks.</p>
      <button className="btn primary big" disabled={!ready || busy || countdown > 0} onClick={() => setCountdown(3)}>
        {busy ? 'Checking…' : 'Take selfie'}
      </button>
    </div>
  );
}
