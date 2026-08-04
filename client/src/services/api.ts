import {
  DeviceDTO,
  LoginResponse,
  RegisterDeviceResponse,
  TransferHistoryDTO,
} from '@shared/protocol';
import { API_BASE } from '../config';

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiRequestError(res.status, (data.error as string) ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  signup: (username: string, password: string) =>
    request<{ user: LoginResponse['user'] }>('/signup', { method: 'POST', body: { username, password } }),

  login: (username: string, password: string) =>
    request<LoginResponse>('/login', { method: 'POST', body: { username, password } }),

  /** Anonymous — no account required. deviceId keeps a stable identity. */
  registerDevice: (name: string, platform: string, deviceId?: string) =>
    request<RegisterDeviceResponse>('/register-device', {
      method: 'POST',
      body: { name, platform, deviceId },
    }),

  listDevices: (deviceToken: string) =>
    request<{ devices: DeviceDTO[] }>('/devices', { token: deviceToken }),

  /** Permission check + ICE server config for a peer connection. */
  connect: (deviceToken: string, toDeviceId: string) =>
    request<{ ok: boolean; iceServers: RTCIceServer[] }>('/connect', {
      method: 'POST',
      token: deviceToken,
      body: { toDeviceId },
    }),

  disconnect: (deviceToken: string, toDeviceId: string) =>
    request<{ ok: boolean }>('/disconnect', {
      method: 'POST',
      token: deviceToken,
      body: { toDeviceId },
    }),

  reportTransfer: (
    deviceToken: string,
    input: {
      fromDeviceId: string;
      fromDeviceName: string;
      toDeviceId: string;
      toDeviceName: string;
      fileName: string;
      fileSize: number;
      status: 'completed' | 'cancelled' | 'failed';
      startedAt: string;
    }
  ) => request<{ id: string }>('/history', { method: 'POST', token: deviceToken, body: input }),

  listHistory: (deviceToken: string) =>
    request<{ history: TransferHistoryDTO[] }>('/history', { token: deviceToken }),
};
