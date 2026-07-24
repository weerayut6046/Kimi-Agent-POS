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
import {
  clearSupabaseSession,
  getSupabaseBrowserClient,
  hasPersistedSupabaseSession,
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

export type StaffLoginResult = StaffSession;

const BRANCH_KEY = "pumppos_branch_id";
const STAFF_CACHE_KEY = "pumppos_staff_profile_v1";
const STAFF_CACHE_TTL_MS = 12 * 60 * 60_000;
const CACHED_SESSION_VALIDATION_DELAY_MS = 3_000;

const StaffContext = createContext<{
  staff: StaffSession | null;
  isCheckingSession: boolean;
  login: (staff: StaffLoginResult) => Promise<void>;
  switchBranch: (branchId: number) => Promise<void>;
  logout: () => void;
}>({
  staff: null,
  isCheckingSession: true,
  login: async () => {},
  switchBranch: async () => {},
  logout: () => {},
});

function normalizeStaff<T extends StaffSession>(staff: T): StaffSession {
  return {
    ...staff,
    menuPermissions: normalizeMenuPermissions(
      staff.role,
      staff.menuPermissions
    ),
  };
}

function isBranchSummary(value: unknown): value is BranchSummary {
  if (!value || typeof value !== "object") return false;
  const branch = value as Partial<BranchSummary>;
  return (
    typeof branch.id === "number" &&
    Number.isInteger(branch.id) &&
    branch.id > 0 &&
    typeof branch.code === "string" &&
    typeof branch.name === "string" &&
    typeof branch.address === "string" &&
    typeof branch.phone === "string" &&
    typeof branch.taxId === "string" &&
    typeof branch.active === "boolean"
  );
}

function readCachedStaff(): StaffSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STAFF_CACHE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw) as {
      savedAt?: unknown;
      staff?: Partial<StaffSession>;
    };
    const staff = payload.staff;
    if (
      typeof payload.savedAt !== "number" ||
      Date.now() - payload.savedAt > STAFF_CACHE_TTL_MS ||
      !staff ||
      typeof staff.id !== "number" ||
      !Number.isInteger(staff.id) ||
      staff.id <= 0 ||
      typeof staff.name !== "string" ||
      typeof staff.username !== "string" ||
      !["admin", "manager", "cashier"].includes(String(staff.role)) ||
      !Array.isArray(staff.menuPermissions) ||
      !staff.menuPermissions.every(
        permission => typeof permission === "string"
      ) ||
      typeof staff.branchId !== "number" ||
      !Number.isInteger(staff.branchId) ||
      typeof staff.branchCode !== "string" ||
      typeof staff.branchName !== "string" ||
      !isBranchSummary(staff.branch) ||
      !Array.isArray(staff.branches) ||
      !staff.branches.every(isBranchSummary) ||
      !(
        staff.accessGroup === null ||
        (typeof staff.accessGroup === "object" &&
          typeof staff.accessGroup.id === "number" &&
          typeof staff.accessGroup.name === "string")
      )
    ) {
      window.sessionStorage.removeItem(STAFF_CACHE_KEY);
      return null;
    }
    return normalizeStaff(staff as StaffSession);
  } catch {
    window.sessionStorage.removeItem(STAFF_CACHE_KEY);
    return null;
  }
}

function writeCachedStaff(staff: StaffSession | null): void {
  if (typeof window === "undefined") return;
  if (!staff) {
    window.sessionStorage.removeItem(STAFF_CACHE_KEY);
    return;
  }
  window.sessionStorage.setItem(
    STAFF_CACHE_KEY,
    JSON.stringify({ savedAt: Date.now(), staff })
  );
}

