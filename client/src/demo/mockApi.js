// DEMO MODE (GitHub Pages): a fake server that runs inside the browser.
// No real face matching, no real security. It exists so the app can be SHOWN without a server.
// Uploaded photos are kept in this browser only (localStorage).
import QRCode from 'qrcode';

const KEY = 'dm_demo_state_v1';
const BASE = import.meta.env.BASE_URL || '/';
const now = () => new Date().toISOString();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

export const DEMO_LOGIN = { email: 'demo@dearmemory.app', password: 'demo12345' };

// Fixed demo teams so a phone scanning the QR (a different browser) finds the same team.
const SEED_TEAMS = [
  { id: 'team-bride', name: "Bride's Family", token: 'demo-bride-family-0001-qrtoken', count: 6, hue: 18 },
  { id: 'team-groom', name: "Groom's Family", token: 'demo-groom-family-0002-qrtoken', count: 5, hue: 205 },
];

function seed() {
  const ev = { id: 'event-demo', owner_id: 'u-demo', owner_name: 'Demo Admin', name: 'Demo Wedding', event_date: new Date().toISOString().slice(0, 10),
    ends_at: new Date(Date.now() + 14 * 864e5).toISOString(), faces_purged: 0, created_at: now() };
  return {
    events: [ev],
    teams: SEED_TEAMS.map((t) => ({ id: t.id, event_id: ev.id, name: t.name, created_at: now(),
      qr: { token: t.token, expires_at: null, disabled: false, created_at: now() } })),
    photos: SEED_TEAMS.flatMap((t) => Array.from({ length: t.count }, (_, i) => ({
      id: `sample-${t.id}-${i}`, team_id: t.id, event_id: ev.id, original_name: `${t.name.split("'")[0].toLowerCase()}-${i + 1}.jpg`,
      size_bytes: 2_400_000 + i * 130_000, width: 1280, height: 853, status: 'done', error: null,
      faces_count: 1 + (i % 4), created_at: now(), dataUrl: null }))),
    users: [{ id: 'u-demo', email: DEMO_LOGIN.email, name: 'Demo Admin', role: 'admin', created_at: now() }],
    audit: [],
    guestViews: 0,
    guestSessions: 0,
  };
}

let state;
function load() {
  if (state) return state;
  try { state = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { state = seed(); }
  return state;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full: keep in memory */ }
}
function log(action, target, meta) {
  load().audit.unshift({ id: state.audit.length + 1, actor_type: 'staff', actor_email: DEMO_LOGIN.email, action, target, meta: meta ? JSON.stringify(meta) : null, ip: 'demo', created_at: now() });
  state.audit = state.audit.slice(0, 200);
}

class MockError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new MockError(status, message); };

/* ---------------- images (drawn in the browser) ---------------- */

const blobFromCanvas = (c, type = 'image/jpeg') => new Promise((r) => c.toBlob(r, type, 0.85));

function watermark(ctx, w, h, text) {
  const fs = Math.max(14, Math.round(Math.max(w, h) / 32));
  ctx.save();
  ctx.font = `700 ${fs}px sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 6);
  for (let y = -h; y < h; y += fs * 5) for (let x = -w; x < w; x += fs * (text.length * 0.65 + 4)) ctx.fillText(text, x, y);
  ctx.restore();
  ctx.font = `700 ${Math.round(fs * 1.1)}px sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(text, w - fs, h - fs);
}

async function samplePhoto(photo) {
  const team = SEED_TEAMS.find((t) => photo.id.startsWith(`sample-${t.id}`));
  const i = Number(photo.id.split('-').pop());
  const w = 1280; const h = 853;
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = c.getContext('2d');
  const hue = (team?.hue ?? 30) + i * 14;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${hue} 55% 62%)`);
  g.addColorStop(1, `hsl(${hue + 40} 45% 30%)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // simple "people" silhouettes
  const people = photo.faces_count;
  for (let p = 0; p < people; p++) {
    const cx = (w / (people + 1)) * (p + 1); const cy = h * 0.42;
    ctx.fillStyle = `hsl(${hue + 180} 30% 92% / .9)`;
    ctx.beginPath(); ctx.arc(cx, cy, 70, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, cy + 250, 120, 160, 0, Math.PI, 0); ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, h - 90, w, 90);
  ctx.fillStyle = '#fff'; ctx.font = '600 34px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`Sample photo ${i + 1} · ${team?.name || ''}`, 30, h - 35);
  watermark(ctx, w, h, 'Dear Memory · Demo');
  return blobFromCanvas(c);
}

