import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { db, audit } from '../db.js';
import { HttpError, requireStaff, requireAdmin, signStaffToken } from '../middleware/auth.js';

export const authRouter = Router();
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' } });

authRouter.post('/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') throw new HttpError(400, 'Email and password are required');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim());
  // Compare against a dummy hash when the user is missing, so response time doesn't reveal which emails exist
  const ok = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
  if (!user || !ok) {
    audit({ actorType: 'anonymous', action: 'login_failed', target: email.slice(0, 200), ip: req.ip });
    throw new HttpError(401, 'Wrong email or password');
  }
  audit({ actorType: 'staff', actorId: user.id, action: 'login', ip: req.ip });
  res.json({ token: signStaffToken(user), user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

authRouter.get('/auth/me', requireStaff, (req, res) => res.json({ user: req.user }));

authRouter.post('/auth/password', requireStaff, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!(await bcrypt.compare(String(currentPassword || ''), row.password_hash))) throw new HttpError(400, 'Current password is wrong');
  if (typeof newPassword !== 'string' || newPassword.length < 10) throw new HttpError(400, 'New password must be at least 10 characters');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(newPassword, 12), req.user.id);
  audit({ actorType: 'staff', actorId: req.user.id, action: 'password_changed', ip: req.ip });
  res.status(204).end();
});

/* ---- Admin: manage photographer accounts ---- */

authRouter.get('/users', requireAdmin, (_req, res) => {
  res.json({ users: db.prepare('SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC').all() });
});

authRouter.post('/users', requireAdmin, async (req, res) => {
  const { email, name, password, role = 'photographer' } = req.body || {};
  if (!/^\S+@\S+\.\S+$/.test(email || '')) throw new HttpError(400, 'Valid email is required');
  if (!name || name.length > 100) throw new HttpError(400, 'Name is required');
  if (typeof password !== 'string' || password.length < 10) throw new HttpError(400, 'Password must be at least 10 characters');
  if (!['admin', 'photographer'].includes(role)) throw new HttpError(400, 'Invalid role');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'That email is already registered');
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, email, name, password_hash, role) VALUES (?,?,?,?,?)')
    .run(id, email.trim(), name.trim(), await bcrypt.hash(password, 12), role);
  audit({ actorType: 'staff', actorId: req.user.id, action: 'user_created', target: id, meta: { email, role }, ip: req.ip });
  res.status(201).json({ user: { id, email, name, role } });
});

authRouter.delete('/users/:id', requireAdmin, (req, res) => {
  if (req.params.id === req.user.id) throw new HttpError(400, "You can't delete your own account");
  if (db.prepare('SELECT 1 FROM events WHERE owner_id = ?').get(req.params.id)) {
    throw new HttpError(409, 'This user still owns events. Delete their events first.');
  }
  const r = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  if (!r.changes) throw new HttpError(404, 'User not found');
  audit({ actorType: 'staff', actorId: req.user.id, action: 'user_deleted', target: req.params.id, ip: req.ip });
  res.status(204).end();
});

/** Creates the first admin from .env if there are no users yet. */
export async function seedAdmin({ email, password, name }) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  if (!email || !password) {
    console.warn('[seed] No users exist and ADMIN_EMAIL/ADMIN_PASSWORD are not set. Nobody can log in yet.');
    return;
  }
  db.prepare('INSERT INTO users (id, email, name, password_hash, role) VALUES (?,?,?,?,?)')
    .run(crypto.randomUUID(), email, name, await bcrypt.hash(password, 12), 'admin');
  console.log(`[seed] Created admin account ${email}. Change the password after first login.`);
}
