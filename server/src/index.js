import { config } from './config.js';
import { createApp } from './app.js';
import { seedAdmin } from './routes/auth.js';
import { resumePending } from './services/faceWorker.js';
import { runRetention } from './services/purge.js';
import { faces } from './aws.js';
import { warmUp } from './services/localFaces.js';

await seedAdmin(config.admin);

// Load the free face model in the background so the first guest doesn't wait
if (faces.engine === 'local') {
  console.log('[faces] loading free face model…');
  warmUp().catch((e) => console.error('[faces] could not load the face model:', e.message));
}
resumePending();

// Face-data retention check: on start and every hour
const retention = () => runRetention().catch((e) => console.error('[retention]', e.message));
retention();
setInterval(retention, 60 * 60 * 1000).unref();

createApp().listen(config.port, () => {
  console.log(`Dear Memory API running on http://localhost:${config.port} (photos: ${config.storage}, faces: ${faces.engine}, liveness: ${config.livenessMode})`);
});