export function StaffProvider({ children }: { children: ReactNode }) {
  const [cachedStaff, setCachedStaff] = useState<StaffSession | null>(
    readCachedStaff
  );
  const [authReady, setAuthReady] = useState(
    () => !hasPersistedSupabaseSession() && cachedStaff === null
  );
  const [hasAuthSession, setHasAuthSession] = useState(
    () => cachedStaff !== null || hasPersistedSupabaseSession()
  );
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!hasAuthSession) return;

    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    let validationTimer: number | undefined;

    const validateSession = () => {
      void getSupabaseBrowserClient().then(async client => {
        if (!client || stopped) {
          if (!stopped) setAuthReady(true);
          return;
        }
        const { data } = await client.auth.getSession();
        if (stopped) return;
        const sessionAvailable = Boolean(data.session);
        setHasAuthSession(sessionAvailable);
        if (!sessionAvailable) {
          setCachedStaff(null);
          writeCachedStaff(null);
          localStorage.removeItem(BRANCH_KEY);
        }
        setAuthReady(true);

        const subscription = client.auth.onAuthStateChange((event, session) => {
          window.setTimeout(() => {
            if (stopped) return;
            const nextSessionAvailable = Boolean(session);
            setHasAuthSession(nextSessionAvailable);
            if (!nextSessionAvailable || event === "SIGNED_OUT") {
              setCachedStaff(null);
              writeCachedStaff(null);
              localStorage.removeItem(BRANCH_KEY);
              void utils.invalidate();
            }
          }, 0);
        });
        unsubscribe = () => subscription.data.subscription.unsubscribe();
      });
    };

    // A cached staff profile can paint the authenticated shell immediately,
    // while every API request still validates the persisted Supabase JWT.
    // Delay loading the Auth SDK so it cannot compete with the route's LCP.
    if (cachedStaff) {
      validationTimer = window.setTimeout(
        validateSession,
        CACHED_SESSION_VALIDATION_DELAY_MS
      );
    } else {
      validateSession();
    }

    return () => {
      stopped = true;
      if (validationTimer !== undefined) {
        window.clearTimeout(validationTimer);
      }
      unsubscribe?.();
    };
  }, [cachedStaff, hasAuthSession, utils]);

  const currentStaff = trpc.auth.currentStaff.useQuery(undefined, {
    enabled: authReady && hasAuthSession,
    retry: false,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const staff = useMemo(
    () =>
      !hasAuthSession || currentStaff.isError
        ? null
        : currentStaff.data?.authenticated
          ? normalizeStaff(currentStaff.data)
          : cachedStaff,
    [cachedStaff, currentStaff.data, currentStaff.isError, hasAuthSession]
  );

  useEffect(() => {
    if (staff) {
      localStorage.setItem(BRANCH_KEY, String(staff.branch.id));
      writeCachedStaff(staff);
    }
  }, [staff]);

  useEffect(() => {
    if (currentStaff.isError) {
      writeCachedStaff(null);
      localStorage.removeItem(BRANCH_KEY);
      void clearSupabaseSession();
    }
  }, [currentStaff.isError]);

  const login = async (nextStaff: StaffLoginResult) => {
    const normalized = normalizeStaff(nextStaff);
    localStorage.setItem(BRANCH_KEY, String(normalized.branch.id));
    setCachedStaff(normalized);
    writeCachedStaff(normalized);
    setHasAuthSession(true);
    utils.auth.currentStaff.setData(undefined, {
      authenticated: true,
      ...normalized,
    });
  };

  const switchBranch = async (branchId: number) => {
    if (!staff || branchId === staff.branch.id) return;
    if (staff.role !== "admin") {
      throw new Error("เฉพาะผู้ดูแลระบบเท่านั้นที่เปลี่ยนสาขาได้");
    }
    const switched = await utils.client.auth.switchBranch.mutate({ branchId });
    const normalized = normalizeStaff(switched);
    localStorage.setItem(BRANCH_KEY, String(normalized.branch.id));
    setCachedStaff(normalized);
    writeCachedStaff(normalized);
    await utils.invalidate();
    utils.auth.currentStaff.setData(undefined, {
      authenticated: true,
      ...normalized,
    });
  };

  const logout = () => {
    localStorage.removeItem(BRANCH_KEY);
    setCachedStaff(null);
    writeCachedStaff(null);
    setHasAuthSession(false);
    void clearSupabaseSession();
    void utils.invalidate();
  };

  const isCheckingSession =
    (!authReady && !cachedStaff) ||
    (hasAuthSession &&
      !staff &&
      (currentStaff.isPending || currentStaff.isFetching));

  return (
    <StaffContext.Provider
      value={{ staff, isCheckingSession, login, switchBranch, logout }}
    >
      {children}
    </StaffContext.Provider>
  );
}

export const useStaff = () => useContext(StaffContext);
