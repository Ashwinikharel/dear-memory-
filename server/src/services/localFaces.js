// FREE face recognition that runs on this server (no AWS, no card needed).
// Uses the open-source face-api model (@vladmandic/face-api) on TensorFlow.js with the
// WebAssembly backend (falls back to plain CPU). Nothing needs to be compiled on install.
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { db } from '../db.js';
import { config } from '../config.js';
import { matchDescriptors, similarityFromDistance } from './matching.js';

const require = createRequire(import.meta.url);
let loading = null;

async function loadModels() {
  const started = Date.now();
  const tf = require('@tensorflow/tfjs');
  let backend = 'cpu';
  try {
    const wasm = require('@tensorflow/tfjs-backend-wasm');
    wasm.setWasmPaths(path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm')) + path.sep);
    if (await tf.setBackend('wasm')) backend = 'wasm';
    else await tf.setBackend('cpu');
  } catch {
    await tf.setBackend('cpu');
  }
  await tf.ready();

  // Load the wasm/cpu build of face-api by absolute path (works whatever the package "exports" say)
  const distDir = path.dirname(require.resolve('@vladmandic/face-api'));
  let faceapi;
  try {
    faceapi = require(path.join(distDir, 'face-api.node-wasm.js'));
  } catch (e) {
    const files = (await import('node:fs')).readdirSync(distDir).filter((f) => f.startsWith('face-api.node'));
    throw new Error(`Could not load face-api (${e.message}). Files found: ${files.join(', ')}`);
  }
  const modelDir = path.join(distDir, '..', 'model');
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelDir);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(modelDir);

  console.log(`[faces] free face model ready (${tf.getBackend() || backend} backend) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return { tf, faceapi };
}

export function warmUp() {
  if (!loading) loading = loadModels().catch((e) => { loading = null; throw e; });
  return loading;
}

// Remember the last result per image buffer, so checkSelfie + search don't run the model twice.
const recent = new WeakMap();

/** Finds all faces in an image. Returns [{ score, area, descriptor:number[] }] largest first. */
async function detect(bytes) {
  if (recent.has(bytes)) return recent.get(bytes);
  const { tf, faceapi } = await warmUp();
  const { data, info } = await sharp(bytes).rotate().removeAlpha()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .raw().toBuffer({ resolveWithObject: true });
  const tensor = tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32');
  try {
    const results = await faceapi
      .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5, maxResults: 100 }))
      .withFaceLandmarks()
      .withFaceDescriptors();
    const out = results.map((r) => ({
      score: r.detection.score,
      area: (r.detection.box.width * r.detection.box.height) / (info.width * info.height),
      descriptor: Array.from(r.descriptor),
    })).sort((a, b) => b.area - a.area);
    recent.set(bytes, out);
    return out;
  } finally {
    tensor.dispose();
  }
}

const toBlob = (arr) => Buffer.from(new Float32Array(arr).buffer);
const fromBlob = (blob) => new Float32Array(new Uint8Array(blob).buffer);

export function localFaces() {
  return {
    engine: 'local',
    threshold: similarityFromDistance(config.localMaxDistance),
    async ensureCollection() { /* collections are just rows in local_faces */ },
    async deleteCollection(collectionId) {
      db.prepare('DELETE FROM local_faces WHERE collection_id = ?').run(collectionId);
    },
    async indexFaces(collectionId, bytes) {
      const found = (await detect(bytes)).filter((f) => f.score >= 0.6 && f.area >= 0.0004);
      const insert = db.prepare('INSERT INTO local_faces (face_id, collection_id, descriptor) VALUES (?,?,?)');
      return found.map((f) => {
        const faceId = `lf-${crypto.randomUUID()}`;
        insert.run(faceId, collectionId, toBlob(f.descriptor));
        return { faceId, confidence: f.score * 100 };
      });
    },
    async searchByImage(collectionId, bytes) {
      const [face] = await detect(bytes); // largest face = the person taking the selfie
      if (!face) return [];
      const stored = db.prepare('SELECT face_id, descriptor FROM local_faces WHERE collection_id = ?').all(collectionId)
        .map((r) => ({ faceId: r.face_id, descriptor: fromBlob(r.descriptor) }));
      return matchDescriptors(face.descriptor, stored, config.localMaxDistance);
    },
    async deleteFaces(collectionId, faceIds) {
      const del = db.prepare('DELETE FROM local_faces WHERE face_id = ? AND collection_id = ?');
      faceIds.forEach((id) => del.run(id, collectionId));
    },
    async checkSelfie(bytes) {
      const found = (await detect(bytes)).filter((f) => f.score >= 0.5);
      if (!found.length) return { ok: false, reason: 'No face found. Look straight at the camera in good light.' };
      const main = found[0];
      if (found.length > 1 && found[1].area > main.area * 0.4) {
        return { ok: false, reason: 'More than one face found. Only you should be in the selfie.' };
      }
      if (main.score < 0.8) return { ok: false, reason: 'Face not clear enough. Try again in better light.' };
      if (main.area < 0.04) return { ok: false, reason: 'Move a little closer to the camera.' };
      return { ok: true };
    },
    async createLivenessSession() { throw new Error('Face Liveness needs FACE_ENGINE=aws'); },
    async getLivenessResult() { throw new Error('Face Liveness needs FACE_ENGINE=aws'); },
  };
}
