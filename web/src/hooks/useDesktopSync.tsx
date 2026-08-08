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
import type { DesktopOfflineRecoveryResult } from "@contracts/offline";
import { currentSupabaseAccessToken } from "@/lib/supabase";

type DesktopSyncContextValue = {
  status: DesktopSyncStatus | null;
  retry: () => Promise<void>;
  exportRecovery: () => Promise<DesktopOfflineRecoveryResult | null>;
  importRecovery: () => Promise<DesktopOfflineRecoveryResult | null>;
};

const DesktopSyncContext = createContext<DesktopSyncContextValue>({
  status: null,
  retry: async () => undefined,
  exportRecovery: async () => null,
  importRecovery: async () => null,
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
    const token = (await currentSupabaseAccessToken()) ?? undefined;
    const next = await window.posDesktop.retrySync(token);
    setStatus(next);
  }, []);

  const exportRecovery = useCallback(async () => {
    if (!window.posDesktop) return null;
    return window.posDesktop.exportOfflineRecovery();
  }, []);

  const importRecovery = useCallback(async () => {
    if (!window.posDesktop) return null;
    const result = await window.posDesktop.importOfflineRecovery();
    if (!result.canceled) {
      const token = (await currentSupabaseAccessToken()) ?? undefined;
      setStatus(await window.posDesktop.retrySync(token));
    }
    return result;
  }, []);

  const value = useMemo(
    () => ({ status, retry, exportRecovery, importRecovery }),
    [status, retry, exportRecovery, importRecovery]
  );
  return (
    <DesktopSyncContext.Provider value={value}>
      {children}
    </DesktopSyncContext.Provider>
  );
}

export function useDesktopSync() {
  return useContext(DesktopSyncContext);
}
