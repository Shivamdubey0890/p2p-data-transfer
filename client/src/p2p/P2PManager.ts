import { io, Socket } from 'socket.io-client';
import {
  ConnectRequestPayload,
  ConnectResponsePayload,
  DEFAULT_CHUNK_SIZE,
  DeviceDTO,
  IceCandidatePayload,
  SdpPayload,
  SignalingErrorPayload,
  SocketEvents,
  TransferStatus,
} from '@shared/protocol';
import { SERVER_URL } from '../config';
import { api } from '../services/api';
import { Emitter } from '../utils/emitter';
import { SpeedMeter } from '../utils/SpeedMeter';
import { FileReceiver } from './FileReceiver';
import { FileSender } from './FileSender';
import { PeerSession } from './PeerSession';
import { P2PEvents, PeerConnectionState, TransferState } from './types';

interface TransferEntry {
  state: TransferState;
  meter: SpeedMeter;
  /** Kept on the sending side so Retry can re-offer the same File. */
  file?: File;
  reported: boolean;
}

/**
 * Client-side orchestrator. Owns the Socket.IO signaling connection to M1 and
 * one PeerSession per remote device. Every device running this class is both
 * a "client" and a "server": it can initiate connections and accept them.
 */
export class P2PManager extends Emitter<P2PEvents> {
  private socket: Socket | null = null;
  private readonly sessions = new Map<string, PeerSession>();
  private readonly peerStates = new Map<string, PeerConnectionState>();
  /** Peers we've accepted/initiated — offers from anyone else are ignored. */
  private readonly authorizedPeers = new Set<string>();
  private devices: DeviceDTO[] = [];
  private readonly transfers = new Map<string, TransferEntry>();
  private iceServers: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }];
  chunkSize = DEFAULT_CHUNK_SIZE;

  constructor(
    readonly deviceId: string,
    readonly deviceName: string,
    private readonly deviceToken: string
  ) {
    super();
  }

  // -- Signaling connection ------------------------------------------------

  start(): void {
    this.socket = io(SERVER_URL, {
      auth: { token: this.deviceToken },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });

    const s = this.socket;

    this.emit('signaling', 'connecting');
    s.on('connect', () => this.emit('signaling', 'connected'));
    s.on('disconnect', () => {
      this.emit('signaling', 'disconnected');
      // Presence is stale while we're away — clear so the UI doesn't show ghosts.
      this.devices = [];
      this.emit('devices', []);
    });

    s.on(SocketEvents.DeviceList, ({ devices }: { devices: DeviceDTO[] }) => {
      this.devices = devices.filter((d) => d.id !== this.deviceId);
      this.emit('devices', [...this.devices]);
    });

    s.on(SocketEvents.DeviceOnline, (device: DeviceDTO) => {
      if (device.id === this.deviceId) return;
      this.devices = [...this.devices.filter((d) => d.id !== device.id), device];
      this.emit('devices', [...this.devices]);
    });

    s.on(SocketEvents.DeviceOffline, ({ deviceId }: { deviceId: string }) => {
      this.devices = this.devices.filter((d) => d.id !== deviceId);
      this.emit('devices', [...this.devices]);
      if (this.sessions.has(deviceId)) this.teardownSession(deviceId);
    });

    s.on(SocketEvents.ConnectRequest, (p: ConnectRequestPayload) => {
      this.emit('connectRequest', { fromDeviceId: p.fromDeviceId, fromDeviceName: p.fromDeviceName });
    });

    s.on(SocketEvents.ConnectResponse, (p: ConnectResponsePayload) => {
      if (!p.accepted) {
        this.setPeerState(p.fromDeviceId, 'disconnected');
        this.emit('error', `${this.deviceLabel(p.fromDeviceId)} declined the connection`);
        return;
      }
      // Our request was accepted → we are the initiator.
      void this.openSession(p.fromDeviceId, true);
    });

    s.on(SocketEvents.Offer, (p: SdpPayload) => {
      if (!this.authorizedPeers.has(p.fromDeviceId)) return; // permission gate
      const session = this.sessions.get(p.fromDeviceId) ?? this.createSession(p.fromDeviceId, false);
      void session.handleOffer(p.sdp).catch((err) => console.error('handleOffer', err));
    });

    s.on(SocketEvents.Answer, (p: SdpPayload) => {
      void this.sessions.get(p.fromDeviceId)?.handleAnswer(p.sdp).catch((err) => console.error('handleAnswer', err));
    });

    s.on(SocketEvents.IceCandidate, (p: IceCandidatePayload) => {
      void this.sessions.get(p.fromDeviceId)?.handleCandidate(p.candidate);
    });

    s.on(SocketEvents.PeerDisconnected, (p: { fromDeviceId: string }) => {
      this.teardownSession(p.fromDeviceId);
    });

    s.on(SocketEvents.SignalingError, (e: SignalingErrorPayload) => {
      this.emit('error', e.message);
      if (e.targetDeviceId) this.setPeerState(e.targetDeviceId, 'disconnected');
    });

    s.on('connect_error', (err) => {
      this.emit('error', `Signaling connection error: ${err.message}`);
    });
  }

  stop(): void {
    this.sessions.forEach((_, id) => this.teardownSession(id));
    this.socket?.disconnect();
    this.socket = null;
  }

  // -- Peer lifecycle ------------------------------------------------------

  /** Step 1 (initiator): permission check with M1, then ask the peer. */
  async requestConnection(toDeviceId: string): Promise<void> {
    if (!this.socket?.connected) {
      throw new Error('Not connected to the server yet — wait for "Server: connected", then retry');
    }
    const { iceServers } = await api.connect(this.deviceToken, toDeviceId);
    this.iceServers = iceServers;
    this.authorizedPeers.add(toDeviceId);
    this.setPeerState(toDeviceId, 'requesting');
    this.socket?.emit(SocketEvents.ConnectRequest, {
      fromDeviceId: this.deviceId,
      fromDeviceName: this.deviceName,
      toDeviceId,
    } satisfies ConnectRequestPayload);
  }

  /** Step 2 (responder): user accepted the incoming request. */
  async acceptConnection(fromDeviceId: string): Promise<void> {
    const { iceServers } = await api.connect(this.deviceToken, fromDeviceId);
    this.iceServers = iceServers;
    this.authorizedPeers.add(fromDeviceId);
    this.setPeerState(fromDeviceId, 'connecting');
    this.socket?.emit(SocketEvents.ConnectResponse, {
      fromDeviceId: this.deviceId,
      toDeviceId: fromDeviceId,
      accepted: true,
    } satisfies ConnectResponsePayload);
  }

  rejectConnection(fromDeviceId: string, reason = 'Declined'): void {
    this.socket?.emit(SocketEvents.ConnectResponse, {
      fromDeviceId: this.deviceId,
      toDeviceId: fromDeviceId,
      accepted: false,
      reason,
    } satisfies ConnectResponsePayload);
  }

  private async openSession(peerId: string, initiator: boolean): Promise<void> {
    this.setPeerState(peerId, 'connecting');
    const session = this.createSession(peerId, initiator);
    if (initiator) {
      await session.initiate().catch((err) => {
        console.error('initiate failed', err);
        this.teardownSession(peerId);
      });
    }
  }

  private createSession(peerId: string, initiator: boolean): PeerSession {
    this.sessions.get(peerId)?.close();

    const session = new PeerSession(peerId, initiator, this.iceServers, {
      sendOffer: (to, sdp) =>
        this.socket?.emit(SocketEvents.Offer, { fromDeviceId: this.deviceId, toDeviceId: to, sdp }),
      sendAnswer: (to, sdp) =>
        this.socket?.emit(SocketEvents.Answer, { fromDeviceId: this.deviceId, toDeviceId: to, sdp }),
      sendCandidate: (to, candidate) =>
        this.socket?.emit(SocketEvents.IceCandidate, {
          fromDeviceId: this.deviceId,
          toDeviceId: to,
          candidate,
        }),
    }, {
      onChannelOpen: (id) => {
        this.setPeerState(id, 'connected');
        this.socket?.emit(SocketEvents.PeerConnected, { fromDeviceId: this.deviceId, toDeviceId: id });
      },
      onChannelClosed: (id) => this.setPeerState(id, 'disconnected'),
      onFailed: (id) => this.teardownSession(id),
      onFileOffer: (id, offer, receiver) => {
        this.registerReceiveTransfer(id, receiver);
        this.emit('fileOffer', {
          peerDeviceId: id,
          peerDeviceName: this.deviceLabel(id),
          offer,
        });
      },
      onMessage: (id, message) => this.emit('message', { peerDeviceId: id, direction: 'in', message }),
    });

    this.sessions.set(peerId, session);
    return session;
  }

  disconnectPeer(peerId: string): void {
    this.socket?.emit(SocketEvents.PeerDisconnected, {
      fromDeviceId: this.deviceId,
      toDeviceId: peerId,
    });
    this.teardownSession(peerId);
  }

  private teardownSession(peerId: string): void {
    const session = this.sessions.get(peerId);
    if (session) {
      session.close();
      this.sessions.delete(peerId);
    }
    this.authorizedPeers.delete(peerId);
    this.setPeerState(peerId, 'disconnected');
  }

  // -- Messaging -----------------------------------------------------------

  sendText(peerId: string, body: string): void {
    const session = this.requireOpenSession(peerId);
    const msg = session.sendText(body);
    this.emit('message', { peerDeviceId: peerId, direction: 'out', message: msg });
  }

  sendJson(peerId: string, payload: unknown): void {
    const session = this.requireOpenSession(peerId);
    const msg = session.sendJson(payload);
    this.emit('message', { peerDeviceId: peerId, direction: 'out', message: msg });
  }

  // -- File transfers ------------------------------------------------------

  sendFile(peerId: string, file: File): string {
    const session = this.requireOpenSession(peerId);
    const sender = session.offerFile(file, this.chunkSize);
    this.registerSendTransfer(peerId, sender, file);
    return sender.transferId;
  }

  /** Re-offer a failed/cancelled outbound transfer using the retained File. */
  retryTransfer(transferId: string): void {
    const entry = this.transfers.get(transferId);
    if (!entry || entry.state.direction !== 'send' || !entry.file) {
      throw new Error('Transfer cannot be retried');
    }
    const session = this.requireOpenSession(entry.state.peerDeviceId);
    const sender = session.offerFile(entry.file, this.chunkSize, transferId);
    entry.meter.reset();
    entry.reported = false;
    entry.state.startedAt = new Date().toISOString();
    this.bindSender(entry, sender);
    this.updateTransfer(transferId, { status: 'pending', bytesTransferred: 0, error: undefined });
  }

  pauseTransfer(transferId: string): void {
    this.withTransferActors(transferId, (s) => s.pause(true), (r) => r.pause(true));
  }

  resumeTransfer(transferId: string): void {
    this.withTransferActors(transferId, (s) => s.resume(true), (r) => r.resume(true));
  }

  cancelTransfer(transferId: string): void {
    const entry = this.transfers.get(transferId);
    if (!entry) return;
    const session = this.sessions.get(entry.state.peerDeviceId);
    const actor =
      entry.state.direction === 'send'
        ? session?.getSender(transferId)
        : session?.getReceiver(transferId);
    if (!session || !actor) {
      // Peer session is gone — just mark it cancelled locally.
      this.onTransferStatus(entry, 'cancelled');
      return;
    }
    this.withTransferActors(
      transferId,
      (s) => s.cancel(true),
      (r, sess) => r.cancel(true, sess.isOpen)
    );
  }

  /** UI calls this when the user accepts an incoming file offer. */
  async acceptFileOffer(
    peerId: string,
    transferId: string,
    directory?: FileSystemDirectoryHandle
  ): Promise<void> {
    const receiver = this.sessions.get(peerId)?.getReceiver(transferId);
    if (!receiver) throw new Error('File offer no longer available');
    await receiver.accept(directory);
  }

  /**
   * Kill everything at once: one cancel-all per peer session (active +
   * queued transfers die on both sides instantly), then force-cancel any
   * leftover entries whose session is already gone.
   */
  cancelAllTransfers(): void {
    this.sessions.forEach((session) => {
      try {
        session.cancelAllTransfers(true);
      } catch {
        /* session already dead */
      }
    });
    for (const entry of [...this.transfers.values()]) {
      const s = entry.state.status;
      if (s === 'pending' || s === 'transferring' || s === 'paused') {
        this.onTransferStatus(entry, 'cancelled');
      }
    }
  }

  rejectFileOffer(peerId: string, transferId: string, reason = 'Declined by receiver'): void {
    this.sessions.get(peerId)?.getReceiver(transferId)?.reject(reason);
  }

  // -- Transfer registry ---------------------------------------------------

  private registerSendTransfer(peerId: string, sender: FileSender, file: File): void {
    const entry: TransferEntry = {
      state: {
        id: sender.transferId,
        direction: 'send',
        peerDeviceId: peerId,
        peerDeviceName: this.deviceLabel(peerId),
        fileName: file.name,
        fileSize: file.size,
        bytesTransferred: 0,
        status: 'pending',
        speedBps: 0,
        etaSeconds: Infinity,
        startedAt: new Date().toISOString(),
        canRetry: true,
      },
      meter: new SpeedMeter(),
      file,
      reported: false,
    };
    this.transfers.set(sender.transferId, entry);
    this.bindSender(entry, sender);
    this.emitTransfers();
  }

  private bindSender(entry: TransferEntry, sender: FileSender): void {
    sender.onProgress = (bytes) => this.onTransferProgress(entry, bytes);
    sender.onStatusChange = (status, error) => this.onTransferStatus(entry, status, error);
  }

  private registerReceiveTransfer(peerId: string, receiver: FileReceiver): void {
    const { offer } = receiver;
    const existing = this.transfers.get(offer.transferId);
    const entry: TransferEntry = existing ?? {
      state: {
        id: offer.transferId,
        direction: 'receive',
        peerDeviceId: peerId,
        peerDeviceName: this.deviceLabel(peerId),
        fileName: offer.fileName,
        fileSize: offer.fileSize,
        bytesTransferred: 0,
        status: 'pending',
        speedBps: 0,
        etaSeconds: Infinity,
        startedAt: new Date().toISOString(),
        canRetry: false,
      },
      meter: new SpeedMeter(),
      reported: false,
    };
    entry.meter.reset();
    entry.reported = false;
    entry.state.status = 'pending';
    this.transfers.set(offer.transferId, entry);
    receiver.onProgress = (bytes) => this.onTransferProgress(entry, bytes);
    receiver.onStatusChange = (status, error) => this.onTransferStatus(entry, status, error);
    this.emitTransfers();
  }

  private onTransferProgress(entry: TransferEntry, bytes: number): void {
    entry.state.bytesTransferred = bytes;
    entry.meter.record(bytes);
    entry.state.speedBps = entry.meter.speed();
    entry.state.etaSeconds = entry.meter.eta(entry.state.fileSize - bytes);
    this.emitTransfers();
  }

  private onTransferStatus(entry: TransferEntry, status: TransferStatus, error?: string): void {
    entry.state.status = status;
    entry.state.error = error;
    if (status === 'completed') {
      entry.state.bytesTransferred = entry.state.fileSize;
      entry.state.speedBps = 0;
      entry.state.etaSeconds = 0;
    }
    this.emitTransfers();
    this.maybeReportHistory(entry);
  }

  /** Sender reports metadata (never content) to M1 for the history view. */
  private maybeReportHistory(entry: TransferEntry): void {
    const { state } = entry;
    const terminal = state.status === 'completed' || state.status === 'cancelled' || state.status === 'failed';
    if (!terminal || entry.reported || state.direction !== 'send') return;
    entry.reported = true;
    void api
      .reportTransfer(this.deviceToken, {
        fromDeviceId: this.deviceId,
        fromDeviceName: this.deviceName,
        toDeviceId: state.peerDeviceId,
        toDeviceName: state.peerDeviceName,
        fileName: state.fileName,
        fileSize: state.fileSize,
        status: state.status as 'completed' | 'cancelled' | 'failed',
        startedAt: state.startedAt,
      })
      .catch(() => {});
  }

  private withTransferActors(
    transferId: string,
    onSender: (s: FileSender) => void,
    onReceiver: (r: FileReceiver, session: PeerSession) => void
  ): void {
    const entry = this.transfers.get(transferId);
    if (!entry) return;
    const session = this.sessions.get(entry.state.peerDeviceId);
    if (!session) return;
    const sender = session.getSender(transferId);
    const receiver = session.getReceiver(transferId);
    if (entry.state.direction === 'send' && sender) onSender(sender);
    if (entry.state.direction === 'receive' && receiver) onReceiver(receiver, session);
  }

  private updateTransfer(transferId: string, patch: Partial<TransferState>): void {
    const entry = this.transfers.get(transferId);
    if (!entry) return;
    Object.assign(entry.state, patch);
    this.emitTransfers();
  }

  private emitTransfers(): void {
    const list = [...this.transfers.values()]
      .map((e) => ({ ...e.state }))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    this.emit('transfers', list);
  }

  // -- Helpers -------------------------------------------------------------

  getPeerState(peerId: string): PeerConnectionState {
    return this.peerStates.get(peerId) ?? 'idle';
  }

  private setPeerState(peerId: string, state: PeerConnectionState): void {
    this.peerStates.set(peerId, state);
    this.emit('peerState', { deviceId: peerId, state });
  }

  private requireOpenSession(peerId: string): PeerSession {
    const session = this.sessions.get(peerId);
    if (!session?.isOpen) throw new Error('Not connected to this device');
    return session;
  }

  private deviceLabel(deviceId: string): string {
    return this.devices.find((d) => d.id === deviceId)?.name ?? deviceId.slice(0, 8);
  }
}
