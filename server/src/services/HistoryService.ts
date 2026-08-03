import { v4 as uuid } from 'uuid';
import { TransferHistoryDTO } from '../../../shared/protocol';
import { TransferRecord } from '../domain/entities';
import { ITransferHistoryRepository } from '../repositories/interfaces';
import { HttpError } from '../http/errors';

export interface ReportTransferInput {
  fromDeviceId: string;
  fromDeviceName: string;
  toDeviceId: string;
  toDeviceName: string;
  fileName: string;
  fileSize: number;
  status: 'completed' | 'cancelled' | 'failed';
  startedAt: string;
}

/**
 * Stores transfer METADATA only (names, sizes, outcome) for the dashboard
 * history view. File content never reaches this server.
 */
export class HistoryService {
  constructor(private readonly history: ITransferHistoryRepository) {}

  async report(reporterDeviceId: string, input: ReportTransferInput): Promise<TransferRecord> {
    if (input.fromDeviceId !== reporterDeviceId && input.toDeviceId !== reporterDeviceId) {
      throw new HttpError(403, 'Can only report transfers involving your own device');
    }
    return this.history.create({
      id: uuid(),
      fromDeviceId: input.fromDeviceId,
      fromDeviceName: input.fromDeviceName,
      toDeviceId: input.toDeviceId,
      toDeviceName: input.toDeviceName,
      fileName: input.fileName,
      fileSize: input.fileSize,
      status: input.status,
      startedAt: new Date(input.startedAt),
      finishedAt: new Date(),
    });
  }

  async listForDevice(deviceId: string, limit = 100): Promise<TransferHistoryDTO[]> {
    const records = await this.history.listForDevice(deviceId, limit);
    return records.map((r) => ({
      id: r.id,
      fromDeviceId: r.fromDeviceId,
      fromDeviceName: r.fromDeviceName,
      toDeviceId: r.toDeviceId,
      toDeviceName: r.toDeviceName,
      fileName: r.fileName,
      fileSize: r.fileSize,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString(),
    }));
  }
}
