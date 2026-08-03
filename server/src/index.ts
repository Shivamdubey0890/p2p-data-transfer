import fs from 'fs';
import http from 'http';
import https from 'https';
import { buildApp } from './app';
import { env } from './config/env';
import { buildContainer } from './container';
import { SignalingGateway } from './socket/SignalingGateway';
import { logger } from './utils/logger';

const container = buildContainer();

let gateway: SignalingGateway;
const app = buildApp(container, () => gateway);

const useTls = Boolean(env.https.keyPath && env.https.certPath);
const server = useTls
  ? https.createServer(
      {
        key: fs.readFileSync(env.https.keyPath!),
        cert: fs.readFileSync(env.https.certPath!),
      },
      app
    )
  : http.createServer(app);
gateway = new SignalingGateway(server, container.auth, container.devices);

server.listen(env.port, () => {
  logger.info(`M1 signaling server listening on :${env.port} (${useTls ? 'https' : 'http'})`, {
    stun: env.stunUrls,
    turnConfigured: Boolean(env.turn.url),
  });
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  server.close(() => process.exit(0));
});
