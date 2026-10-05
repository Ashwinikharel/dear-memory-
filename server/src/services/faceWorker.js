// Background worker: builds the watermarked preview and indexes faces for each uploaded photo.
// Simple in-process queue. For high volume, swap this for BullMQ + Redis (same process() function).
import { db } from '../db.js';
import { storage, faces } from '../aws.js';
import { buildVariants } from './images.js';
import { config } from '../config.js';

// The free local model uses the CPU, so process one photo at a time there.
const CONCURRENCY = faces.engine === 'local' ? 1 : 2;
const queue = [];
const queued = new Set();
let running = 0;

export function enqueuePhoto(photoId) {
  if (queued.has(photoId)) return;
  queued.add(photoId);
  queue.push(photoId);
  pump();
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const id = queue.shift();
    running++;
    processPhoto(id)
      .catch((err) => console.error(`[worker] photo ${id} failed:`, err.message))
      .finally(() => { running--; queued.delete(id); pump(); });
  }
}

export async function processPhoto(photoId) {
  const photo = db.prepare(`
    SELECT p.*, e.collection_id, e.name AS event_name, e.faces_purged
    FROM photos p JOIN events e ON e.id = p.event_id WHERE p.id = ?`).get(photoId);
  if (!photo) return;

  db.prepare("UPDATE photos SET status='processing', error=NULL WHERE id=?").run(photoId);
  try {
    const original = await storage.get(photo.original_key);
    const { preview, index, width, height } = await buildVariants(original, `${config.watermarkText} · ${photo.event_name}`);

    const previewKey = `previews/${photo.event_id}/${photo.id}.jpg`;
    await storage.put(previewKey, preview, 'image/jpeg');

    let faceRecords = [];
    if (!photo.faces_purged) {
      await faces.ensureCollection(photo.collection_id);
      faceRecords = await faces.indexFaces(photo.collection_id, index, photo.id);
    }

    const insertFace = db.prepare(
      'INSERT OR IGNORE INTO face_embeddings (face_id, photo_id, team_id, event_id) VALUES (?,?,?,?)'
    );
    db.transaction(() => {
      for (const f of faceRecords) insertFace.run(f.faceId, photo.id, photo.team_id, photo.event_id);
      db.prepare(`UPDATE photos SET status='done', preview_key=?, width=?, height=?, faces_count=? WHERE id=?`)
        .run(previewKey, width, height, faceRecords.length, photo.id);
    })();
  } catch (err) {
    db.prepare("UPDATE photos SET status='failed', error=? WHERE id=?").run(String(err.message).slice(0, 500), photoId);
    throw err;
  }
}

/** On startup, pick up anything left unfinished by a previous run. */
export function resumePending() {
  const rows = db.prepare("SELECT id FROM photos WHERE status IN ('pending','processing') ORDER BY created_at").all();
  rows.forEach((r) => enqueuePhoto(r.id));
  if (rows.length) console.log(`[worker] resumed ${rows.length} unfinished photo(s)`);
}

export const queueStats = () => ({ waiting: queue.length, running });
