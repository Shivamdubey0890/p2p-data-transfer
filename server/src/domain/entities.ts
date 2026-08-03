import { DeviceStatus } from '../../../shared/protocol';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
}

export interface Device {
  id: string;
  userId: string;
  name: string;
  platform: string;
  status: DeviceStatus;
  ip?: string;
  /** Current Socket.IO connection, if online. */
  socketId?: string;
  lastSeenAt: Date;
}

export interface TransferRecord {
  id: string;
  fromDeviceId: string;
  fromDeviceName: string;
  toDeviceId: string;
  toDeviceName: string;
  fileName: string;
  fileSize: number;
  status: 'completed' | 'cancelled' | 'failed';
  startedAt: Date;
  finishedAt?: Date;
}
