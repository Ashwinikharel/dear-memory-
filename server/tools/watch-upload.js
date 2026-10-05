#!/usr/bin/env node
// Camera -> website auto uploader.
// Point your tethering software (Lightroom/Capture One/EOS Utility/Nikon Webcam utility)
// or Wi-Fi SD card (FlashAir, ez Share) at a folder, and run this script on that laptop.
// Every new JPEG/PNG that appears is uploaded straight to a team in Dear Memory.
//
// Usage:
//   node tools/watch-upload.js --api https://your-site.com --email you@x.com --team <teamId> --folder "C:\\Camera"
// Password is read from the DM_PASSWORD environment variable (so it isn't saved in shell history).

import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));

const api = (args.api || 'http://localhost:4000').replace(/\/$/, '');
const { email, team, folder } = args;
const password = process.env.DM_PASSWORD;
if (!email || !team || !folder || !password) {
  console.error('Usage: DM_PASSWORD=... node tools/watch-upload.js --api <url> --email <email> --team <teamId> --folder <path>');
  process.exit(1);
}

const doneFile = path.join(folder, '.dear-memory-uploaded.json');
const done = new Set(fs.existsSync(doneFile) ? JSON.parse(fs.readFileSync(doneFile, 'utf8')) : []);
const save = () => fs.writeFileSync(doneFile, JSON.stringify([...done]));
const isPhoto = (f) => /\.(jpe?g|png|webp)$/i.test(f);
const mime = (f) => (/\.png$/i.test(f) ? 'image/png' : /\.webp$/i.test(f) ? 'image/webp' : 'image/jpeg');

let token;
async function login() {
  const r = await fetch(`${api}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`Login failed: ${(await r.json()).error}`);
  token = (await r.json()).token;
}

// Wait until the camera has finished writing the file (size stops changing)
async function waitStable(file) {
  let last = -1;
  for (let i = 0; i < 30; i++) {
    const size = fs.statSync(file).size;
    if (size > 0 && size === last) return;
    last = size;
    await new Promise((r) => setTimeout(r, 700));
  }
}

const pending = new Set();
async function upload(name, attempt = 1) {
  const file = path.join(folder, name);
  if (done.has(name) || pending.has(name) || !fs.existsSync(file)) return;
  pending.add(name);
  try {
    await waitStable(file);
    const form = new FormData();
    form.append('photos', new Blob([fs.readFileSync(file)], { type: mime(name) }), name);
    let r = await fetch(`${api}/api/teams/${team}/photos`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    if (r.status === 401) { await login(); pending.delete(name); return upload(name, attempt); }
    const body = await r.json();
    if (!r.ok || !body.results?.[0]?.ok) throw new Error(body.error || body.results?.[0]?.error || r.statusText);
    done.add(name); save();
    console.log(`✔ uploaded ${name}`);
  } catch (e) {
    console.error(`✖ ${name}: ${e.message}${attempt < 5 ? ' (retrying)' : ''}`);
    if (attempt < 5) setTimeout(() => { pending.delete(name); upload(name, attempt + 1); }, 3000 * attempt);
    return;
  }
  pending.delete(name);
}

await login();
console.log(`Watching ${folder} -> team ${team}. Press Ctrl+C to stop.`);
fs.readdirSync(folder).filter(isPhoto).forEach((f) => upload(f)); // catch up on existing files
fs.watch(folder, (_evt, name) => { if (name && isPhoto(name)) upload(name); });
