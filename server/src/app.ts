import cors from 'cors';
import express, { Express } from 'express';
import fs from 'fs';
import helmet from 'helmet';
import path from 'path';
import { env } from './config/env';
import { Container } from './container';
import { errorHandler, notFoundHandler } from './http/middleware';
import { buildRouter } from './http/routes';
import { SignalingGateway } from './socket/SignalingGateway';
import { logger } from './utils/logger';

export function buildApp(container: Container, signaling: () => SignalingGateway): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  // Signaling metadata only — 64kb is generous for SDP; files can't come through here.
  app.use(express.json({ limit: '64kb' }));

  app.use('/api', buildRouter(container.auth, container.devices, container.history, signaling));

  // Single-service mode: serve the built client from the same origin when
  // present (client/dist relative to the repo root / working directory).
  const clientDist = path.resolve(process.cwd(), 'client/dist');
  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    logger.info(`Serving client from ${clientDist}`);
    app.use(express.static(clientDist, { index: 'index.html', maxAge: '1h' }));
    // SPA fallback for non-API GET routes
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.json({
        service: 'p2p-transfer-signaling',
        status: 'ok',
        note: 'Signaling API only — no client build found. Files never pass through this server.',
        health: '/api/health',
      });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
