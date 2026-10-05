import { db, audit } from '../db.js';
import { storage, faces } from '../aws.js';
import { config } from '../config.js';

/** Deletes every photo file, face index and record for an event. */
export async function purgeEvent(eventId) {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!ev) return;
  const keys = db.prepare('SELECT original_key, preview_key FROM photos WHERE event_id = ?').all(eventId)
    .flatMap((p) => [p.original_key, p.preview_key]);
  await storage.del(keys);
  await faces.deleteCollection(ev.collection_id);
  db.transaction(() => {
    db.prepare('DELETE FROM face_embeddings WHERE event_id = ?').run(eventId);
    db.prepare('DELETE FROM events WHERE id = ?').run(eventId); // cascades teams, qr codes, photos, guest sessions
  })();
}

/** Deletes one team's photos, faces and QR codes. */
export async function purgeTeam(team, event) {
  const photos = db.prepare('SELECT original_key, preview_key FROM photos WHERE team_id = ?').all(team.id);
  const faceIds = db.prepare('SELECT face_id FROM face_embeddings WHERE team_id = ?').all(team.id).map((r) => r.face_id);
  if (faceIds.length && !event.faces_purged) await faces.deleteFaces(event.collection_id, faceIds);
  await storage.del(photos.flatMap((p) => [p.original_key, p.preview_key]));
  db.transaction(() => {
    db.prepare('DELETE FROM face_embeddings WHERE team_id = ?').run(team.id);
    db.prepare('DELETE FROM teams WHERE id = ?').run(team.id);
  })();
}

/** Retention: remove face data for events that ended more than RETENTION_DAYS ago. */
export async function runRetention() {
  const due = db.prepare(`
    SELECT * FROM events
    WHERE faces_purged = 0 AND datetime(ends_at, '+' || ? || ' days') <= datetime('now')`).all(config.retentionDays);
  for (const ev of due) {
    try {
      await faces.deleteCollection(ev.collection_id);
      db.transaction(() => {
        db.prepare('DELETE FROM face_embeddings WHERE event_id = ?').run(ev.id);
        db.prepare('UPDATE events SET faces_purged = 1 WHERE id = ?').run(ev.id);
      })();
      audit({ actorType: 'system', action: 'retention_faces_deleted', target: ev.id });
      console.log(`[retention] face data deleted for event ${ev.id}`);
    } catch (e) {
      console.error(`[retention] failed for event ${ev.id}:`, e.message);
    }
  }
  // Clean up old, unused liveness sessions
  db.prepare("DELETE FROM liveness_sessions WHERE created_at < datetime('now','-1 day')").run();
}
