import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const bearer = (req) => {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};

export function signStaffToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, typ: 'staff' }, config.jwtSecret, { expiresIn: '12h' });
}

export function signGuestToken(sessionId, minutes) {
  return jwt.sign({ gs: sessionId, typ: 'guest' }, config.jwtSecret, { expiresIn: `${minutes}m` });
}

function verify(token, typ) {
  if (!token) throw new HttpError(401, 'Not signed in');
  let payload;
  try { payload = jwt.verify(token, config.jwtSecret); } catch { throw new HttpError(401, 'Session expired. Please sign in again.'); }
  if (payload.typ !== typ) throw new HttpError(401, 'Invalid session');
  return payload;
}

/** Admin or photographer */
export function requireStaff(req, _res, next) {
  const p = verify(bearer(req), 'staff');
  const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(p.sub);
  if (!user) throw new HttpError(401, 'Account no longer exists');
  req.user = user;
  next();
}

export function requireAdmin(req, _res, next) {
  requireStaff(req, _res, () => {
    if (req.user.role !== 'admin') throw new HttpError(403, 'Admins only');
    next();
  });
}

/** Loads a guest session token, either from the Authorization header or a given string. */
export function loadGuestSession(token) {
  const p = verify(token, 'guest');
  const s = db.prepare('SELECT * FROM guest_sessions WHERE id = ?').get(p.gs);
  if (!s || s.ended_at || new Date(s.expires_at) <= new Date()) throw new HttpError(401, 'Your viewing session has ended. Scan the QR code again.');
  s.photoIds = JSON.parse(s.photo_ids);
  return s;
}

export function requireGuest(req, _res, next) {
  req.guest = loadGuestSession(bearer(req));
  next();
}

/** Can this staff user manage this event? */
export function assertEventAccess(user, eventId) {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!ev) throw new HttpError(404, 'Event not found');
  if (user.role !== 'admin' && ev.owner_id !== user.id) throw new HttpError(403, 'Not your event');
  return ev;
}

export function assertTeamAccess(user, teamId) {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  if (!team) throw new HttpError(404, 'Team not found');
  const event = assertEventAccess(user, team.event_id);
  return { team, event };
}
