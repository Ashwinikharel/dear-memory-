import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import QRCode from 'qrcode';
import { db, audit } from '../db.js';
import { config } from '../config.js';
import { storage, collectionIdFor, faces } from '../aws.js';
import { requireStaff, requireAdmin, assertEventAccess, assertTeamAccess, HttpError } from '../middleware/auth.js';
import { inspectImage } from '../services/images.js';
import { enqueuePhoto, queueStats } from '../services/faceWorker.js';
import { purgeEvent, purgeTeam } from '../services/purge.js';

export const eventsRouter = Router();
eventsRouter.use(['/events', '/teams', '/photos', '/audit', '/admin'], requireStaff);

const newToken = () => crypto.randomBytes(24).toString('base64url'); // 192 bits, unguessable
// Where the QR code points. If PUBLIC_APP_URL is a localhost address (development), the link is
// built from the address the photographer is using right now (e.g. a phone tunnel or Wi-Fi IP),
// so QR codes work on phones without editing .env.
const isLocal = (u) => /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(u);
function appBaseUrl(req) {
  if (!isLocal(config.publicAppUrl) || !req) return config.publicAppUrl;
  const host = req.get('x-forwarded-host') || req.get('host');
  if (!host || !/^[a-z0-9.\-:\[\]]+$/i.test(host)) return config.publicAppUrl;
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  return `${proto === 'https' ? 'https' : 'http'}://${host}`;
}
const qrUrl = (token, req) => `${appBaseUrl(req)}/t/${token}`;
const isDate = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const cleanName = (s, field) => {
  if (typeof s !== 'string' || !s.trim() || s.length > 120) throw new HttpError(400, `${field} is required (max 120 characters)`);
  return s.trim();
};

