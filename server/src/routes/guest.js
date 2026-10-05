import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { db, audit } from '../db.js';
import { config } from '../config.js';
import { storage, faces, isMock } from '../aws.js';
import { HttpError, requireGuest, signGuestToken, loadGuestSession } from '../middleware/auth.js';
import { normaliseSelfie } from '../services/images.js';
import { photosForMatches } from '../services/matching.js';

export const guestRouter = Router();

// Selfie is kept in memory only and discarded after matching. Never written to disk or S3.
const selfieUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

// 5 face verification attempts per 10 minutes per IP
const verifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait 10 minutes and try again.' },
});
const lookupLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

/** Validates a QR token and returns { qr, team, event } or throws a friendly error. */
function resolveToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 64) throw new HttpError(404, 'This QR code is not valid.');
  const row = db.prepare(`
    SELECT q.*, t.name AS team_name, t.id AS team_id, e.id AS event_id, e.name AS event_name,
           e.collection_id, e.faces_purged, e.ends_at
    FROM qr_codes q JOIN teams t ON t.id = q.team_id JOIN events e ON e.id = t.event_id
    WHERE q.token = ?`).get(token);
  if (!row) throw new HttpError(404, 'This QR code is not valid.');
  if (row.disabled) throw new HttpError(410, 'This QR code has been turned off. Ask the photographer for a new one.');
  if (row.expires_at && new Date(row.expires_at) <= new Date()) throw new HttpError(410, 'This QR code has expired.');
  if (row.faces_purged) throw new HttpError(410, 'Photos for this event are no longer available.');
  return row;
}

guestRouter.get('/guest/teams/:token', lookupLimiter, (req, res) => {
  const t = resolveToken(req.params.token);
  res.json({
    eventName: t.event_name,
    teamName: t.team_name,
    livenessMode: config.livenessMode,
    region: config.aws.region,
    retentionDays: config.retentionDays,
    sessionMinutes: config.guestSessionMinutes,
    mock: isMock,
  });
});

// Step 1 (aws liveness mode): server creates the liveness session; the browser runs the check with it.
guestRouter.post('/guest/liveness-session', verifyLimiter, async (req, res) => {
  if (config.livenessMode !== 'aws') throw new HttpError(400, 'Liveness sessions are not enabled');
  const t = resolveToken(req.body?.token);
  const sessionId = await faces.createLivenessSession();
  db.prepare('INSERT INTO liveness_sessions (id, team_id) VALUES (?,?)').run(sessionId, t.team_id);
  res.json({ sessionId });
});

