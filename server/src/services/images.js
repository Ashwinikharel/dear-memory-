import sharp from 'sharp';

const PREVIEW_MAX = 1280; // guests only ever receive this reduced size
const INDEX_MAX = 1920;   // sent to Rekognition (must stay under 5 MB)

const escapeXml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
}[c]));

export function watermarkSvg(width, height, text) {
  const fs = Math.max(14, Math.round(Math.max(width, height) / 32));
  const t = escapeXml(text);
  const tileW = Math.round(fs * (t.length * 0.62 + 4));
  const tileH = fs * 5;
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="wm" width="${tileW}" height="${tileH}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
      <text x="0" y="${fs * 2}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fs}" font-weight="700"
            fill="#ffffff" fill-opacity="0.22">${t}</text>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#wm)"/>
  <text x="${width - fs}" y="${height - fs}" text-anchor="end" font-family="DejaVu Sans, Arial, sans-serif"
        font-size="${Math.round(fs * 1.1)}" font-weight="700" fill="#ffffff" fill-opacity="0.85"
        stroke="#000000" stroke-opacity="0.35" stroke-width="1">${t}</text>
</svg>`);
}

/** Throws if the buffer is not a real image. Returns basic metadata. */
export async function inspectImage(buffer) {
  const meta = await sharp(buffer, { failOn: 'error' }).metadata();
  if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error(`Unsupported image format: ${meta.format}`);
  return meta;
}

/**
 * Builds the two derived images for one uploaded photo:
 *  - preview: reduced size, watermarked, metadata (EXIF/GPS) stripped -> the only version guests see
 *  - index:   clean, reduced size -> sent to Rekognition for face indexing, never stored
 */
export async function buildVariants(originalBuffer, watermarkText) {
  const resized = await sharp(originalBuffer, { failOn: 'error' })
    .rotate() // apply EXIF orientation, then metadata is dropped (sharp strips it by default)
    .resize({ width: PREVIEW_MAX, height: PREVIEW_MAX, fit: 'inside', withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });

  const { width, height } = resized.info;
  const preview = await sharp(resized.data)
    .composite([{ input: watermarkSvg(width, height, watermarkText), top: 0, left: 0 }])
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

  const index = await sharp(originalBuffer)
    .rotate()
    .resize({ width: INDEX_MAX, height: INDEX_MAX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  return { preview, index, width, height };
}

/** Normalises a selfie for Rekognition: orientation fixed, size limited, metadata stripped. */
export async function normaliseSelfie(buffer) {
  return sharp(buffer, { failOn: 'error' })
    .rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
}
