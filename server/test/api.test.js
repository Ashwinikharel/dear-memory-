// End-to-end API test in mock mode (no AWS needed). Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dearmemory-test-'));
Object.assign(process.env, {
  NODE_ENV: 'test', AWS_MOCK: '1', FACE_ENGINE: 'mock', STORAGE: 'local', LIVENESS_MODE: 'basic', DB_PATH: path.join(dir, 'test.db'),
  JWT_SECRET: 'x'.repeat(48), ADMIN_EMAIL: 'admin@test.local', ADMIN_PASSWORD: 'AdminPassword123', ADMIN_NAME: 'Admin',
});

const { createApp } = await import('../src/app.js');
const { seedAdmin } = await import('../src/routes/auth.js');
const sharp = (await import('sharp')).default;

let server; let base;
before(async () => {
  await seedAdmin({ email: 'admin@test.local', password: 'AdminPassword123', name: 'Admin' });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const call = async (method, url, { token, json, form } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: json ? JSON.stringify(json) : form });
  const type = res.headers.get('content-type') || '';
  return { res, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
};
const jpeg = () => sharp({ create: { width: 800, height: 600, channels: 3, background: '#88aacc' } }).jpeg().toBuffer();
const login = async (email, password) => (await call('POST', '/auth/login', { json: { email, password } })).body.token;

test('full flow: event -> team -> upload -> scan QR -> verify -> view only', async () => {
  const admin = await login('admin@test.local', 'AdminPassword123');
  assert.ok(admin);

  // Photographer account
  await call('POST', '/users', { token: admin, json: { email: 'cam@test.local', name: 'Cam', password: 'CameraPass123' } });
  const cam = await login('cam@test.local', 'CameraPass123');

  const { body: { event } } = await call('POST', '/events', { token: cam, json: { name: 'Wedding', endsAt: new Date(Date.now() + 864e5).toISOString() } });
  const { body: { team } } = await call('POST', `/events/${event.id}/teams`, { token: cam, json: { name: 'Bride side' } });
  const qrToken = team.qr.url.split('/t/')[1];
  assert.ok(qrToken.length >= 30, 'QR token is long and random');

  // QR image
  const qr = await call('GET', `/teams/${team.id}/qr?format=png`, { token: cam });
  assert.equal(qr.res.headers.get('content-type'), 'image/png');

  // Upload
  const form = new FormData();
  form.append('photos', new Blob([await jpeg()], { type: 'image/jpeg' }), 'one.jpg');
  form.append('photos', new Blob([Buffer.from('not an image')], { type: 'image/jpeg' }), 'fake.jpg');
  const up = await call('POST', `/teams/${team.id}/photos`, { token: cam, form });
  assert.equal(up.body.results.filter((r) => r.ok).length, 1, 'real image accepted');
  assert.equal(up.body.results.filter((r) => !r.ok).length, 1, 'fake image rejected');

  // Wait for the worker
  for (let i = 0; i < 50; i++) {
    const { body } = await call('GET', `/teams/${team.id}/photos`, { token: cam });
    if (body.photos.every((p) => p.status === 'done')) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  // Guest scans QR
  const info = await call('GET', `/guest/teams/${qrToken}`);
  assert.equal(info.body.teamName, 'Bride side');

  // Without consent -> refused
  const noConsent = new FormData();
  noConsent.append('token', qrToken);
  noConsent.append('selfie', new Blob([await jpeg()], { type: 'image/jpeg' }), 'selfie.jpg');
  assert.equal((await call('POST', '/guest/verify', { form: noConsent })).res.status, 400);

  const vf = new FormData();
  vf.append('token', qrToken);
  vf.append('consent', 'true');
  vf.append('selfie', new Blob([await jpeg()], { type: 'image/jpeg' }), 'selfie.jpg');
  const verified = await call('POST', '/guest/verify', { form: vf });
  assert.equal(verified.res.status, 200, JSON.stringify(verified.body));
  const guest = verified.body.token;

  const list = await call('GET', '/guest/photos', { token: guest });
  assert.equal(list.body.photos.length, 1);
  const photoId = list.body.photos[0].id;

  // View-only image: watermarked preview, no caching, no metadata
  const img = await call('GET', `/guest/photos/${photoId}/image`, { token: guest });
  assert.equal(img.res.status, 200);
  assert.match(img.res.headers.get('cache-control'), /no-store/);
  const meta = await sharp(img.body).metadata();
  assert.ok(meta.width <= 1280 && !meta.exif, 'reduced size, EXIF stripped');

  // Guest can never reach originals or staff routes
  assert.equal((await call('GET', `/photos/${photoId}/original`, { token: guest })).res.status, 401);

  // Another photographer can't see this event
  await call('POST', '/users', { token: admin, json: { email: 'other@test.local', name: 'Other', password: 'OtherPass1234' } });
  const other = await login('other@test.local', 'OtherPass1234');
  assert.equal((await call('GET', `/events/${event.id}`, { token: other })).res.status, 403);

  // Logout ends the session
  await call('POST', '/guest/logout', { token: guest });
  assert.equal((await call('GET', `/guest/photos/${photoId}/image`, { token: guest })).res.status, 401);

  // Disabled QR is refused
  await call('PATCH', `/teams/${team.id}/qr`, { token: cam, json: { disabled: true } });
  assert.equal((await call('GET', `/guest/teams/${qrToken}`)).res.status, 410);

  // Deleting the event removes everything
  assert.equal((await call('DELETE', `/events/${event.id}`, { token: cam })).res.status, 204);
  assert.equal((await call('GET', `/guest/teams/${qrToken}`)).res.status, 404);
});
