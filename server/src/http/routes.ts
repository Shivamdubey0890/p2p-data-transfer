import { Router } from 'express';
import {
  LoginRequest,
  RegisterDeviceRequest,
  SignupRequest,
} from '../../../shared/protocol';
import { buildIceServers } from '../config/env';
import { AuthService } from '../services/AuthService';
import { DeviceService } from '../services/DeviceService';
import { HistoryService, ReportTransferInput } from '../services/HistoryService';
import { SignalingGateway } from '../socket/SignalingGateway';
import { requireDevice } from './middleware';
import { HttpError } from './errors';

/** Wraps async handlers so rejections reach the error middleware. */
const wrap =
  (fn: (...args: Parameters<import('express').RequestHandler>) => Promise<void>): import('express').RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function buildRouter(
  auth: AuthService,
  devices: DeviceService,
  history: HistoryService,
  signaling: () => SignalingGateway
): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // -- Auth ----------------------------------------------------------------

  router.post(
    '/signup',
    wrap(async (req, res) => {
      const { username, password } = req.body as SignupRequest;
      const user = await auth.signup(username ?? '', password ?? '');
      res.status(201).json({ user });
    })
  );

  router.post(
    '/login',
    wrap(async (req, res) => {
      const { username, password } = req.body as LoginRequest;
      const result = await auth.login(username ?? '', password ?? '');
      res.json(result);
    })
  );

  // -- Devices -------------------------------------------------------------

  /**
   * Anonymous device registration (no account needed). The returned
   * device-scoped JWT is still required for the socket handshake and all
   * peer APIs, so unregistered clients can't signal or discover devices.
   */
  router.post(
    '/register-device',
    wrap(async (req, res) => {
      const { name, platform } = req.body as RegisterDeviceRequest;
      const device = await devices.register('anonymous', name ?? '', platform ?? '');
      const deviceToken = auth.issueDeviceToken('anonymous', device.id);
      res.status(201).json({ device: DeviceService.toDTO(device), deviceToken });
    })
  );

  router.get(
    '/devices',
    requireDevice(auth),
    wrap(async (_req, res) => {
      const online = await devices.listOnline();
      res.json({ devices: online.map(DeviceService.toDTO) });
    })
  );

  // -- Peer connection lifecycle ------------------------------------------

  /**
   * Permission check before opening a peer connection. Returns the ICE server
   * config (STUN + optional TURN). No media/data ever flows through here.
   */
  router.post(
    '/connect',
    requireDevice(auth),
    wrap(async (req, res) => {
      const { toDeviceId } = req.body as { toDeviceId?: string };
      if (!toDeviceId) throw new HttpError(400, 'toDeviceId is required');
      await devices.assertCanConnect(req.device!.deviceId, toDeviceId);
      res.json({ ok: true, iceServers: buildIceServers() });
    })
  );

  router.post(
    '/disconnect',
    requireDevice(auth),
    wrap(async (req, res) => {
      const { toDeviceId } = req.body as { toDeviceId?: string };
      if (!toDeviceId) throw new HttpError(400, 'toDeviceId is required');
      signaling().notifyPeerDisconnected(req.device!.deviceId, toDeviceId);
      res.json({ ok: true });
    })
  );

  // -- Transfer history (metadata only) ------------------------------------

  router.post(
    '/history',
    requireDevice(auth),
    wrap(async (req, res) => {
      const record = await history.report(req.device!.deviceId, req.body as ReportTransferInput);
      res.status(201).json({ id: record.id });
    })
  );

  router.get(
    '/history',
    requireDevice(auth),
    wrap(async (req, res) => {
      const items = await history.listForDevice(req.device!.deviceId);
      res.json({ history: items });
    })
  );

  return router;
}
