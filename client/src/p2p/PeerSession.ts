import {
  ChannelMessage,
  CHUNK_HEADER_BYTES,
  DEFAULT_CHUNK_SIZE,
  decodeChunkHeader,
  FileOfferMessage,
  JsonMessage,
  TextMessage,
} from '@shared/protocol';
import { randomId } from '../utils/id';
import { FileReceiver } from './FileReceiver';
import { FileSender, SendScheduler } from './FileSender';

export interface SessionSignaling {
  sendOffer(toDeviceId: string, sdp: RTCSessionDescriptionInit): void;
  sendAnswer(toDeviceId: string, sdp: RTCSessionDescriptionInit): void;
  sendCandidate(toDeviceId: string, candidate: RTCIceCandidateInit): void;
}

export interface SessionEvents {
  onChannelOpen(peerId: string): void;
  onChannelClosed(peerId: string): void;
  /** Connection died and could not be recovered by ICE restart. */
  onFailed(peerId: string): void;
  onFileOffer(peerId: string, offer: FileOfferMessage, receiver: FileReceiver): void;
  onMessage(peerId: string, message: TextMessage | JsonMessage): void;
}

/**
 * One P2P session with one remote device. Owns the RTCPeerConnection and a
 * single reliable/ordered DataChannel carrying both JSON control messages
 * (strings) and binary file chunks (ArrayBuffers with an 8-byte header).
 *
 * Everything in this class runs device-to-device. The signaling callbacks are
 * only used during (re)negotiation.
 */
export class PeerSession {
  private readonly pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;
  private closed = false;
  private restartAttempts = 0;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  private nextKey = 1;
  private readonly sendScheduler = new SendScheduler();
  private readonly sendersByKey = new Map<number, FileSender>();
  private readonly sendersById = new Map<string, FileSender>();
  private readonly receiversByKey = new Map<number, FileReceiver>();
  private readonly receiversById = new Map<string, FileReceiver>();

  constructor(
    readonly peerDeviceId: string,
    /** True for the side that initiated the connection (creates the channel + offers). */
    private readonly isInitiator: boolean,
    iceServers: RTCIceServer[],
    private readonly signaling: SessionSignaling,
    private readonly events: SessionEvents
  ) {
    this.pc = new RTCPeerConnection({ iceServers });

    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.signaling.sendCandidate(this.peerDeviceId, e.candidate.toJSON());
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      if (state === 'failed' || state === 'disconnected') {
        this.tryRecover();
      }
    };

