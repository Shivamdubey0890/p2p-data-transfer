import { Device, TransferRecord, User } from '../domain/entities';
import { IDeviceRepository, ITransferHistoryRepository, IUserRepository } from './interfaces';

export class InMemoryUserRepository implements IUserRepository {
  private readonly users = new Map<string, User>();

  async findById(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async findByUsername(username: string): Promise<User | undefined> {
    const needle = username.toLowerCase();
    for (const user of this.users.values()) {
      if (user.username.toLowerCase() === needle) return user;
    }
    return undefined;
  }

  async create(user: User): Promise<User> {
    this.users.set(user.id, user);
    return user;
  }
}

export class InMemoryDeviceRepository implements IDeviceRepository {
  private readonly devices = new Map<string, Device>();

  async findById(id: string): Promise<Device | undefined> {
    return this.devices.get(id);
  }

  async findBySocketId(socketId: string): Promise<Device | undefined> {
    for (const device of this.devices.values()) {
      if (device.socketId === socketId) return device;
    }
    return undefined;
  }

  async listOnline(): Promise<Device[]> {
    return [...this.devices.values()].filter((d) => d.status !== 'offline');
  }

  async upsert(device: Device): Promise<Device> {
    this.devices.set(device.id, device);
    return device;
  }

  async update(id: string, patch: Partial<Device>): Promise<Device | undefined> {
    const existing = this.devices.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    this.devices.set(id, updated);
    return updated;
  }
}

export class InMemoryTransferHistoryRepository implements ITransferHistoryRepository {
  private readonly records: TransferRecord[] = [];

  async create(record: TransferRecord): Promise<TransferRecord> {
    this.records.push(record);
    return record;
  }

  async listForDevice(deviceId: string, limit: number): Promise<TransferRecord[]> {
    return this.records
      .filter((r) => r.fromDeviceId === deviceId || r.toDeviceId === deviceId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit);
  }
}