function activeQr(teamId) {
  return db.prepare('SELECT * FROM qr_codes WHERE team_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(teamId);
}

function createQr(teamId, expiresAt = null) {
  db.prepare('UPDATE qr_codes SET disabled = 1 WHERE team_id = ?').run(teamId);
  const qr = { id: crypto.randomUUID(), token: newToken() };
  db.prepare('INSERT INTO qr_codes (id, team_id, token, expires_at) VALUES (?,?,?,?)').run(qr.id, teamId, qr.token, expiresAt);
  return activeQr(teamId);
}

const qrView = (qr, req) => qr && ({
  url: qrUrl(qr.token, req), expiresAt: qr.expires_at, disabled: !!qr.disabled, createdAt: qr.created_at,
});

/* ------------------------------ Events ------------------------------ */

eventsRouter.get('/events', (req, res) => {
  const sql = `
    SELECT e.*, u.name AS owner_name,
      (SELECT COUNT(*) FROM teams t WHERE t.event_id = e.id) AS team_count,
      (SELECT COUNT(*) FROM photos p WHERE p.event_id = e.id) AS photo_count
    FROM events e JOIN users u ON u.id = e.owner_id
    ${req.user.role === 'admin' ? '' : 'WHERE e.owner_id = ?'}
    ORDER BY e.created_at DESC`;
  const stmt = db.prepare(sql);
  res.json({ events: req.user.role === 'admin' ? stmt.all() : stmt.all(req.user.id) });
});

eventsRouter.post('/events', async (req, res) => {
  const name = cleanName(req.body?.name, 'Event name');
  const { eventDate = null, endsAt } = req.body || {};
  if (!isDate(endsAt)) throw new HttpError(400, 'End date is required');
  if (eventDate && !isDate(eventDate)) throw new HttpError(400, 'Invalid event date');
  const id = crypto.randomUUID();
  const collectionId = collectionIdFor(id);
  await faces.ensureCollection(collectionId);
  db.prepare('INSERT INTO events (id, owner_id, name, event_date, ends_at, collection_id) VALUES (?,?,?,?,?,?)')
    .run(id, req.user.id, name, eventDate, new Date(endsAt).toISOString(), collectionId);
  audit({ actorType: 'staff', actorId: req.user.id, action: 'event_created', target: id, ip: req.ip });
  res.status(201).json({ event: db.prepare('SELECT * FROM events WHERE id = ?').get(id) });
});

eventsRouter.get('/events/:id', (req, res) => {
  const event = assertEventAccess(req.user, req.params.id);
  const teams = db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM photos p WHERE p.team_id = t.id) AS photo_count,
      (SELECT COUNT(*) FROM photos p WHERE p.team_id = t.id AND p.status = 'done') AS processed_count,
      (SELECT COUNT(*) FROM photos p WHERE p.team_id = t.id AND p.status = 'failed') AS failed_count,
      (SELECT COALESCE(SUM(p.faces_count),0) FROM photos p WHERE p.team_id = t.id) AS face_count,
      (SELECT COUNT(*) FROM guest_sessions g WHERE g.team_id = t.id) AS guest_count
    FROM teams t WHERE t.event_id = ? ORDER BY t.created_at`).all(event.id)
    .map((t) => ({ ...t, qr: qrView(activeQr(t.id), req) }));
  res.json({ event, teams, retentionDays: config.retentionDays });
});

eventsRouter.patch('/events/:id', (req, res) => {
  const event = assertEventAccess(req.user, req.params.id);
  const name = req.body?.name !== undefined ? cleanName(req.body.name, 'Event name') : event.name;
  const endsAt = req.body?.endsAt !== undefined ? req.body.endsAt : event.ends_at;
  if (!isDate(endsAt)) throw new HttpError(400, 'Invalid end date');
  db.prepare('UPDATE events SET name = ?, ends_at = ? WHERE id = ?').run(name, new Date(endsAt).toISOString(), event.id);
  res.json({ event: db.prepare('SELECT * FROM events WHERE id = ?').get(event.id) });
});

eventsRouter.delete('/events/:id', async (req, res) => {
  const event = assertEventAccess(req.user, req.params.id);
  await purgeEvent(event.id);
  audit({ actorType: 'staff', actorId: req.user.id, action: 'event_deleted', target: event.id, meta: { name: event.name }, ip: req.ip });
  res.status(204).end();
});

eventsRouter.get('/events/:id/stats', (req, res) => {
  const event = assertEventAccess(req.user, req.params.id);
  const one = (sql) => db.prepare(sql).get(event.id).n;
  res.json({
    photos: one('SELECT COUNT(*) n FROM photos WHERE event_id = ?'),
    faces: one('SELECT COUNT(*) n FROM face_embeddings WHERE event_id = ?'),
    guests: one('SELECT COUNT(*) n FROM guest_sessions g JOIN teams t ON t.id = g.team_id WHERE t.event_id = ?'),
    views: one('SELECT COUNT(*) n FROM photo_views v JOIN photos p ON p.id = v.photo_id WHERE p.event_id = ?'),
    queue: queueStats(),
  });
});

/* ------------------------------ Teams & QR codes ------------------------------ */

eventsRouter.post('/events/:id/teams', (req, res) => {
  const event = assertEventAccess(req.user, req.params.id);
  const name = cleanName(req.body?.name, 'Team name');
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO teams (id, event_id, name) VALUES (?,?,?)').run(id, event.id, name);
  const qr = createQr(id, null);
  audit({ actorType: 'staff', actorId: req.user.id, action: 'team_created', target: id, ip: req.ip });
  res.status(201).json({ team: { ...db.prepare('SELECT * FROM teams WHERE id = ?').get(id), qr: qrView(qr, req) } });
});

eventsRouter.delete('/teams/:id', async (req, res) => {
  const { team, event } = assertTeamAccess(req.user, req.params.id);
  await purgeTeam(team, event);
  audit({ actorType: 'staff', actorId: req.user.id, action: 'team_deleted', target: team.id, ip: req.ip });
  res.status(204).end();
});

eventsRouter.get('/teams/:id/qr', async (req, res) => {
  const { team } = assertTeamAccess(req.user, req.params.id);
  const qr = activeQr(team.id);
  if (!qr) throw new HttpError(404, 'No QR code');
  const format = req.query.format === 'svg' ? 'svg' : 'png';
  const filename = `dear-memory-${team.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.${format}`;
  if (req.query.download === '1') res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  const opts = { errorCorrectionLevel: 'H', margin: 2, width: 1024, color: { dark: '#1f1a17', light: '#ffffff' } };
  if (format === 'svg') {
    res.type('image/svg+xml').send(await QRCode.toString(qrUrl(qr.token, req), { ...opts, type: 'svg' }));
  } else {
    res.type('image/png').send(await QRCode.toBuffer(qrUrl(qr.token, req), opts));
  }
});

eventsRouter.post('/teams/:id/qr/regenerate', (req, res) => {
  const { team } = assertTeamAccess(req.user, req.params.id);
  const expiresAt = req.body?.expiresAt || null;
  if (expiresAt && !isDate(expiresAt)) throw new HttpError(400, 'Invalid expiry date');
  const qr = createQr(team.id, expiresAt ? new Date(expiresAt).toISOString() : null);
  audit({ actorType: 'staff', actorId: req.user.id, action: 'qr_regenerated', target: team.id, ip: req.ip });
  res.json({ qr: qrView(qr, req) });
});

eventsRouter.patch('/teams/:id/qr', (req, res) => {
  const { team } = assertTeamAccess(req.user, req.params.id);
  const qr = activeQr(team.id);
  if (!qr) throw new HttpError(404, 'No QR code');
  const disabled = req.body?.disabled !== undefined ? (req.body.disabled ? 1 : 0) : qr.disabled;
  let expiresAt = req.body?.expiresAt !== undefined ? req.body.expiresAt : qr.expires_at;
  if (expiresAt && !isDate(expiresAt)) throw new HttpError(400, 'Invalid expiry date');
  expiresAt = expiresAt ? new Date(expiresAt).toISOString() : null;
  db.prepare('UPDATE qr_codes SET disabled = ?, expires_at = ? WHERE id = ?').run(disabled, expiresAt, qr.id);
  audit({ actorType: 'staff', actorId: req.user.id, action: disabled ? 'qr_disabled' : 'qr_updated', target: team.id, ip: req.ip });
  res.json({ qr: qrView(activeQr(team.id), req) });
});

/* ------------------------------ Photos ------------------------------ */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

eventsRouter.post('/teams/:id/photos', upload.array('photos', 20), async (req, res) => {
  const { team, event } = assertTeamAccess(req.user, req.params.id);
  const files = req.files || [];
  if (!files.length) throw new HttpError(400, 'No JPEG/PNG/WebP photos received');
  const results = [];
  for (const file of files) {
    try {
      const meta = await inspectImage(file.buffer); // rejects anything that isn't a real image
      const id = crypto.randomUUID();
      const ext = meta.format === 'jpeg' ? 'jpg' : meta.format;
      const key = `originals/${event.id}/${team.id}/${id}.${ext}`;
      await storage.put(key, file.buffer, file.mimetype);
      db.prepare(`INSERT INTO photos (id, event_id, team_id, original_key, original_name, size_bytes, uploaded_by)
                  VALUES (?,?,?,?,?,?,?)`).run(id, event.id, team.id, key, file.originalname.slice(0, 255), file.size, req.user.id);
      enqueuePhoto(id);
      results.push({ name: file.originalname, id, ok: true });
    } catch (e) {
      results.push({ name: file.originalname, ok: false, error: e.message });
    }
  }
  audit({ actorType: 'staff', actorId: req.user.id, action: 'photos_uploaded', target: team.id,
    meta: { count: results.filter((r) => r.ok).length }, ip: req.ip });
  res.status(201).json({ results });
});

eventsRouter.get('/teams/:id/photos', (req, res) => {
  const { team } = assertTeamAccess(req.user, req.params.id);
  const photos = db.prepare(`SELECT id, original_name, size_bytes, width, height, status, error, faces_count, created_at
                             FROM photos WHERE team_id = ? ORDER BY created_at DESC`).all(team.id);
  res.json({ photos });
});

function photoForStaff(user, photoId) {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(photoId);
  if (!photo) throw new HttpError(404, 'Photo not found');
  assertEventAccess(user, photo.event_id);
  return photo;
}

eventsRouter.get('/photos/:id/preview', async (req, res) => {
  const photo = photoForStaff(req.user, req.params.id);
  if (!photo.preview_key) throw new HttpError(404, 'Preview not ready yet');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.type('image/jpeg').send(await storage.get(photo.preview_key));
});

// Full-resolution original: staff only, never guests.
eventsRouter.get('/photos/:id/original', async (req, res) => {
  const photo = photoForStaff(req.user, req.params.id);
  audit({ actorType: 'staff', actorId: req.user.id, action: 'original_downloaded', target: photo.id, ip: req.ip });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `attachment; filename="${(photo.original_name || photo.id).replace(/"/g, '')}"`);
  res.type(photo.original_key.split('.').pop()).send(await storage.get(photo.original_key));
});

