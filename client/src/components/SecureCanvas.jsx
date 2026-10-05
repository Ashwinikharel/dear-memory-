import { useEffect, useRef, useState } from 'react';

const block = (e) => e.preventDefault();

/**
 * Draws a photo onto a <canvas> instead of an <img>, so the browser offers no
 * "Save image" / "Open image in new tab" and there is no image URL to copy.
 */
export function SecureCanvas({ bitmap, fit = 'cover', className = '' }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !bitmap) return undefined;
    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d');
      const scale = fit === 'cover'
        ? Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height)
        : Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
      const w = bitmap.width * scale;
      const h = bitmap.height * scale;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [bitmap, fit]);

  return <canvas ref={ref} className={`secure-canvas ${className}`} onContextMenu={block} onDragStart={block} />;
}

/** Loads a photo (via the provided loader, which caches ImageBitmaps) and draws it. */
export function PhotoCanvas({ photoId, load, fit, className }) {
  const [bitmap, setBitmap] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setBitmap(null); setFailed(false);
    load(photoId).then((b) => alive && setBitmap(b)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [photoId, load]);

  if (failed) return <div className={`canvas-placeholder ${className || ''}`}>Couldn't load</div>;
  if (!bitmap) return <div className={`canvas-placeholder shimmer ${className || ''}`} />;
  return <SecureCanvas bitmap={bitmap} fit={fit} className={className} />;
}
