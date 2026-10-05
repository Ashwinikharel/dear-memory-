// Usage: npm run set-url -- https://dear-memory.onrender.com
import fs from 'node:fs';

const url = (process.argv[2] || '').replace(/\/$/, '');
let host;
try {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('must be https');
  host = u.host;
} catch {
  console.error('Give your live website address, e.g.:  npm run set-url -- https://dear-memory.onrender.com');
  process.exit(1);
}

const file = new URL('../capacitor.config.json', import.meta.url);
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
cfg.server = { ...cfg.server, url, cleartext: false, allowNavigation: [host] };
fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
console.log(`App will open ${url}`);
console.log('Now run:  npm run sync');
