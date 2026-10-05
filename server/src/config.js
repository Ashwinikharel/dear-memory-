import 'dotenv/config';

function required(key) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required environment variable: ${key}`);
  return v;
}

const num = (key, def) => {
  const v = Number(process.env[key] ?? def);
  if (Number.isNaN(v)) throw new Error(`Environment variable ${key} must be a number`);
  return v;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num('PORT', 4000),
  // On Render, RENDER_EXTERNAL_URL is set automatically (https://<name>.onrender.com)
  publicAppUrl: (process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173').replace(/\/$/, ''),
  corsOrigin: process.env.CORS_ORIGIN || process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173',
  jwtSecret: required('JWT_SECRET'),
  dbPath: process.env.DB_PATH || './data/dearmemory.db',

  admin: {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
    name: process.env.ADMIN_NAME || 'Admin',
  },

  // Where photos are kept: "local" = this computer's disk, "s3" = AWS S3
  storage: process.env.STORAGE || (process.env.AWS_MOCK === '1' ? 'local' : 's3'),
  // Face matching: "local" = free, open-source model on this server; "aws" = AWS Rekognition;
  // "mock" = fake matching for automated tests only.
  faceEngine: process.env.FACE_ENGINE || (process.env.AWS_MOCK === '1' ? 'local' : 'aws'),
  // local engine: max face distance for a match (lower = stricter). 0.45-0.55 is typical.
  localMaxDistance: Number(process.env.LOCAL_FACE_MAX_DISTANCE || 0.5),
  storageDir: process.env.STORAGE_DIR || '',
  aws: {
    region: process.env.AWS_REGION || 'ap-south-1',
    bucket: process.env.S3_BUCKET || '',
    collectionPrefix: process.env.REKOGNITION_COLLECTION_PREFIX || 'dearmemory-',
  },

  faceMatchThreshold: num('FACE_MATCH_THRESHOLD', 95),
  livenessMode: process.env.LIVENESS_MODE === 'aws' && process.env.FACE_ENGINE !== 'local' && process.env.AWS_MOCK !== '1' ? 'aws' : 'basic',
  livenessMinConfidence: num('LIVENESS_MIN_CONFIDENCE', 90),
  guestSessionMinutes: num('GUEST_SESSION_MINUTES', 30),
  retentionDays: num('RETENTION_DAYS', 30),
  watermarkText: process.env.WATERMARK_TEXT || 'Dear Memory',
};

if (config.jwtSecret.length < 32 || config.jwtSecret.startsWith('change-me')) {
  if (config.env === 'production') throw new Error('JWT_SECRET must be a long random value in production');
  console.warn('[config] WARNING: JWT_SECRET is weak. Set a long random value before going live.');
}

if (!['local', 's3'].includes(config.storage)) throw new Error('STORAGE must be "local" or "s3"');
if (!['local', 'aws', 'mock'].includes(config.faceEngine)) throw new Error('FACE_ENGINE must be "local", "aws" or "mock"');
if (config.faceEngine === 'mock') {
  if (config.env === 'production') throw new Error('FACE_ENGINE=mock is not allowed when NODE_ENV=production');
  console.warn('[config] FACE_ENGINE=mock: FAKE face matching. For automated tests only.');
}
if (config.storage === 's3' && !config.aws.bucket) throw new Error('S3_BUCKET is required when STORAGE=s3');
if (config.faceEngine === 'local' && process.env.LIVENESS_MODE === 'aws') {
  console.warn('[config] LIVENESS_MODE=aws needs FACE_ENGINE=aws. Using basic selfie checks.');
}