// Step 2: verify the face and open a short, view-only session.
guestRouter.post('/guest/verify', verifyLimiter, selfieUpload.single('selfie'), async (req, res) => {
  const t = resolveToken(req.body?.token);
  if (req.body?.consent !== 'true') throw new HttpError(400, 'Please accept the consent notice first.');

  let probe; // the face image we search with (memory only)
  if (config.livenessMode === 'aws') {
    const sessionId = String(req.body?.livenessSessionId || '');
    const ls = db.prepare('SELECT * FROM liveness_sessions WHERE id = ?').get(sessionId);
    if (!ls || ls.team_id !== t.team_id) throw new HttpError(400, 'Liveness check not found. Please try again.');
    if (ls.used) throw new HttpError(400, 'This liveness check was already used. Please try again.');
    db.prepare('UPDATE liveness_sessions SET used = 1 WHERE id = ?').run(sessionId); // no replay
    const result = await faces.getLivenessResult(sessionId);
    if (result.status !== 'SUCCEEDED' || result.confidence < config.livenessMinConfidence || !result.referenceImage) {
      audit({ actorType: 'guest', action: 'liveness_failed', target: t.team_id, meta: { confidence: result.confidence }, ip: req.ip });
      throw new HttpError(403, "We couldn't confirm it's really you. Please try again in good light.");
    }
    probe = result.referenceImage;
  } else {
    if (!req.file) throw new HttpError(400, 'Please take a selfie.');
    probe = await normaliseSelfie(req.file.buffer);
    const check = await faces.checkSelfie(probe);
    if (!check.ok) throw new HttpError(422, check.reason);
  }

  const matches = await faces.searchByImage(t.collection_id, probe, faces.threshold);
  probe = null; req.file = undefined; // drop selfie from memory

  const teamFaces = db.prepare(`
    SELECT f.face_id, f.photo_id FROM face_embeddings f JOIN photos p ON p.id = f.photo_id
    WHERE f.team_id = ? AND p.status = 'done'`).all(t.team_id);
  const { photoIds, faceIds } = photosForMatches(matches, teamFaces, faces.threshold, { mock: isMock });

  if (!photoIds.length) {
    audit({ actorType: 'guest', action: 'face_no_match', target: t.team_id, ip: req.ip });
    throw new HttpError(404, "We couldn't find you in this team's photos yet. If photos are still being uploaded, try again later.");
  }

  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + config.guestSessionMinutes * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO guest_sessions (id, team_id, photo_ids, matched_face_ids, ip, user_agent, expires_at)
              VALUES (?,?,?,?,?,?,?)`)
    .run(id, t.team_id, JSON.stringify(photoIds), JSON.stringify(faceIds), req.ip ?? null,
      String(req.headers['user-agent'] || '').slice(0, 300), expiresAt);
  audit({ actorType: 'guest', actorId: id, action: 'face_verified', target: t.team_id, meta: { photos: photoIds.length }, ip: req.ip });

  res.json({ token: signGuestToken(id, config.guestSessionMinutes), expiresAt, count: photoIds.length });
});

guestRouter.get('/guest/photos', requireGuest, (req, res) => {
  const ids = req.guest.photoIds;
  const rows = ids.length
    ? db.prepare(`SELECT id, width, height FROM photos WHERE status = 'done' AND id IN (${ids.map(() => '?').join(',')})
                  ORDER BY created_at`).all(...ids)
    : [];
  const team = db.prepare(`SELECT t.name AS team_name, e.name AS event_name FROM teams t JOIN events e ON e.id = t.event_id
                           WHERE t.id = ?`).get(req.guest.team_id);
  res.json({ photos: rows, expiresAt: req.guest.expires_at, ...team });
});

// View-only image stream: watermarked, reduced-size preview. Never the original.
guestRouter.get('/guest/photos/:id/image', requireGuest, async (req, res) => {
  if (!req.guest.photoIds.includes(req.params.id)) throw new HttpError(404, 'Photo not found');
  const photo = db.prepare("SELECT id, preview_key FROM photos WHERE id = ? AND status = 'done'").get(req.params.id);
  if (!photo?.preview_key) throw new HttpError(404, 'Photo not found');
  db.prepare('INSERT INTO photo_views (session_id, photo_id) VALUES (?,?)').run(req.guest.id, photo.id);
  res.set({
    'Cache-Control': 'no-store, private',
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
  });
  res.type('image/jpeg').send(await storage.get(photo.preview_key));
});

function endSession(session) {
  db.prepare("UPDATE guest_sessions SET ended_at = datetime('now') WHERE id = ? AND ended_at IS NULL").run(session.id);
}

guestRouter.post('/guest/logout', requireGuest, (req, res) => {
  endSession(req.guest);
  res.status(204).end();
});

// Used by navigator.sendBeacon when the page is closed (beacons can't send headers).
guestRouter.post('/guest/logout-beacon', (req, res) => {
  try { endSession(loadGuestSession(typeof req.body === 'string' ? req.body : req.body?.token)); } catch { /* already ended */ }
  res.status(204).end();
});

// Guest asks to remove their face from the index: matched faces are deleted from Rekognition.
guestRouter.post('/guest/forget-me', requireGuest, async (req, res) => {
  const faceIds = JSON.parse(req.guest.matched_face_ids);
  const ev = db.prepare('SELECT e.* FROM events e JOIN teams t ON t.event_id = e.id WHERE t.id = ?').get(req.guest.team_id);
  if (faceIds.length) {
    if (!ev.faces_purged) await faces.deleteFaces(ev.collection_id, faceIds);
    db.prepare(`DELETE FROM face_embeddings WHERE face_id IN (${faceIds.map(() => '?').join(',')})`).run(...faceIds);
  }
  endSession(req.guest);
  audit({ actorType: 'guest', actorId: req.guest.id, action: 'face_data_deleted', target: req.guest.team_id, meta: { faces: faceIds.length }, ip: req.ip });
  res.json({ ok: true });
});