async function photoBlob(photo) {
  if (photo.dataUrl) return (await fetch(photo.dataUrl)).blob();
  return samplePhoto(photo);
}

/** Shrinks + watermarks an uploaded photo so it fits in browser storage. */
async function prepareUpload(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale); const h = Math.round(bmp.height * scale);
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  watermark(ctx, w, h, 'Dear Memory · Demo');
  bmp.close?.();
  return { dataUrl: c.toDataURL('image/jpeg', 0.75), width: w, height: h };
}

/* ---------------- helpers ---------------- */

const guestLink = (token) => `${location.origin}${BASE}t/${token}`;
const teamView = (t) => {
  const s = load();
  const photos = s.photos.filter((p) => p.team_id === t.id);
  return {
    ...t,
    photo_count: photos.length,
    processed_count: photos.length,
    failed_count: 0,
    face_count: photos.reduce((a, p) => a + p.faces_count, 0),
    guest_count: 0,
    qr: { url: guestLink(t.qr.token), expiresAt: t.qr.expires_at, disabled: !!t.qr.disabled, createdAt: t.qr.created_at },
  };
};
const eventOr404 = (id) => load().events.find((e) => e.id === id) || fail(404, 'Event not found');
const teamOr404 = (id) => load().teams.find((t) => t.id === id) || fail(404, 'Team not found');
const photoOr404 = (id) => load().photos.find((p) => p.id === id) || fail(404, 'Photo not found');
const teamByToken = (token) => {
  const t = load().teams.find((x) => x.qr.token === token);
  if (!t) fail(404, 'This QR code is not valid.');
  if (t.qr.disabled) fail(410, 'This QR code has been turned off. Ask the photographer for a new one.');
  if (t.qr.expires_at && new Date(t.qr.expires_at) <= new Date()) fail(410, 'This QR code has expired.');
  return t;
};
const formValue = (body, k) => (body instanceof FormData ? body.get(k) : body?.[k]);

/* ---------------- the fake API ---------------- */

