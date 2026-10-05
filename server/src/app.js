import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { eventsRouter } from './routes/events.js';
import { guestRouter } from './routes/guest.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // correct client IPs behind a load balancer / reverse proxy
  app.disable('x-powered-by');

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'same-site' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'blob:', 'data:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'https://*.amazonaws.com', 'wss://*.amazonaws.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        workerSrc: ["'self'", 'blob:'],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      },
    },
  }));
  app.use(cors({ origin: config.corsOrigin.split(',').map((s) => s.trim()) }));
  app.use(express.json({ limit: '100kb' }));
  app.use(express.text({ limit: '4kb' })); // sendBeacon logout

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', authRouter, guestRouter, eventsRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // In production, serve the built React app from ../client/dist
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false }));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // Errors -> JSON. Internal details are hidden from clients.
  app.use((err, _req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message;
    if (err instanceof multer.MulterError) {
      status = 400;
      message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message;
    }
    if (status >= 500) {
      console.error(err);
      message = 'Something went wrong. Please try again.';
    }
    res.status(status).json({ error: message });
  });

  return app;
}