    if (!this.isInitiator) {
      this.pc.ondatachannel = (e) => this.attachChannel(e.channel);
    }
  }

  // -- Negotiation ---------------------------------------------------------

  async initiate(): Promise<void> {
    this.attachChannel(this.pc.createDataChannel('data', { ordered: true }));
    this.armConnectTimeout();
    await this.createAndSendOffer(false);
  }

  /** Don't sit in "connecting" forever — fail loudly if ICE can't find a path. */
  private armConnectTimeout(): void {
    if (this.connectTimer) return;
    this.connectTimer = setTimeout(() => {
      if (!this.isOpen && !this.closed) {
        this.failAllTransfers('Could not establish a direct connection');
        this.events.onFailed(this.peerDeviceId);
      }
    }, 30_000);
  }

  private clearConnectTimeout(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private async createAndSendOffer(iceRestart: boolean): Promise<void> {
    const offer = await this.pc.createOffer({ iceRestart });
    await this.pc.setLocalDescription(offer);
    this.signaling.sendOffer(this.peerDeviceId, offer);
  }

  async handleOffer(sdp: RTCSessionDescriptionInit): Promise<void> {
    this.armConnectTimeout();
    await this.pc.setRemoteDescription(sdp);
    this.remoteDescriptionSet = true;
    await this.flushCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.signaling.sendAnswer(this.peerDeviceId, answer);
  }

  async handleAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(sdp);
    this.remoteDescriptionSet = true;
    await this.flushCandidates();
  }

  async handleCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.remoteDescriptionSet) {
      this.pendingCandidates.push(candidate);
      return;
    }
    await this.pc.addIceCandidate(candidate).catch(() => {
      /* stale candidate after restart — safe to ignore */
    });
  }

  private async flushCandidates(): Promise<void> {
    const queued = this.pendingCandidates.splice(0);
    for (const c of queued) {
      await this.pc.addIceCandidate(c).catch(() => {});
    }
  }

  /** ICE restart: initiator re-offers; responder waits for the new offer. */
  private tryRecover(): void {
    if (this.closed) return;
    if (this.restartAttempts >= 2) {
      this.failAllTransfers('Peer connection lost');
      this.events.onFailed(this.peerDeviceId);
      return;
    }
    this.restartAttempts++;
    if (this.isInitiator) {
      this.remoteDescriptionSet = false;
      this.createAndSendOffer(true).catch(() => this.events.onFailed(this.peerDeviceId));
    }
  }

  // -- Channel -------------------------------------------------------------

  private attachChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      this.restartAttempts = 0;
      this.clearConnectTimeout();
      this.events.onChannelOpen(this.peerDeviceId);
    };
    channel.onclose = () => {
      if (!this.closed) this.events.onChannelClosed(this.peerDeviceId);
    };
    channel.onmessage = (e) => {
      if (typeof e.data === 'string') {
        this.handleControl(JSON.parse(e.data) as ChannelMessage);
      } else {
        const { key, chunkIndex, data } = decodeChunkHeader(e.data as ArrayBuffer);
        this.receiversByKey.get(key)?.handleChunk(chunkIndex, data);
      }
    };
  }

  get isOpen(): boolean {
    return this.channel?.readyState === 'open';
  }

  private sendControl = (message: object): void => {
    if (this.channel?.readyState === 'open') {
      this.channel.send(JSON.stringify(message));
    }
  };

  // -- Outbound API --------------------------------------------------------

  sendText(body: string): TextMessage {
    const msg: TextMessage = {
      type: 'text',
      id: randomId(),
      body,
      sentAt: new Date().toISOString(),
    };
    this.sendControl(msg);
    return msg;
  }

  sendJson(payload: unknown): JsonMessage {
    const msg: JsonMessage = {
      type: 'json',
      id: randomId(),
      payload,
      sentAt: new Date().toISOString(),
    };
    this.sendControl(msg);
    return msg;
  }

  /**
   * Offer a file to the peer. The transfer starts when they accept.
   * Passing an existing transferId retries/resumes that transfer.
   */
  offerFile(file: File, chunkSize: number = DEFAULT_CHUNK_SIZE, existingTransferId?: string): FileSender {
    if (!this.isOpen) throw new Error('Data channel is not open');
    const transferId = existingTransferId ?? randomId();
    const key = this.nextKey++;

    // SCTP caps each DataChannel message (Chrome: 256 KiB). The header rides
    // inside the message, so the payload must leave room for it.
    const maxMessage = this.pc.sctp?.maxMessageSize;
    const cap =
      maxMessage && Number.isFinite(maxMessage) && maxMessage > 16 * 1024
        ? maxMessage - CHUNK_HEADER_BYTES
        : 64 * 1024 - CHUNK_HEADER_BYTES; // conservative fallback
    chunkSize = Math.min(chunkSize, cap);

    const sender = new FileSender(
      transferId,
      key,
      file,
      this.channel!,
      chunkSize,
      this.sendControl,
      this.sendScheduler
    );

    // Replace any previous sender for a retried transfer.
    const previous = this.sendersById.get(transferId);
    if (previous) this.sendersByKey.delete(previous.key);
    this.sendersByKey.set(key, sender);
    this.sendersById.set(transferId, sender);

    const offer: FileOfferMessage = {
      type: 'file-offer',
      transferId,
      key,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      chunkSize,
      totalChunks: Math.ceil(file.size / chunkSize),
    };
    this.sendControl(offer);
    return sender;
  }

  getSender(transferId: string): FileSender | undefined {
    return this.sendersById.get(transferId);
  }

  getReceiver(transferId: string): FileReceiver | undefined {
    return this.receiversById.get(transferId);
  }

  // -- Inbound control routing --------------------------------------------

  private handleControl(msg: ChannelMessage): void {
    switch (msg.type) {
      case 'file-offer': {
        // A re-offer of a failed transfer resumes from the receiver's partial state.
        const existing = this.receiversById.get(msg.transferId);
        let receiver: FileReceiver;
        if (existing && existing.status === 'failed') {
          existing.prepareRetry(msg);
          receiver = existing;
        } else {
          receiver = new FileReceiver(msg, this.sendControl);
        }
        this.receiversByKey.set(msg.key, receiver);
        this.receiversById.set(msg.transferId, receiver);
        this.events.onFileOffer(this.peerDeviceId, msg, receiver);
        break;
      }
      case 'file-accept':
        this.sendersById.get(msg.transferId)?.start(msg.resumeFrom);
        break;
      case 'file-reject':
        this.sendersById.get(msg.transferId)?.handleReject(msg.reason);
        break;
      case 'chunk-ack':
        this.sendersById.get(msg.transferId)?.handleAck(msg.receivedBytes);
        break;
      case 'file-complete':
        this.sendersById.get(msg.transferId)?.handleComplete();
        break;
      case 'pause':
        this.sendersById.get(msg.transferId)?.pause(false);
        this.receiversById.get(msg.transferId)?.pause(false);
        break;
      case 'resume':
        this.sendersById.get(msg.transferId)?.resume(false);
        this.receiversById.get(msg.transferId)?.resume(false);
        break;
      case 'cancel':
        this.sendersById.get(msg.transferId)?.cancel(false);
        this.receiversById.get(msg.transferId)?.cancel(false, this.isOpen);
        break;
      case 'cancel-all':
        this.cancelAllTransfers(false);
        break;
      case 'text':
      case 'json':
        this.events.onMessage(this.peerDeviceId, msg);
        break;
    }
  }

  // -- Teardown ------------------------------------------------------------

  /**
   * Instantly cancel every transfer on this session — active AND queued —
   * with a single peer notification instead of one message per transfer,
   * so nothing gets a chance to start in between.
   */
  cancelAllTransfers(notifyPeer: boolean): void {
    if (notifyPeer) this.sendControl({ type: 'cancel-all' });
    this.sendersById.forEach((s) => s.cancel(false));
    this.receiversById.forEach((r) => r.cancel(false, false));
  }

  private failAllTransfers(reason: string): void {
    this.sendersById.forEach((s) => s.fail(reason));
    this.receiversById.forEach((r) => r.fail(reason));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearConnectTimeout();
    this.failAllTransfers('Connection closed');
    this.channel?.close();
    this.pc.close();
  }
}
