import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { trpc } from "@/providers/trpc";
import {
  normalizeMenuPermissions,
  type MenuPermissionKey,
  type StaffRole,
} from "@contracts/menuPermissions";
import {
  clearSupabaseSession,
  installSupabaseSession,
  type SupabaseRealtimeSession,
} from "@/lib/supabase";

export type StaffSession = {
  id: number;
  name: string;
  role: StaffRole;
  username: string;
  menuPermissions: MenuPermissionKey[];
  accessGroup: { id: number; name: string } | null;
  branchId: number;
  branchCode: string;
  branchName: string;
  branch: BranchSummary;
  branches: BranchSummary[];
  token: string;
};

export type BranchSummary = {
  id: number;
  code: string;
  name: string;
  address: string;
  phone: string;
  taxId: string;
  active: boolean;
};

export type StaffLoginResult = StaffSession & {
  supabaseSession: SupabaseRealtimeSession | null;
};

const KEY = "pumppos_staff";

const StaffContext = createContext<{
  staff: StaffSession | null;
  isCheckingSession: boolean;
  login: (s: StaffLoginResult) => Promise<void>;
  switchBranch: (branchId: number) => Promise<void>;
  logout: () => void;
}>({
  staff: null,
  isCheckingSession: false,
  login: async () => {},
  switchBranch: async () => {},
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
      const fallbackBranch: BranchSummary = saved.branch ?? {
        id: saved.branchId ?? 1,
        code: saved.branchCode ?? "MAIN",
        name: saved.branchName ?? "สาขาหลัก",
        address: "",
        phone: "",
        taxId: "",
        active: true,
      };
      return {
        ...saved,
        branchId: fallbackBranch.id,
        branchCode: fallbackBranch.code,
        branchName: fallbackBranch.name,
        branch: fallbackBranch,
        branches: saved.branches?.length
          ? saved.branches
          : [fallbackBranch],
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
  const bootstrappedSupabaseStaffId = useRef<number | null>(null);

  const currentStaff = trpc.auth.currentStaff.useQuery(
    { staffId: staff?.id ?? 1, sessionNonce },
    {
      enabled: Boolean(staff?.token),
      refetchInterval: 30_000,
      retry: false,
      refetchOnMount: "always",
    }
  );
  const { mutateAsync: issueRealtimeSession } =
    trpc.auth.realtimeSession.useMutation();
  const { mutateAsync: requestBranchSwitch } =
    trpc.auth.switchBranch.useMutation();
  const utils = trpc.useUtils();

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
              branchId: fresh.branchId,
              branchCode: fresh.branchCode,
              branchName: fresh.branchName,
              branch: fresh.branch,
              branches: fresh.branches,
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
      if (sessionRejected) void clearSupabaseSession();
    }
  }, [effectiveStaff, sessionRejected, staff]);

  useEffect(() => {
    const staffId = effectiveStaff?.id;
    if (!staffId) {
      bootstrappedSupabaseStaffId.current = null;
      return;
    }
    if (bootstrappedSupabaseStaffId.current === staffId) return;
    bootstrappedSupabaseStaffId.current = staffId;

    let cancelled = false;
    void issueRealtimeSession()
      .then(async session => {
        if (cancelled) return;
        const installed = await installSupabaseSession(session);
        if (!installed && !cancelled) await clearSupabaseSession();
      })
      .catch(async () => {
        if (!cancelled) await clearSupabaseSession();
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveStaff?.id, issueRealtimeSession]);

  const login = async (s: StaffLoginResult) => {
    const { supabaseSession, ...staffSession } = s;
    const normalized = {
      ...staffSession,
      menuPermissions: normalizeMenuPermissions(
        staffSession.role,
        staffSession.menuPermissions
      ),
    };
    bootstrappedSupabaseStaffId.current = normalized.id;
    const installed = await installSupabaseSession(supabaseSession);
    if (!installed) await clearSupabaseSession();
    localStorage.setItem(KEY, JSON.stringify(normalized));
    setSessionNonce(previous => previous + 1);
    setStaff(normalized);
  };
  const switchBranch = async (branchId: number) => {
    if (!effectiveStaff || branchId === effectiveStaff.branch.id) return;
    const switched = await requestBranchSwitch({ branchId });
    const { supabaseSession, ...staffSession } = switched;
    const normalized: StaffSession = {
      ...staffSession,
      menuPermissions: normalizeMenuPermissions(
        staffSession.role,
        staffSession.menuPermissions,
      ),
    };
    const installed = await installSupabaseSession(supabaseSession);
    if (!installed) await clearSupabaseSession();
    localStorage.setItem(KEY, JSON.stringify(normalized));
    bootstrappedSupabaseStaffId.current = normalized.id;
    setStaff(normalized);
    setSessionNonce((previous) => previous + 1);
    await utils.invalidate();
  };
  const logout = () => {
    localStorage.removeItem(KEY);
    bootstrappedSupabaseStaffId.current = null;
    setStaff(null);
    void clearSupabaseSession();
  };

  return (
    <StaffContext.Provider
      value={{
        staff: effectiveStaff,
        isCheckingSession,
        login,
        switchBranch,
        logout,
      }}
    >
      {children}
    </StaffContext.Provider>
  );
}

export const useStaff = () => useContext(StaffContext);