eventsRouter.post('/photos/:id/retry', (req, res) => {
  const photo = photoForStaff(req.user, req.params.id);
  db.prepare("UPDATE photos SET status='pending', error=NULL WHERE id = ?").run(photo.id);
  enqueuePhoto(photo.id);
  res.json({ ok: true });
});

eventsRouter.delete('/photos/:id', async (req, res) => {
  const photo = photoForStaff(req.user, req.params.id);
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(photo.event_id);
  const faceIds = db.prepare('SELECT face_id FROM face_embeddings WHERE photo_id = ?').all(photo.id).map((r) => r.face_id);
  if (faceIds.length && !event.faces_purged) await faces.deleteFaces(event.collection_id, faceIds);
  await storage.del([photo.original_key, photo.preview_key]);
  db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
  audit({ actorType: 'staff', actorId: req.user.id, action: 'photo_deleted', target: photo.id, ip: req.ip });
  res.status(204).end();
});

/* ------------------------------ Admin ------------------------------ */

eventsRouter.get('/admin/overview', requireAdmin, (_req, res) => {
  const n = (sql) => db.prepare(sql).get().n;
  res.json({
    users: n('SELECT COUNT(*) n FROM users'),
    events: n('SELECT COUNT(*) n FROM events'),
    photos: n('SELECT COUNT(*) n FROM photos'),
    storageBytes: n('SELECT COALESCE(SUM(size_bytes),0) n FROM photos'),
    faces: n('SELECT COUNT(*) n FROM face_embeddings'),
    guestSessions: n('SELECT COUNT(*) n FROM guest_sessions'),
    photoViews: n('SELECT COUNT(*) n FROM photo_views'),
  });
});

eventsRouter.get('/audit', requireAdmin, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json({ logs: db.prepare(`
    SELECT a.*, u.email AS actor_email FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
    ORDER BY a.id DESC LIMIT ?`).all(limit) });
});
