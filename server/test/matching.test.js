import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photosForMatches, matchDescriptors, similarityFromDistance } from '../src/services/matching.js';
import { evaluateSelfie } from '../src/services/selfie.js';

const teamFaces = [
  { face_id: 'f1', photo_id: 'p1' },
  { face_id: 'f2', photo_id: 'p2' },
  { face_id: 'f3', photo_id: 'p2' },
];

test('guest only gets photos containing their matched faces', () => {
  const r = photosForMatches([{ faceId: 'f2', similarity: 99 }], teamFaces, 95);
  assert.deepEqual(r.photoIds, ['p2']);
  assert.deepEqual(r.faceIds, ['f2']);
});

test('faces from other teams are ignored', () => {
  const r = photosForMatches([{ faceId: 'other-team-face', similarity: 99.9 }], teamFaces, 95);
  assert.deepEqual(r.photoIds, []);
});

test('matches below the threshold are ignored', () => {
  const r = photosForMatches([{ faceId: 'f1', similarity: 94.9 }], teamFaces, 95);
  assert.deepEqual(r.photoIds, []);
});

test('the same photo is returned once even if several faces match', () => {
  const r = photosForMatches([{ faceId: 'f2', similarity: 99 }, { faceId: 'f3', similarity: 98 }], teamFaces, 95);
  assert.deepEqual(r.photoIds, ['p2']);
  assert.equal(r.faceIds.length, 2);
});

test('wildcard match only works in mock mode', () => {
  assert.deepEqual(photosForMatches([{ faceId: '*', similarity: 100 }], teamFaces, 95).photoIds, []);
  assert.equal(photosForMatches([{ faceId: '*', similarity: 100 }], teamFaces, 95, { mock: true }).photoIds.length, 2);
});

const goodFace = {
  Confidence: 99.9, EyesOpen: { Value: true }, Quality: { Sharpness: 80, Brightness: 70 },
  Pose: { Yaw: 3, Pitch: -2 }, Sunglasses: { Value: false },
};

test('selfie: accepts a clear single face', () => {
  assert.equal(evaluateSelfie([goodFace]).ok, true);
});

test('selfie: rejects no face, several faces, closed eyes, blur, turned head', () => {
  assert.equal(evaluateSelfie([]).ok, false);
  assert.equal(evaluateSelfie([goodFace, goodFace]).ok, false);
  assert.equal(evaluateSelfie([{ ...goodFace, EyesOpen: { Value: false } }]).ok, false);
  assert.equal(evaluateSelfie([{ ...goodFace, Quality: { Sharpness: 5, Brightness: 70 } }]).ok, false);
  assert.equal(evaluateSelfie([{ ...goodFace, Pose: { Yaw: 50, Pitch: 0 } }]).ok, false);
  assert.equal(evaluateSelfie([{ ...goodFace, Sunglasses: { Value: true } }]).ok, false);
});

test('local engine: only faces within the max distance match, closest first', () => {
  const me = Array.from({ length: 128 }, (_, i) => Math.sin(i) * 0.1);
  const nearMe = me.map((v) => v + 0.02);      // distance ~0.23
  const stranger = me.map((v) => v + 0.1);     // distance ~1.13
  const r = matchDescriptors(me, [
    { faceId: 'stranger', descriptor: stranger },
    { faceId: 'near', descriptor: nearMe },
    { faceId: 'same', descriptor: me },
  ], 0.5);
  assert.deepEqual(r.map((x) => x.faceId), ['same', 'near']);
  assert.equal(r[0].similarity, 100);
});

test('local engine threshold lines up with photosForMatches', () => {
  const threshold = similarityFromDistance(0.5);
  const r = photosForMatches([{ faceId: 'f1', similarity: threshold }], [{ face_id: 'f1', photo_id: 'p1' }], threshold);
  assert.deepEqual(r.photoIds, ['p1']);
});
