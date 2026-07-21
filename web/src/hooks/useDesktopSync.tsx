import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { DesktopSyncStatus } from "@contracts/offline";

type DesktopSyncContextValue = {
  status: DesktopSyncStatus | null;
  retry: () => Promise<void>;
};

const DesktopSyncContext = createContext<DesktopSyncContextValue>({
  status: null,
  retry: async () => undefined,
});

export function DesktopSyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<DesktopSyncStatus | null>(null);

  useEffect(() => {
    const desktop = window.posDesktop;
    if (!desktop) return;

    let active = true;
    void desktop.getSyncStatus().then(next => {
      if (active) setStatus(next);
    });
    const unsubscribe = desktop.onSyncStatus(next => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const retry = useCallback(async () => {
    if (!window.posDesktop) return;
    setStatus(current =>
      current ? { ...current, syncing: true, lastError: null } : current
    );
    const next = await window.posDesktop.retrySync();
    setStatus(next);
  }, []);

  const value = useMemo(() => ({ status, retry }), [status, retry]);
  return (
    <DesktopSyncContext.Provider value={value}>
      {children}
    </DesktopSyncContext.Provider>
  );
}

export function useDesktopSync() {
  return useContext(DesktopSyncContext);
}
