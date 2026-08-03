import dotenv from 'dotenv';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = required('JWT_SECRET', isProduction ? undefined : 'dev-secret-do-not-use');

if (isProduction && jwtSecret === 'change-me-in-production') {
  throw new Error('JWT_SECRET must be set to a real secret in production');
}

export const env = {
  isProduction,
  port: parseInt(required('PORT', '4000'), 10),
  jwtSecret,
  jwtTtlSeconds: parseInt(required('JWT_TTL_SECONDS', '86400'), 10),
  corsOrigins: [
    ...required('CORS_ORIGIN', 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    // Render injects its own public URL — allow it automatically so the
    // single-service deployment (server serves the client) just works.
    ...(process.env.RENDER_EXTERNAL_URL ? [process.env.RENDER_EXTERNAL_URL] : []),
  ],
  stunUrls: required('STUN_URLS', 'stun:stun.l.google.com:19302')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean),
  turn: {
    url: process.env.TURN_URL || undefined,
    username: process.env.TURN_USERNAME || undefined,
    password: process.env.TURN_PASSWORD || undefined,
  },
  logLevel: process.env.LOG_LEVEL || 'info',
  /** When both paths are set, the server (REST + Socket.IO) runs over TLS. */
  https: {
    keyPath: process.env.HTTPS_KEY_PATH || undefined,
    certPath: process.env.HTTPS_CERT_PATH || undefined,
  },
};

/** ICE servers handed to clients. TURN is pluggable: set the three TURN_* vars. */
export function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: env.stunUrls }];
  if (env.turn.url) {
    servers.push({
      urls: env.turn.url,
      username: env.turn.username,
      credential: env.turn.password,
    });
  }
  return servers;
}
