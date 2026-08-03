import { v4 as uuid } from 'uuid';
import { DeviceDTO } from '../../../shared/protocol';
import { Device } from '../domain/entities';
import { IDeviceRepository } from '../repositories/interfaces';
import { HttpError } from '../http/errors';

export class DeviceService {
  constructor(private readonly devices: IDeviceRepository) {}

  async register(userId: string, name: string, platform: string): Promise<Device> {
    if (!name || name.length > 64) throw new HttpError(400, 'Device name is required (max 64 chars)');
    const device: Device = {
      id: uuid(),
      userId,
      name,
      platform: platform || 'unknown',
      status: 'offline', // becomes online when the socket connects
      lastSeenAt: new Date(),
    };
    return this.devices.upsert(device);
  }

  async markOnline(deviceId: string, socketId: string, ip?: string): Promise<Device> {
    const device = await this.devices.update(deviceId, {
      status: 'online',
      socketId,
      ip,
      lastSeenAt: new Date(),
    });
    if (!device) throw new HttpError(404, 'Device not found');
    return device;
  }

  async markOffline(deviceId: string): Promise<Device | undefined> {
    return this.devices.update(deviceId, {
      status: 'offline',
      socketId: undefined,
      lastSeenAt: new Date(),
    });
  }

  async listOnline(): Promise<Device[]> {
    return this.devices.listOnline();
  }

  async getById(deviceId: string): Promise<Device | undefined> {
    return this.devices.findById(deviceId);
  }

  async getBySocketId(socketId: string): Promise<Device | undefined> {
    return this.devices.findBySocketId(socketId);
  }

  /**
   * Permission gate evaluated before any signaling is forwarded.
   * Extend here for allow-lists, same-account-only policies, etc.
   *
   * Deliberately does NOT check the source's presence: the caller proved
   * liveness by making this request (valid device JWT / live socket), and the
   * in-memory presence row can lag behind reality around restarts/reconnects.
   */
  async assertCanConnect(fromDeviceId: string, toDeviceId: string): Promise<Device> {
    if (fromDeviceId === toDeviceId) throw new HttpError(400, 'Cannot connect a device to itself');
    const target = await this.devices.findById(toDeviceId);
    if (!target || target.status === 'offline' || !target.socketId) {
      throw new HttpError(404, 'Target device is not online — ask them to reload the page');
    }
    return target;
  }

  static toDTO(device: Device): DeviceDTO {
    return {
      id: device.id,
      userId: device.userId,
      name: device.name,
      platform: device.platform,
      status: device.status,
      ip: device.ip,
      lastSeenAt: device.lastSeenAt.toISOString(),
    };
  }
}
