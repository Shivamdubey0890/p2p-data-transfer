/**
 * Shared protocol definitions used by both the signaling server (M1)
 * and the browser clients (D1..Dn).
 *
 * Three layers live here:
 *  1. REST DTOs               (client <-> M1, HTTPS)
 *  2. Socket.IO signaling     (client <-> M1, WebSocket) — SDP/ICE only, never payload
 *  3. DataChannel protocol    (client <-> client, WebRTC) — where the actual data flows
 */

// ---------------------------------------------------------------------------
// 1. Domain models
// ---------------------------------------------------------------------------

export interface UserDTO {
  id: string;
  username: string;
  createdAt: string;
}

export type DeviceStatus = 'online' | 'busy' | 'offline';

export interface DeviceDTO {
  id: string;
  userId: string;
  name: string;
  platform: string;
  status: DeviceStatus;
  /** Optional, only what the server observed on the socket handshake. */
  ip?: string;
  lastSeenAt: string;
}

export interface TransferHistoryDTO {
  id: string;
  fromDeviceId: string;
  fromDeviceName: string;
  toDeviceId: string;
  toDeviceName: string;
  fileName: string;
  fileSize: number;
  status: 'completed' | 'cancelled' | 'failed';
  startedAt: string;
  finishedAt?: string;
}

// ---------------------------------------------------------------------------
// 2. REST API contracts
// ---------------------------------------------------------------------------

export interface SignupRequest {
  username: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: UserDTO;
}

export interface RegisterDeviceRequest {
  name: string;
  platform: string;
}

export interface RegisterDeviceResponse {
  device: DeviceDTO;
  /** Device-scoped JWT used for the Socket.IO handshake. */
  deviceToken: string;
}

export interface ApiError {
  error: string;
  code?: string;
}

// ---------------------------------------------------------------------------
// 3. Socket.IO signaling events (client <-> M1)
// ---------------------------------------------------------------------------

export const SocketEvents = {
  // server -> clients
  DeviceOnline: 'device-online',
  DeviceOffline: 'device-offline',
  DeviceList: 'device-list',

  // connection negotiation (forwarded by M1, originated by peers)
  ConnectRequest: 'connect-request',
  ConnectResponse: 'connect-response',
  Offer: 'offer',
  Answer: 'answer',
  IceCandidate: 'ice-candidate',
  PeerConnected: 'peer-connected',
  PeerDisconnected: 'peer-disconnected',

  SignalingError: 'signaling-error',
} as const;

export interface ConnectRequestPayload {
  fromDeviceId: string;
  fromDeviceName: string;
  toDeviceId: string;
}

export interface ConnectResponsePayload {
  fromDeviceId: string;
  toDeviceId: string;
  accepted: boolean;
  reason?: string;
}

export interface SdpPayload {
  fromDeviceId: string;
  toDeviceId: string;
  sdp: RTCSessionDescriptionInit;
}

export interface IceCandidatePayload {
  fromDeviceId: string;
  toDeviceId: string;
  candidate: RTCIceCandidateInit;
}

export interface PeerLifecyclePayload {
  fromDeviceId: string;
  toDeviceId: string;
}

export interface SignalingErrorPayload {
  code: 'TARGET_OFFLINE' | 'NOT_AUTHORIZED' | 'SELF_CONNECT' | 'INVALID_PAYLOAD';
  message: string;
  targetDeviceId?: string;
}

// ---------------------------------------------------------------------------
// 4. DataChannel protocol (peer <-> peer). M1 never sees these.
// ---------------------------------------------------------------------------

/** Default chunk size: 256 KiB. Configurable per transfer via FileOfferMessage. */
export const DEFAULT_CHUNK_SIZE = 256 * 1024;
/** Stop pushing into the channel above this bufferedAmount (backpressure). */
export const BUFFERED_AMOUNT_HIGH = 8 * 1024 * 1024;
/** Resume pushing when bufferedAmount drains below this. */
export const BUFFERED_AMOUNT_LOW = 1 * 1024 * 1024;
/** Binary frame header: uint32 transferKey + uint32 chunkIndex (little-endian). */
export const CHUNK_HEADER_BYTES = 8;
/** Receiver acks progress every N chunks so the sender can offer resume. */
export const ACK_EVERY_N_CHUNKS = 32;

export type TransferStatus =
  | 'pending'      // offered, waiting for the receiver to accept
  | 'transferring'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type ChannelMessage =
  | FileOfferMessage
  | FileAcceptMessage
  | FileRejectMessage
  | TransferControlMessage
  | CancelAllMessage
  | ChunkAckMessage
  | FileCompleteMessage
  | TextMessage
  | JsonMessage;

/** Kills every in-flight and queued transfer on this session, both sides, at once. */
export interface CancelAllMessage {
  type: 'cancel-all';
}

/** Sender proposes a file. `key` is the uint32 used in binary chunk headers. */
export interface FileOfferMessage {
  type: 'file-offer';
  transferId: string;
  key: number;
  fileName: string;
  fileSize: number;
  mimeType: string;
  chunkSize: number;
  totalChunks: number;
}

/** Receiver accepts; resumeFrom > 0 requests a resume from that byte offset. */
export interface FileAcceptMessage {
  type: 'file-accept';
  transferId: string;
  resumeFrom: number;
}

export interface FileRejectMessage {
  type: 'file-reject';
  transferId: string;
  reason: string;
}

/** Either side may pause/resume/cancel an in-flight transfer. */
export interface TransferControlMessage {
  type: 'pause' | 'resume' | 'cancel';
  transferId: string;
}

/** Receiver -> sender: contiguous bytes safely persisted so far. */
export interface ChunkAckMessage {
  type: 'chunk-ack';
  transferId: string;
  receivedBytes: number;
}

/** Receiver -> sender: all bytes persisted, transfer done. */
export interface FileCompleteMessage {
  type: 'file-complete';
  transferId: string;
}

export interface TextMessage {
  type: 'text';
  id: string;
  body: string;
  sentAt: string;
}

export interface JsonMessage {
  type: 'json';
  id: string;
  payload: unknown;
  sentAt: string;
}

// ---------------------------------------------------------------------------
// Binary chunk framing helpers
// ---------------------------------------------------------------------------

export function encodeChunk(key: number, chunkIndex: number, data: ArrayBuffer): ArrayBuffer {
  const frame = new ArrayBuffer(CHUNK_HEADER_BYTES + data.byteLength);
  const view = new DataView(frame);
  view.setUint32(0, key, true);
  view.setUint32(4, chunkIndex, true);
  new Uint8Array(frame, CHUNK_HEADER_BYTES).set(new Uint8Array(data));
  return frame;
}

export function decodeChunkHeader(frame: ArrayBuffer): { key: number; chunkIndex: number; data: ArrayBuffer } {
  const view = new DataView(frame);
  return {
    key: view.getUint32(0, true),
    chunkIndex: view.getUint32(4, true),
    data: frame.slice(CHUNK_HEADER_BYTES),
  };
}
