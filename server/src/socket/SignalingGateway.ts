import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import {
  ConnectRequestPayload,
  ConnectResponsePayload,
  IceCandidatePayload,
  PeerLifecyclePayload,
  SdpPayload,
  SignalingErrorPayload,
  SocketEvents,
} from '../../../shared/protocol';
import { env } from '../config/env';
import { AuthService } from '../services/AuthService';
import { DeviceService } from '../services/DeviceService';
import { logger } from '../utils/logger';

/**
 * Signaling gateway (M1's only real-time role).
 *
 * Responsibilities: presence, and forwarding small negotiation messages
 * (connect requests, SDP offers/answers, ICE candidates) between exactly two
 * authenticated devices. Payload size is capped — this channel physically
 * cannot be used to relay files.
 */
const MAX_SIGNAL_BYTES = 64 * 1024; // SDP + candidates are a few KB; files won't fit.

export class SignalingGateway {
  private readonly io: Server;

  constructor(
    httpServer: HttpServer,
    private readonly auth: AuthService,
    private readonly devices: DeviceService
  ) {
    this.io = new Server(httpServer, {
      cors: { origin: env.corsOrigins, credentials: true },
      maxHttpBufferSize: MAX_SIGNAL_BYTES,
      // Aggressive heartbeat: dead connections (killed tabs, network drops)
      // are detected within ~15s so presence doesn't show ghosts.
      pingInterval: 10_000,
      pingTimeout: 5_000,
    });

    this.io.use((socket, next) => this.authenticate(socket).then(() => next(), next));
    this.io.on('connection', (socket) => this.onConnection(socket));
  }

  /** Handshake: `auth.token` must be a device-scoped JWT from /register-device. */
  private async authenticate(socket: Socket): Promise<void> {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) throw new Error('Missing auth token');
    const claims = this.auth.verifyDeviceToken(token);
    const device = await this.devices.getById(claims.deviceId);
    if (!device) throw new Error('Unknown device');
    socket.data.deviceId = device.id;
    socket.data.userId = claims.sub;
  }

  private async onConnection(socket: Socket): Promise<void> {
    const deviceId = socket.data.deviceId as string;
    const ip = socket.handshake.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
      ?? socket.handshake.address;

    const device = await this.devices.markOnline(deviceId, socket.id, ip);
    logger.info('Device online', { deviceId, name: device.name, socketId: socket.id });

    // Each device joins a room named by its deviceId → routing is a room emit.
    socket.join(deviceId);

    socket.broadcast.emit(SocketEvents.DeviceOnline, DeviceService.toDTO(device));
    socket.emit(SocketEvents.DeviceList, {
      devices: (await this.devices.listOnline()).map(DeviceService.toDTO),
    });

    socket.on(SocketEvents.ConnectRequest, (p: ConnectRequestPayload) =>
      this.forward(socket, SocketEvents.ConnectRequest, p)
    );
    socket.on(SocketEvents.ConnectResponse, (p: ConnectResponsePayload) =>
      this.forward(socket, SocketEvents.ConnectResponse, p)
    );
    socket.on(SocketEvents.Offer, (p: SdpPayload) => this.forward(socket, SocketEvents.Offer, p));
    socket.on(SocketEvents.Answer, (p: SdpPayload) => this.forward(socket, SocketEvents.Answer, p));
    socket.on(SocketEvents.IceCandidate, (p: IceCandidatePayload) =>
      this.forward(socket, SocketEvents.IceCandidate, p)
    );
    socket.on(SocketEvents.PeerConnected, (p: PeerLifecyclePayload) =>
      this.forward(socket, SocketEvents.PeerConnected, p)
    );
    socket.on(SocketEvents.PeerDisconnected, (p: PeerLifecyclePayload) =>
      this.forward(socket, SocketEvents.PeerDisconnected, p)
    );

    socket.on('disconnect', async () => {
      const offline = await this.devices.markOffline(deviceId);
      logger.info('Device offline', { deviceId });
      if (offline) {
        this.io.emit(SocketEvents.DeviceOffline, { deviceId });
      }
    });
  }

  /**
   * Forward a signaling message to its target device after validating that
   * the sender is who the payload claims and that both peers may connect.
   */
  private async forward(
    socket: Socket,
    event: string,
    payload: { fromDeviceId?: string; toDeviceId?: string }
  ): Promise<void> {
    const senderDeviceId = socket.data.deviceId as string;

    if (!payload || payload.fromDeviceId !== senderDeviceId || !payload.toDeviceId) {
      this.emitError(socket, {
        code: 'INVALID_PAYLOAD',
        message: 'fromDeviceId must match your device and toDeviceId is required',
      });
      return;
    }

    try {
      await this.devices.assertCanConnect(senderDeviceId, payload.toDeviceId);
    } catch (err) {
      this.emitError(socket, {
        code: 'TARGET_OFFLINE',
        message: err instanceof Error ? err.message : 'Target unavailable',
        targetDeviceId: payload.toDeviceId,
      });
      return;
    }

    this.io.to(payload.toDeviceId).emit(event, payload);
  }

  /** Used by POST /disconnect to tear down from the REST side. */
  notifyPeerDisconnected(fromDeviceId: string, toDeviceId: string): void {
    this.io.to(toDeviceId).emit(SocketEvents.PeerDisconnected, { fromDeviceId, toDeviceId });
  }

  private emitError(socket: Socket, error: SignalingErrorPayload): void {
    socket.emit(SocketEvents.SignalingError, error);
  }
}
