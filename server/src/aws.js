// Photo storage and face recognition behind small interfaces:
//   storage: S3 (AWS) or local disk (free)      faces: Rekognition (AWS), local model (free), or mock (tests)
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import {
  RekognitionClient, CreateCollectionCommand, DeleteCollectionCommand, IndexFacesCommand,
  SearchFacesByImageCommand, DeleteFacesCommand, DetectFacesCommand,
  CreateFaceLivenessSessionCommand, GetFaceLivenessSessionResultsCommand,
} from '@aws-sdk/client-rekognition';
import { config } from './config.js';
import { evaluateSelfie } from './services/selfie.js';
import { localFaces } from './services/localFaces.js';

export const collectionIdFor = (eventId) => `${config.aws.collectionPrefix}${eventId}`;

/* ------------------------------ AWS ------------------------------ */

function awsStorage() {
  const s3 = new S3Client({ region: config.aws.region });
  const Bucket = config.aws.bucket;
  return {
    async put(key, body, contentType) {
      // Server-side encryption at rest
      await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' }));
    },
    async get(key) {
      const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
      return Buffer.from(await res.Body.transformToByteArray());
    },
    async del(keys) {
      const list = keys.filter(Boolean);
      for (let i = 0; i < list.length; i += 1000) {
        await s3.send(new DeleteObjectsCommand({
          Bucket, Delete: { Objects: list.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
        }));
      }
    },
  };
}

function awsFaces() {
  const rk = new RekognitionClient({ region: config.aws.region });
  return {
    engine: 'aws',
    threshold: config.faceMatchThreshold,
    async ensureCollection(collectionId) {
      try {
        await rk.send(new CreateCollectionCommand({ CollectionId: collectionId }));
      } catch (e) {
        if (e.name !== 'ResourceAlreadyExistsException') throw e;
      }
    },
    async deleteCollection(collectionId) {
      try {
        await rk.send(new DeleteCollectionCommand({ CollectionId: collectionId }));
      } catch (e) {
        if (e.name !== 'ResourceNotFoundException') throw e;
      }
    },
    // Returns [{ faceId, confidence }]
    async indexFaces(collectionId, bytes, externalImageId) {
      const res = await rk.send(new IndexFacesCommand({
        CollectionId: collectionId,
        Image: { Bytes: bytes },
        ExternalImageId: externalImageId,
        DetectionAttributes: ['DEFAULT'],
        MaxFaces: 100,
        QualityFilter: 'AUTO',
      }));
      return (res.FaceRecords || []).map((r) => ({ faceId: r.Face.FaceId, confidence: r.Face.Confidence }));
    },
    // Searches with the largest face in `bytes`. Returns [{ faceId, similarity }]
    async searchByImage(collectionId, bytes, threshold) {
      try {
        const res = await rk.send(new SearchFacesByImageCommand({
          CollectionId: collectionId,
          Image: { Bytes: bytes },
          FaceMatchThreshold: threshold,
          MaxFaces: 4096,
          QualityFilter: 'AUTO',
        }));
        return (res.FaceMatches || []).map((m) => ({ faceId: m.Face.FaceId, similarity: m.Similarity }));
      } catch (e) {
        // No face found in the selfie, or empty collection
        if (e.name === 'InvalidParameterException' || e.name === 'ResourceNotFoundException') return [];
        throw e;
      }
    },
    async deleteFaces(collectionId, faceIds) {
      for (let i = 0; i < faceIds.length; i += 4096) {
        await rk.send(new DeleteFacesCommand({ CollectionId: collectionId, FaceIds: faceIds.slice(i, i + 4096) }));
      }
    },
    // Basic selfie checks (used only when LIVENESS_MODE=basic)
    async checkSelfie(bytes) {
      const res = await rk.send(new DetectFacesCommand({ Image: { Bytes: bytes }, Attributes: ['ALL'] }));
      return evaluateSelfie(res.FaceDetails || []);
    },
    async createLivenessSession() {
      const res = await rk.send(new CreateFaceLivenessSessionCommand({ Settings: { AuditImagesLimit: 0 } }));
      return res.SessionId;
    },
    // Returns { status, confidence, referenceImage: Buffer|null }
    async getLivenessResult(sessionId) {
      const res = await rk.send(new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId }));
      return {
        status: res.Status,
        confidence: res.Confidence ?? 0,
        referenceImage: res.ReferenceImage?.Bytes ? Buffer.from(res.ReferenceImage.Bytes) : null,
      };
    },
  };
}

/* ------------------------------ LOCAL DISK STORAGE (free) / MOCK FACES (tests) ------------------------------ */

function localStorage() {
  // Photos are kept next to the database (server/data/photos) unless STORAGE_DIR is set.
  const dataDir = path.dirname(config.dbPath);
  // Keep using the old test folder if photos were already uploaded there
  const legacy = path.resolve(dataDir, 'mock-storage');
  const root = path.resolve(config.storageDir
    || (fsSync.existsSync(legacy) && !fsSync.existsSync(path.resolve(dataDir, 'photos')) ? legacy : path.join(dataDir, 'photos')));
  const safe = (key) => {
    const p = path.resolve(root, key);
    if (!p.startsWith(root + path.sep)) throw new Error('Invalid key');
    return p;
  };
  return {
    async put(key, body) {
      const p = safe(key);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, body);
    },
    async get(key) { return fs.readFile(safe(key)); },
    async del(keys) { await Promise.all(keys.filter(Boolean).map((k) => fs.rm(safe(k), { force: true }))); },
  };
}

function mockFaces() {
  // Every indexed photo gets one fake face; every search matches all faces.
  // => In mock mode a guest sees ALL photos of their team. For UI testing only.
  const collections = new Map();
  let n = 0;
  return {
    engine: 'mock',
    threshold: config.faceMatchThreshold,
    async ensureCollection(id) { if (!collections.has(id)) collections.set(id, new Set()); },
    async deleteCollection(id) { collections.delete(id); },
    async indexFaces(id, _bytes, _ext) {
      await this.ensureCollection(id);
      const faceId = `mock-face-${Date.now()}-${n++}`;
      collections.get(id).add(faceId);
      return [{ faceId, confidence: 99 }];
    },
    async searchByImage() { return [{ faceId: '*', similarity: 100 }]; },
    async deleteFaces(id, faceIds) { faceIds.forEach((f) => collections.get(id)?.delete(f)); },
    async checkSelfie() { return { ok: true }; },
    async createLivenessSession() { return `mock-liveness-${Date.now()}`; },
    async getLivenessResult() { return { status: 'SUCCEEDED', confidence: 99, referenceImage: Buffer.from('mock') }; },
  };
}

export const storage = config.storage === 'local' ? localStorage() : awsStorage();
export const faces = { local: localFaces, aws: awsFaces, mock: mockFaces }[config.faceEngine]();
export const isMock = config.faceEngine === 'mock';
