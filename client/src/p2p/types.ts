import { DeviceDTO, FileOfferMessage, JsonMessage, TextMessage, TransferStatus } from '@shared/protocol';

export type PeerConnectionState = 'idle' | 'requesting' | 'connecting' | 'connected' | 'disconnected';

export interface TransferState {
  id: string;
  direction: 'send' | 'receive';
  peerDeviceId: string;
  peerDeviceName: string;
  fileName: string;
  fileSize: number;
  bytesTransferred: number;
  status: TransferStatus;
  speedBps: number;
  etaSeconds: number;
  startedAt: string;
  error?: string;
  /** Sender side keeps the File handle so Retry can restart without re-picking. */
  canRetry: boolean;
}

export interface ChatMessage {
  peerDeviceId: string;
  direction: 'in' | 'out';
  message: TextMessage | JsonMessage;
}

export interface IncomingConnectRequest {
  fromDeviceId: string;
  fromDeviceName: string;
}

export interface IncomingFileOffer {
  peerDeviceId: string;
  peerDeviceName: string;
  offer: FileOfferMessage;
}

export type SignalingStatus = 'connecting' | 'connected' | 'disconnected';

/** Events the P2P layer raises toward the UI. */
export interface P2PEvents extends Record<string, unknown> {
  /** Server no longer knows this device (restart wiped presence) — re-register. */
  staleIdentity: null;
  /** Current trusted peer ids (auto-accept + auto-reconnect list). */
  trusted: string[];
  signaling: SignalingStatus;
  devices: DeviceDTO[];
  connectRequest: IncomingConnectRequest;
  peerState: { deviceId: string; state: PeerConnectionState };
  transfers: TransferState[];
  fileOffer: IncomingFileOffer;
  message: ChatMessage;
  error: string;
}
