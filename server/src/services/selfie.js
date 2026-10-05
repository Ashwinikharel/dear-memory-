// Basic selfie quality rules (LIVENESS_MODE=basic). Pure function so it can be unit tested.
// NOTE: this is NOT anti-spoofing. Use LIVENESS_MODE=aws in production.
export function evaluateSelfie(faceDetails) {
  if (faceDetails.length === 0) return { ok: false, reason: 'No face found. Look straight at the camera in good light.' };
  if (faceDetails.length > 1) return { ok: false, reason: 'More than one face found. Only you should be in the selfie.' };
  const f = faceDetails[0];
  if ((f.Confidence ?? 0) < 95) return { ok: false, reason: 'Face not clear enough. Try again in better light.' };
  if (f.EyesOpen && f.EyesOpen.Value === false) return { ok: false, reason: 'Please keep your eyes open.' };
  if (f.Quality && (f.Quality.Sharpness < 30 || f.Quality.Brightness < 25)) {
    return { ok: false, reason: 'Photo is too blurry or too dark. Try again.' };
  }
  const pose = f.Pose || {};
  if (Math.abs(pose.Yaw ?? 0) > 30 || Math.abs(pose.Pitch ?? 0) > 30) {
    return { ok: false, reason: 'Please face the camera directly.' };
  }
  if (f.Sunglasses?.Value) return { ok: false, reason: 'Please remove sunglasses.' };
  return { ok: true };
}

