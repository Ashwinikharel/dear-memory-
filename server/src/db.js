// Uses Node's built-in SQLite (node:sqlite) - nothing to compile on install.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','photographer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  event_date TEXT,
  ends_at TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  faces_purged INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One active QR per team; regenerating disables the old token.
CREATE TABLE IF NOT EXISTS qr_codes (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_qr_team ON qr_codes(team_id);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  original_key TEXT NOT NULL,
  preview_key TEXT,
  original_name TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  error TEXT,
  faces_count INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_photos_team ON photos(team_id);

-- Face vectors live (encrypted) inside the AWS Rekognition collection.
-- This table maps each Rekognition FaceId to the photo/team it came from.
CREATE TABLE IF NOT EXISTS face_embeddings (
  face_id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_faces_team ON face_embeddings(team_id);

-- Face vectors for the free local engine (FACE_ENGINE=local). 128 numbers per face.
CREATE TABLE IF NOT EXISTS local_faces (
  face_id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  descriptor BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_local_faces_collection ON local_faces(collection_id);

CREATE TABLE IF NOT EXISTS liveness_sessions (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guest_sessions (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  photo_ids TEXT NOT NULL,
  matched_face_ids TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS photo_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  viewed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  meta TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`;

export function openDb(file = config.dbPath) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  // db.transaction(fn) -> function that runs fn inside BEGIN/COMMIT (ROLLBACK on error)
  db.transaction = (fn) => (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  return db;
}

export const db = openDb();

export function audit({ actorType, actorId = null, action, target = null, meta = null, ip = null }) {
  db.prepare(
    'INSERT INTO audit_logs (actor_type, actor_id, action, target, meta, ip) VALUES (?,?,?,?,?,?)'
  ).run(actorType, actorId, action, target, meta ? JSON.stringify(meta) : null, ip ?? null);
}
