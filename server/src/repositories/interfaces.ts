import { Device, TransferRecord, User } from '../domain/entities';

/**
 * Repository contracts. The default implementations are in-memory (see
 * ./memory.ts) which is sufficient for a single signaling node. To persist,
 * implement these against Postgres/Redis and swap them in the container —
 * nothing else in the codebase changes. SQL schema: docs/DATABASE.md.
 */

export interface IUserRepository {
  findById(id: string): Promise<User | undefined>;
  findByUsername(username: string): Promise<User | undefined>;
  create(user: User): Promise<User>;
}

export interface IDeviceRepository {
  findById(id: string): Promise<Device | undefined>;
  findBySocketId(socketId: string): Promise<Device | undefined>;
  listOnline(): Promise<Device[]>;
  upsert(device: Device): Promise<Device>;
  update(id: string, patch: Partial<Device>): Promise<Device | undefined>;
}

export interface ITransferHistoryRepository {
  create(record: TransferRecord): Promise<TransferRecord>;
  listForDevice(deviceId: string, limit: number): Promise<TransferRecord[]>;
}
