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
  // present. Checked relative to both the working directory and this file's
  // compiled location (server/dist/server/src → repo root is 4 levels up).
  const candidates = [
    path.resolve(process.cwd(), 'client/dist'),
    path.resolve(__dirname, '../../../../client/dist'),
  ];
  const clientDist = candidates.find((p) => fs.existsSync(path.join(p, 'index.html')));
  logger.info('Client dist lookup', { cwd: process.cwd(), candidates, found: clientDist ?? 'none' });
  if (clientDist) {
    logger.info(`Serving client from ${clientDist}`);
    app.use(
      express.static(clientDist, {
        index: 'index.html',
        setHeaders: (res, filePath) => {
          // index.html must always revalidate so new deploys reach users
          // immediately; hashed assets are immutable and cache forever.
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    // SPA fallback for non-API GET routes
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      res.setHeader('Cache-Control', 'no-cache');
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