export async function mockRequest(method, url, { body, token, raw } = {}) {
  await new Promise((r) => setTimeout(r, 150)); // feel like a network call
  const s = load();
  const [path, query = ''] = url.split('?');
  const q = new URLSearchParams(query);
  const m = (re) => path.match(re);
  let r;

  // ---- auth ----
  if (method === 'POST' && path === '/auth/login') {
    if (String(body?.email).toLowerCase() !== DEMO_LOGIN.email || body?.password !== DEMO_LOGIN.password) {
      fail(401, `Demo login: ${DEMO_LOGIN.email} / ${DEMO_LOGIN.password}`);
    }
    log('login');
    save();
    return { token: 'demo-staff-token', user: s.users[0] };
  }
  if (path.startsWith('/guest')) return guestApi(method, path, { body, token, raw });
  if (token !== 'demo-staff-token') fail(401, 'Not signed in');

  if (method === 'GET' && path === '/auth/me') return { user: s.users[0] };
  if (method === 'POST' && path === '/auth/password') fail(400, 'Passwords cannot be changed in the demo.');

  // ---- users / admin ----
  if (method === 'GET' && path === '/users') return { users: s.users };
  if (method === 'POST' && path === '/users') {
    const u = { id: uid(), email: body.email, name: body.name, role: body.role || 'photographer', created_at: now() };
    s.users.push(u); log('user_created', u.id); save(); return { user: u };
  }
  if (method === 'DELETE' && (r = m(/^\/users\/([^/]+)$/))) {
    if (r[1] === 'u-demo') fail(400, "You can't delete your own account");
    s.users = s.users.filter((u) => u.id !== r[1]); save(); return null;
  }
  if (method === 'GET' && path === '/audit') return { logs: s.audit.slice(0, Number(q.get('limit')) || 200) };
  if (method === 'GET' && path === '/admin/overview') {
    return { users: s.users.length, events: s.events.length, photos: s.photos.length,
      storageBytes: s.photos.reduce((a, p) => a + p.size_bytes, 0), faces: s.photos.reduce((a, p) => a + p.faces_count, 0),
      guestSessions: s.guestSessions, photoViews: s.guestViews };
  }

  // ---- events ----
  if (method === 'GET' && path === '/events') {
    return { events: s.events.map((e) => ({ ...e, team_count: s.teams.filter((t) => t.event_id === e.id).length,
      photo_count: s.photos.filter((p) => p.event_id === e.id).length })) };
  }
  if (method === 'POST' && path === '/events') {
    if (!body?.name?.trim()) fail(400, 'Event name is required');
    const e = { id: uid(), owner_id: 'u-demo', owner_name: 'Demo Admin', name: body.name.trim(), event_date: body.eventDate || null,
      ends_at: new Date(body.endsAt).toISOString(), faces_purged: 0, created_at: now() };
    s.events.unshift(e); log('event_created', e.id); save(); return { event: e };
  }
  if ((r = m(/^\/events\/([^/]+)$/))) {
    const e = eventOr404(r[1]);
    if (method === 'GET') return { event: e, teams: s.teams.filter((t) => t.event_id === e.id).map(teamView), retentionDays: 30 };
    if (method === 'PATCH') { Object.assign(e, { name: body.name ?? e.name }); save(); return { event: e }; }
    if (method === 'DELETE') {
      const teamIds = s.teams.filter((t) => t.event_id === e.id).map((t) => t.id);
      s.events = s.events.filter((x) => x.id !== e.id);
      s.teams = s.teams.filter((t) => !teamIds.includes(t.id));
      s.photos = s.photos.filter((p) => p.event_id !== e.id);
      log('event_deleted', e.id); save(); return null;
    }
  }
  if (method === 'GET' && (r = m(/^\/events\/([^/]+)\/stats$/))) {
    const ps = s.photos.filter((p) => p.event_id === r[1]);
    return { photos: ps.length, faces: ps.reduce((a, p) => a + p.faces_count, 0), guests: s.guestSessions, views: s.guestViews, queue: { waiting: 0, running: 0 } };
  }

  // ---- teams & QR ----
  if (method === 'POST' && (r = m(/^\/events\/([^/]+)\/teams$/))) {
    eventOr404(r[1]);
    if (!body?.name?.trim()) fail(400, 'Team name is required');
    const t = { id: uid(), event_id: r[1], name: body.name.trim(), created_at: now(),
      qr: { token: `demo-${uid().replace(/-/g, '')}`, expires_at: null, disabled: false, created_at: now() } };
    s.teams.push(t); log('team_created', t.id); save(); return { team: teamView(t) };
  }
  if (method === 'DELETE' && (r = m(/^\/teams\/([^/]+)$/))) {
    s.teams = s.teams.filter((t) => t.id !== r[1]); s.photos = s.photos.filter((p) => p.team_id !== r[1]); save(); return null;
  }
  if (method === 'GET' && (r = m(/^\/teams\/([^/]+)\/qr$/))) {
    const link = guestLink(teamOr404(r[1]).qr.token);
    const opts = { errorCorrectionLevel: 'H', margin: 2, width: 1024, color: { dark: '#1f1a17', light: '#ffffff' } };
    if (q.get('format') === 'svg') return new Blob([await QRCode.toString(link, { ...opts, type: 'svg' })], { type: 'image/svg+xml' });
    return (await fetch(await QRCode.toDataURL(link, opts))).blob();
  }
  if (method === 'POST' && (r = m(/^\/teams\/([^/]+)\/qr\/regenerate$/))) {
    const t = teamOr404(r[1]);
    if (SEED_TEAMS.some((x) => x.id === t.id)) fail(400, 'The built-in demo teams keep a fixed QR so phones can scan them. Add your own team to try this.');
    t.qr = { token: `demo-${uid().replace(/-/g, '')}`, expires_at: body?.expiresAt || null, disabled: false, created_at: now() };
    save(); return { qr: teamView(t).qr };
  }
  if (method === 'PATCH' && (r = m(/^\/teams\/([^/]+)\/qr$/))) {
    const t = teamOr404(r[1]);
    if (body?.disabled !== undefined) t.qr.disabled = !!body.disabled;
    if (body?.expiresAt !== undefined) t.qr.expires_at = body.expiresAt;
    save(); return { qr: teamView(t).qr };
  }

  // ---- photos ----
  if ((r = m(/^\/teams\/([^/]+)\/photos$/))) {
    const t = teamOr404(r[1]);
    if (method === 'GET') return { photos: s.photos.filter((p) => p.team_id === t.id).map(({ dataUrl, ...p }) => p) };
    if (method === 'POST') {
      const files = body.getAll('photos');
      const results = [];
      for (const f of files) {
        try {
          const { dataUrl, width, height } = await prepareUpload(f);
          const p = { id: uid(), team_id: t.id, event_id: t.event_id, original_name: f.name, size_bytes: f.size, width, height,
            status: 'done', error: null, faces_count: 1 + Math.floor(Math.random() * 3), created_at: now(), dataUrl };
          s.photos.unshift(p); results.push({ name: f.name, id: p.id, ok: true });
        } catch {
          results.push({ name: f.name, ok: false, error: 'Not a readable image' });
        }
      }
      log('photos_uploaded', t.id, { count: results.filter((x) => x.ok).length });
      save(); return { results };
    }
  }
  if ((r = m(/^\/photos\/([^/]+)\/(preview|original)$/)) && method === 'GET') return photoBlob(photoOr404(r[1]));
  if (method === 'POST' && m(/^\/photos\/([^/]+)\/retry$/)) return { ok: true };
  if (method === 'DELETE' && (r = m(/^\/photos\/([^/]+)$/))) { s.photos = s.photos.filter((p) => p.id !== r[1]); save(); return null; }

  fail(404, 'Not found');
}

