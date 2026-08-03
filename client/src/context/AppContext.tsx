import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DeviceDTO } from '@shared/protocol';
import { P2PManager } from '../p2p/P2PManager';
import { api } from '../services/api';

export interface ActiveSession {
  device: DeviceDTO;
  deviceToken: string;
  manager: P2PManager;
}

interface AppContextValue {
  session: ActiveSession | null;
  loading: boolean;
  /** Drop the current device identity and register a fresh one. */
  resetIdentity(): void;
}

const AppContext = createContext<AppContextValue | null>(null);

// sessionStorage is per-tab, so every browser tab is its own device —
// convenient for testing with two tabs on one machine.
const STORAGE_KEY = 'p2p-session';

interface PersistedSession {
  device: DeviceDTO;
  deviceToken: string;
}

function detectPlatform(): string {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac/i.test(ua)) return 'macOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad/i.test(ua)) return 'iOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Web';
}

function generateDeviceName(): string {
  return `${detectPlatform()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [loading, setLoading] = useState(true);
  const bootstrapping = useRef(false);

  const activate = useCallback((persisted: PersistedSession): ActiveSession => {
    const manager = new P2PManager(persisted.device.id, persisted.device.name, persisted.deviceToken);
    manager.start();
    const active: ActiveSession = { ...persisted, manager };
    setSession(active);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    return active;
  }, []);

  const registerFresh = useCallback(async () => {
    const { device, deviceToken } = await api.registerDevice(generateDeviceName(), detectPlatform());
    activate({ device, deviceToken });
  }, [activate]);

  // No login: restore this tab's device identity, or auto-register a new one.
  useEffect(() => {
    if (bootstrapping.current) return;
    bootstrapping.current = true;
    (async () => {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          activate(JSON.parse(raw) as PersistedSession);
          return;
        } catch {
          sessionStorage.removeItem(STORAGE_KEY);
        }
      }
      await registerFresh().catch(() => {
        // Server unreachable — retry shortly so the app self-heals.
        setTimeout(() => {
          bootstrapping.current = false;
          sessionStorage.removeItem(STORAGE_KEY);
          window.location.reload();
        }, 3000);
      });
    })().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the server restarted, our stored device is gone and the socket is
  // rejected — drop the stale identity and register a fresh one. Retries
  // because the server may still be mid-restart when we first try.
  const recovering = useRef(false);
  useEffect(() => {
    if (!session) return;
    return session.manager.on('staleIdentity', () => {
      if (recovering.current) return;
      recovering.current = true;
      session.manager.stop();
      sessionStorage.removeItem(STORAGE_KEY);
      const attempt = (triesLeft: number) => {
        registerFresh()
          .then(() => {
            recovering.current = false;
          })
          .catch(() => {
            if (triesLeft > 0) setTimeout(() => attempt(triesLeft - 1), 3000);
            else recovering.current = false;
          });
      };
      attempt(10);
    });
  }, [session, registerFresh]);

  const resetIdentity = useCallback(() => {
    session?.manager.stop();
    sessionStorage.removeItem(STORAGE_KEY);
    setSession(null);
    void registerFresh();
  }, [session, registerFresh]);

  const value = useMemo(
    () => ({ session, loading, resetIdentity }),
    [session, loading, resetIdentity]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
