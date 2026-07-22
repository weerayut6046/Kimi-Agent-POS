import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { trpc } from "@/providers/trpc";
import {
  normalizeMenuPermissions,
  type MenuPermissionKey,
  type StaffRole,
} from "@contracts/menuPermissions";

export type StaffSession = {
  id: number;
  name: string;
  role: StaffRole;
  username: string;
  menuPermissions: MenuPermissionKey[];
  accessGroup: { id: number; name: string } | null;
  token: string;
};

const KEY = "pumppos_staff";

const StaffContext = createContext<{
  staff: StaffSession | null;
  isCheckingSession: boolean;
  login: (s: StaffSession) => void;
  logout: () => void;
}>({
  staff: null,
  isCheckingSession: false,
  login: () => {},
  logout: () => {},
});

function hasUsableToken(token: unknown): token is string {
  if (typeof token !== "string") return false;
  try {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) return false;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(
      atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))
    ) as { exp?: unknown };
    return (
      typeof claims.exp === "number" &&
      claims.exp > Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}

export function StaffProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<StaffSession | null>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw) as StaffSession;
      if (!hasUsableToken(saved.token)) return null;
      return {
        ...saved,
        accessGroup: saved.accessGroup ?? null,
        menuPermissions: normalizeMenuPermissions(
          saved.role,
          saved.menuPermissions
        ),
      };
    } catch {
      return null;
    }
  });
  const [sessionNonce, setSessionNonce] = useState(() => Date.now());

  const currentStaff = trpc.auth.currentStaff.useQuery(
    { staffId: staff?.id ?? 1, sessionNonce },
    {
      enabled: Boolean(staff?.token),
      refetchInterval: 30_000,
      retry: false,
      refetchOnMount: "always",
    }
  );

  const fresh = currentStaff.data;
  const hasSessionToken = Boolean(staff?.token);
  const sessionAccepted = Boolean(
    staff &&
      hasSessionToken &&
      currentStaff.isSuccess &&
      fresh?.authenticated &&
      fresh.id === staff.id
  );
  const sessionRejected = Boolean(
    staff &&
      (!hasSessionToken ||
        (currentStaff.isSuccess &&
          (!fresh?.authenticated || fresh.id !== staff.id)))
  );
  const isCheckingSession = Boolean(
    staff &&
      hasSessionToken &&
      !sessionAccepted &&
      !sessionRejected &&
      !currentStaff.isError
  );
  const effectiveStaff = useMemo<StaffSession | null>(
    () =>
      !staff || !sessionAccepted
        ? null
        : fresh?.authenticated
          ? {
              id: fresh.id,
              name: fresh.name,
              role: fresh.role,
              username: fresh.username,
              menuPermissions: fresh.menuPermissions,
              accessGroup: fresh.accessGroup,
              token: fresh.token,
            }
          : null,
    [fresh, sessionAccepted, staff]
  );

  useEffect(() => {
    if (effectiveStaff) {
      localStorage.setItem(KEY, JSON.stringify(effectiveStaff));
    } else if (!staff || sessionRejected) {
      localStorage.removeItem(KEY);
    }
  }, [effectiveStaff, sessionRejected, staff]);

  const login = (s: StaffSession) => {
    const normalized = {
      ...s,
      menuPermissions: normalizeMenuPermissions(s.role, s.menuPermissions),
    };
    localStorage.setItem(KEY, JSON.stringify(normalized));
    setSessionNonce(previous => previous + 1);
    setStaff(normalized);
  };
  const logout = () => {
    localStorage.removeItem(KEY);
    setStaff(null);
  };

  return (
    <StaffContext.Provider
      value={{ staff: effectiveStaff, isCheckingSession, login, logout }}
    >
      {children}
    </StaffContext.Provider>
  );
}

export const useStaff = () => useContext(StaffContext);