async function guestApi(method, path, { body, token }) {
  const s = load();
  let r;
  if (method === 'GET' && (r = path.match(/^\/guest\/teams\/([^/]+)$/))) {
    const t = teamByToken(decodeURIComponent(r[1]));
    const ev = s.events.find((e) => e.id === t.event_id);
    return { eventName: ev?.name || 'Demo Wedding', teamName: t.name, livenessMode: 'basic', region: '', retentionDays: 30, sessionMinutes: 30, mock: true };
  }
  if (method === 'POST' && path === '/guest/verify') {
    const t = teamByToken(formValue(body, 'token'));
    if (formValue(body, 'consent') !== 'true') fail(400, 'Please accept the consent notice first.');
    if (!formValue(body, 'selfie')) fail(400, 'Please take a selfie.');
    await new Promise((res) => setTimeout(res, 900)); // "matching"
    s.guestSessions++; save();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    return { token: `demo-guest:${t.id}`, expiresAt, count: s.photos.filter((p) => p.team_id === t.id).length };
  }
  const teamId = String(token || '').startsWith('demo-guest:') ? token.split(':')[1] : null;
  if (!teamId) fail(401, 'Your viewing session has ended. Scan the QR code again.');
  if (method === 'GET' && path === '/guest/photos') {
    const t = teamOr404(teamId);
    const ev = s.events.find((e) => e.id === t.event_id);
    return { photos: s.photos.filter((p) => p.team_id === teamId).map((p) => ({ id: p.id, width: p.width, height: p.height })),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), team_name: t.name, event_name: ev?.name };
  }
  if (method === 'GET' && (r = path.match(/^\/guest\/photos\/([^/]+)\/image$/))) {
    const p = photoOr404(r[1]);
    if (p.team_id !== teamId) fail(404, 'Photo not found');
    s.guestViews++; save();
    return photoBlob(p);
  }
  if (method === 'POST' && (path === '/guest/logout' || path === '/guest/forget-me')) return path.endsWith('forget-me') ? { ok: true } : null;
  fail(404, 'Not found');
}

export const isDemo = import.meta.env.VITE_DEMO === '1';
