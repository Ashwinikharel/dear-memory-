// Pure helpers for turning Rekognition matches into the photo list a guest may see.

/**
 * @param {{faceId:string, similarity:number}[]} matches  result of searchByImage over the EVENT collection
 * @param {{face_id:string, photo_id:string}[]} teamFaces   faces indexed from THIS team's photos
 * @param {number} threshold
 * @returns {{photoIds:string[], faceIds:string[]}}
 */
export function photosForMatches(matches, teamFaces, threshold, { mock = false } = {}) {
  const byFace = new Map(teamFaces.map((f) => [f.face_id, f.photo_id]));
  const faceIds = new Set();
  const photoIds = new Set();
  for (const m of matches) {
    if (m.similarity < threshold) continue;
    if (mock && m.faceId === '*') {
      teamFaces.forEach((f) => { faceIds.add(f.face_id); photoIds.add(f.photo_id); });
      continue;
    }
    const photoId = byFace.get(m.faceId);
    // Faces from other teams' photos are ignored: a guest only ever sees their own team's photos.
    if (photoId) { faceIds.add(m.faceId); photoIds.add(photoId); }
  }
  return { photoIds: [...photoIds], faceIds: [...faceIds] };
}

/* ---------- Local (free) engine math ---------- */

export function euclidean(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; sum += d * d; }
  return Math.sqrt(sum);
}

/** Face distance (0 = identical) -> similarity percent, so both engines share one threshold scale. */
export const similarityFromDistance = (d) => Math.max(0, Math.min(100, (1 - d) * 100));

/**
 * Compares one probe descriptor with stored ones.
 * @param {ArrayLike<number>} probe
 * @param {{faceId:string, descriptor:ArrayLike<number>}[]} stored
 * @param {number} maxDistance
 * @returns {{faceId:string, similarity:number}[]} best first
 */
export function matchDescriptors(probe, stored, maxDistance) {
  const out = [];
  for (const s of stored) {
    const d = euclidean(probe, s.descriptor);
    if (d <= maxDistance) out.push({ faceId: s.faceId, similarity: similarityFromDistance(d) });
  }
  return out.sort((x, y) => y.similarity - x.similarity);
}
