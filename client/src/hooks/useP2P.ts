import { useEffect, useState } from 'react';
import { DeviceDTO } from '@shared/protocol';
import { P2PManager } from '../p2p/P2PManager';
import {
  ChatMessage,
  IncomingConnectRequest,
  IncomingFileOffer,
  PeerConnectionState,
  SignalingStatus,
  TransferState,
} from '../p2p/types';

export function useTrustedPeers(manager: P2PManager): string[] {
  const [trusted, setTrusted] = useState<string[]>(() => manager.getTrustedPeers());
  useEffect(() => manager.on('trusted', setTrusted), [manager]);
  return trusted;
}

export function useSignalingStatus(manager: P2PManager): SignalingStatus {
  const [status, setStatus] = useState<SignalingStatus>('connecting');
  useEffect(() => manager.on('signaling', setStatus), [manager]);
  return status;
}

/**
 * Bridges the imperative P2PManager into React state. One subscription per
 * concern keeps re-renders scoped: progress updates don't re-render the
 * device list, etc.
 */
export function useDevices(manager: P2PManager): DeviceDTO[] {
  const [devices, setDevices] = useState<DeviceDTO[]>([]);
  useEffect(() => manager.on('devices', setDevices), [manager]);
  return devices;
}

export function useTransfers(manager: P2PManager): TransferState[] {
  const [transfers, setTransfers] = useState<TransferState[]>([]);
  useEffect(() => manager.on('transfers', setTransfers), [manager]);
  return transfers;
}

export function usePeerStates(manager: P2PManager): Map<string, PeerConnectionState> {
  const [states, setStates] = useState<Map<string, PeerConnectionState>>(new Map());
  useEffect(
    () =>
      manager.on('peerState', ({ deviceId, state }) => {
        setStates((prev) => new Map(prev).set(deviceId, state));
      }),
    [manager]
  );
  return states;
}

export function useMessages(manager: P2PManager): ChatMessage[] {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  useEffect(() => manager.on('message', (m) => setMessages((prev) => [...prev, m])), [manager]);
  return messages;
}

export function useConnectRequests(manager: P2PManager): {
  request: IncomingConnectRequest | null;
  clear(): void;
} {
  const [request, setRequest] = useState<IncomingConnectRequest | null>(null);
  useEffect(() => manager.on('connectRequest', setRequest), [manager]);
  return { request, clear: () => setRequest(null) };
}

/** Incoming file offers queue up (a 31-file drop = 31 offers arriving at once). */
export function useFileOffers(manager: P2PManager): {
  offers: IncomingFileOffer[];
  remove(transferIds: string[]): void;
} {
  const [offers, setOffers] = useState<IncomingFileOffer[]>([]);
  useEffect(
    () =>
      manager.on('fileOffer', (incoming) =>
        setOffers((prev) => [
          ...prev.filter((o) => o.offer.transferId !== incoming.offer.transferId),
          incoming,
        ])
      ),
    [manager]
  );
  const remove = (transferIds: string[]) =>
    setOffers((prev) => prev.filter((o) => !transferIds.includes(o.offer.transferId)));
  return { offers, remove };
}

export function useP2PErrors(manager: P2PManager): { error: string | null; clear(): void } {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => manager.on('error', setError), [manager]);
  return { error, clear: () => setError(null) };
}
