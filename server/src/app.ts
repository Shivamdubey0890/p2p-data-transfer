import cors from 'cors';
import express, { Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { Container } from './container';
import { errorHandler, notFoundHandler } from './http/middleware';
import { buildRouter } from './http/routes';
import { SignalingGateway } from './socket/SignalingGateway';

export function buildApp(container: Container, signaling: () => SignalingGateway): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  // Signaling metadata only — 64kb is generous for SDP; files can't come through here.
  app.use(express.json({ limit: '64kb' }));

  app.use('/api', buildRouter(container.auth, container.devices, container.history, signaling));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
