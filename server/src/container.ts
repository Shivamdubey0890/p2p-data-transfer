import {
  InMemoryDeviceRepository,
  InMemoryTransferHistoryRepository,
  InMemoryUserRepository,
} from './repositories/memory';
import { AuthService } from './services/AuthService';
import { DeviceService } from './services/DeviceService';
import { HistoryService } from './services/HistoryService';

/**
 * Composition root. Swap repository implementations here (e.g. Postgres)
 * without touching services, routes, or the gateway.
 */
export function buildContainer() {
  const userRepo = new InMemoryUserRepository();
  const deviceRepo = new InMemoryDeviceRepository();
  const historyRepo = new InMemoryTransferHistoryRepository();

  const auth = new AuthService(userRepo);
  const devices = new DeviceService(deviceRepo);
  const history = new HistoryService(historyRepo);

  return { auth, devices, history };
}

export type Container = ReturnType<typeof buildContainer>;
