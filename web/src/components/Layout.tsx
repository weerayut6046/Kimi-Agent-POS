import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { getMutationKey, getQueryKey } from "@trpc/react-query";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import {
  LayoutDashboard,
  ShoppingCart,
  Clock,
  Fuel,
  Users,
  Building2,
  HandCoins,
  Receipt,
  Banknote,
  FileText,
  FileSignature,
  Settings,
  LogOut,
  Droplet,
  ScrollText,
  Menu,
  MoreHorizontal,
  ShieldCheck,
  ShieldAlert,
  CalendarDays,
  Search,
  CornerDownLeft,
  Sparkles,
  BadgePlus,
  ChartNoAxesCombined,
  PanelsTopLeft,
  type LucideIcon,
} from "lucide-react";
import { DesktopSyncBanner } from "@/components/DesktopSyncBanner";
import { useStaff } from "@/hooks/useStaff";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { roleLabel } from "@/lib/format";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  hasMenuPermission,
  type MenuPermissionKey,
} from "@contracts/menuPermissions";
import { toast } from "sonner";
import type { DeploymentMode } from "@contracts/deployment";
import { isPosWorkspacePath } from "@/lib/navigationWorkspaces";

const LowStockAlert = lazy(() => import("@/components/LowStockAlert"));
const AssistantChat = lazy(() => import("@/components/AssistantChat"));

type MenuItem = {
  permission: MenuPermissionKey;
  to: string;
  label: string;
  shortLabel?: string;
  icon: LucideIcon;
  end?: boolean;
  adminOnly?: boolean;
  /** แสดงเฉพาะ admin/manager (cashier ไม่เห็นเมนู) */
  managerOnly?: boolean;
  group: "station" | "customer" | "document" | "system";
};

const menus: MenuItem[] = [
  {
    permission: "dashboard",
    to: "/",
    label: "ภาพรวมสถานี",
    shortLabel: "ภาพรวม",
    icon: LayoutDashboard,
    end: true,
    group: "station",
  },
  {
    permission: "pos",
    to: "/pos",
    label: "ขายหน้าลาน",
    shortLabel: "ขาย",
    icon: ShoppingCart,
    group: "station",
  },
  {
    permission: "shifts",
    to: "/shifts",
    label: "จัดการกะ",
    shortLabel: "กะ",
    icon: Clock,
    group: "station",
  },
  {
    permission: "workforce",
    to: "/workforce",
    label: "พนักงานและตารางงาน",
    shortLabel: "พนักงาน",
    icon: CalendarDays,
    group: "station",
  },
  {
    permission: "stock",
    to: "/stock",
    label: "สต๊อกและถัง",
    shortLabel: "สต๊อก",
    icon: Fuel,
    group: "station",
  },
  {
    permission: "fuel_forecast",
    to: "/stock/forecast",
    label: "วางแผนสั่งน้ำมัน",
    shortLabel: "สั่งน้ำมัน",
    icon: ChartNoAxesCombined,
    group: "station",
  },
  {
    permission: "members",
    to: "/members",
    label: "สมาชิก",
    icon: Users,
    group: "customer",
  },
  {
    permission: "members",
    to: "/member-cards",
    label: "สร้างชุดบัตรสมาชิก",
    icon: BadgePlus,
    managerOnly: true,
    group: "customer",
  },
  {
    permission: "customers",
    to: "/customers",
    label: "ลูกค้าธุรกิจ",
    icon: Building2,
    group: "customer",
  },
  {
    permission: "debts",
    to: "/debts",
    label: "ลูกหนี้เครดิต",
    icon: HandCoins,
    group: "customer",
  },
  {
    permission: "sales",
    to: "/sales",
    label: "ประวัติการขาย",
    icon: Receipt,
    group: "document",
  },
  {
    permission: "profitability",
    to: "/reports/profitability",
    label: "ต้นทุนและกำไร",
    shortLabel: "กำไร",
    icon: ChartNoAxesCombined,
    managerOnly: true,
    group: "document",
  },
  {
    permission: "expenses",
    to: "/expenses",
    label: "ค่าใช้จ่าย",
    icon: Banknote,
    group: "document",
  },
  {
    permission: "tax_invoices",
    to: "/tax-invoices",
    label: "ใบกำกับภาษี",
    icon: FileText,
    group: "document",
  },
  {
    permission: "documents",
    to: "/documents",
    label: "เอกสาร",
    icon: FileSignature,
    managerOnly: true,
    group: "document",
  },
  {
    permission: "audit",
    to: "/audit",
    label: "บันทึกการใช้งาน",
    icon: ScrollText,
    adminOnly: true,
    group: "system",
  },
  {
    permission: "security",
    to: "/security",
    label: "ความปลอดภัย",
    icon: ShieldAlert,
    adminOnly: true,
    group: "system",
  },
  {
    permission: "settings",
    to: "/settings",
    label: "ตั้งค่าระบบ",
    shortLabel: "ตั้งค่า",
    icon: Settings,
    group: "system",
  },
  {
    permission: "setup",
    to: "/setup",
    label: "เริ่มต้นใช้งานกิจการ",
    shortLabel: "เริ่มต้น",
    icon: Sparkles,
    adminOnly: true,
    group: "system",
  },
];

const groupLabels: Record<MenuItem["group"], string> = {
  station: "งานหน้าสถานี",
  customer: "ลูกค้าและเครดิต",
  document: "เอกสารและรายงาน",
  system: "ระบบ",
};

const routePreloaders: Record<string, () => Promise<unknown>> = {
  "/": () => import("@/pages/Dashboard"),
  "/pos": () => import("@/pages/Pos"),
  "/shifts": () => import("@/pages/Shifts"),
  "/workforce": () => import("@/pages/Workforce"),
  "/stock": () => import("@/pages/Stock"),
  "/stock/forecast": () => import("@/pages/FuelForecast"),
  "/stock/count": () => import("@/pages/StockCount"),
  "/members": () => import("@/pages/Members"),
  "/member-cards": () => import("@/pages/MemberCardBatches"),
  "/customers": () => import("@/pages/Customers"),
  "/debts": () => import("@/pages/Debts"),
  "/sales": () => import("@/pages/Sales"),
  "/expenses": () => import("@/pages/Expenses"),
  "/reports/profitability": () => import("@/pages/Profitability"),
  "/tax-invoices": () => import("@/pages/TaxInvoices"),
  "/documents": () => import("@/pages/Documents"),
  "/audit": () => import("@/pages/Audit"),
  "/security": () => import("@/pages/Security"),
  "/settings": () => import("@/pages/Settings"),
};
const preloadedRoutes = new Set<string>();

async function preloadRoute(path: string): Promise<void> {
  // In development Vite serves the full source-module graph, so even a mouse
  // pass over the sidebar can create dozens of requests. Production uses
  // compact chunks, where intent-based preloading is beneficial.
  if (import.meta.env.DEV) return;
  const loader = routePreloaders[path];
  if (!loader || preloadedRoutes.has(path)) return;
  preloadedRoutes.add(path);
  try {
    await loader();
  } catch {
    preloadedRoutes.delete(path);
  }
}

export default function Layout({
  deploymentMode = "business",
}: {
  deploymentMode?: DeploymentMode;
}) {
  return deploymentMode === "platform" ? (
    <PlatformLayout />
  ) : (
    <BusinessLayout />
  );
}

function PlatformLayout() {
  const { staff, logout } = useStaff();
  const navigate = useNavigate();
  const handleLogout = () => {
    logout();
    navigate("/login");
  };
  return (
    <div className="min-h-screen bg-background text-foreground lg:pl-[248px]">
      <aside className="pos-sidebar fixed inset-y-0 left-0 hidden w-[248px] flex-col border-r border-sidebar-border p-5 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3 border-b border-sidebar-border pb-5">
          <PanelsTopLeft className="size-7 text-primary" />
          <div>
            <div className="pos-sidebar-title font-heading font-semibold">
              PumpPOS
            </div>
            <div className="pos-sidebar-subtitle text-xs text-sidebar-foreground/70">
              หลังบ้านแพลตฟอร์ม
            </div>
          </div>
        </div>
        <nav className="mt-6 flex-1" aria-label="เมนูแพลตฟอร์ม">
          <NavLink
            to="/platform"
            className="pos-nav-link pos-nav-active flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium"
          >
            <Building2 className="size-5" /> จัดการกิจการ
          </NavLink>
        </nav>
        <div className="border-t border-sidebar-border pt-4">
          <div className="mb-3 truncate text-sm">{staff?.name}</div>
          <button
            type="button"
            onClick={handleLogout}
            className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent"
          >
            <LogOut className="size-4" /> ออกจากระบบ
          </button>
        </div>
      </aside>
      <header className="flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <PanelsTopLeft className="size-5 text-primary" />
          <div>
            <div className="font-heading font-semibold">หลังบ้านแพลตฟอร์ม</div>
            <div className="text-xs text-muted-foreground">ทะเบียนกิจการ</div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm lg:hidden"
        >
          <LogOut className="size-4" /> ออกจากระบบ
        </button>
      </header>
      <main className="mx-auto max-w-[1650px] p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}

function BusinessLayout() {
  const { staff, logout, switchBranch } = useStaff();
  const navigate = useNavigate();
  const location = useLocation();
  const [loadSecondaryData, setLoadSecondaryData] = useState(false);
  const { data: settingMap } = trpc.catalog.getSettings.useQuery(undefined, {
    enabled: loadSecondaryData,
  });
  const { data: currentShift } = trpc.pos.currentShift.useQuery(undefined, {
    enabled: loadSecondaryData,
    refetchInterval: 30000,
    trpc: { context: { skipBatch: true } },
  });
  const [now, setNow] = useState(() => new Date());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [switchingBranch, setSwitchingBranch] = useState(false);
  const pendingTemplateChanges = useIsMutating({
    mutationKey: getMutationKey(trpc.catalog.updateTemplate),
  });
  const pendingThemeChanges = useIsMutating({
    mutationKey: getMutationKey(trpc.catalog.updateTheme),
  });
  const savingAppearance = pendingTemplateChanges + pendingThemeChanges > 0;
  const pendingMutations = useIsMutating();
  const pendingSetupReads = useIsFetching({
    queryKey: getQueryKey(trpc.onboarding.state, undefined, "query"),
  });
  const savingSetup =
    location.pathname === "/setup" &&
    (pendingMutations > 0 || pendingSetupReads > 0);
  const shopName = settingMap?.shop_name ?? "PumpPOS";
  const canSeeStockAlerts = Boolean(
    staff && hasMenuPermission(staff.role, staff.menuPermissions, "stock")
  );
  const visibleMenus = useMemo(() => {
    if (!staff) return [];
    return menus.filter(
      menu =>
        hasMenuPermission(staff.role, staff.menuPermissions, menu.permission) &&
        (!menu.adminOnly || staff.role === "admin") &&
        (!menu.managerOnly ||
          staff.role === "admin" ||
          staff.role === "manager")
    );
  }, [staff]);
  const posWorkspaceMenus = visibleMenus.filter(menu =>
    isPosWorkspacePath(menu.to)
  );
  const businessWorkspaceMenus = visibleMenus.filter(
    menu => !isPosWorkspacePath(menu.to)
  );
  const posWorkspace = isPosWorkspacePath(location.pathname);
  const workspaceLabel = posWorkspace ? "หน้าขาย" : "หลังบ้านกิจการ";
  const workspaceMenus = posWorkspace
    ? posWorkspaceMenus
    : businessWorkspaceMenus;
  const workspaceMobilePaths = posWorkspace
    ? ["/pos", "/shifts", "/sales"]
    : ["/", "/stock", "/members"];
  const currentMenu = visibleMenus
    .filter(menu =>
      menu.end
        ? location.pathname === menu.to
        : location.pathname === menu.to ||
          location.pathname.startsWith(`${menu.to}/`)
    )
    .sort((a, b) => b.to.length - a.to.length)[0];
  const moreMenuIsActive = Boolean(
    currentMenu && !workspaceMobilePaths.includes(currentMenu.to)
  );
  const CurrentMenuIcon = currentMenu?.icon ?? Droplet;

  const handleBranchChange = async (branchId: number) => {
    if (
      !staff ||
      branchId === staff.branch.id ||
      switchingBranch ||
      savingAppearance ||
      savingSetup
    )
      return;
    setSwitchingBranch(true);
    try {
      await switchBranch(branchId);
    } catch (error) {
      toast.error("เปลี่ยนสาขาไม่สำเร็จ", {
        description:
          error instanceof Error ? error.message : "ไม่สามารถเปลี่ยนสาขาได้",
      });
    } finally {
      setSwitchingBranch(false);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setLoadSecondaryData(true), 3_000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(open => !open);
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const timeLabel = new Intl.DateTimeFormat("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  const dateLabel = new Intl.DateTimeFormat("th-TH", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(now);
  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const renderNavItem = (menu: MenuItem, closeOnClick = false) => {
    const link = (
      <NavLink
        to={menu.to}
        end={
          menu.end ||
          (menu.to === "/stock" && currentMenu?.permission === "fuel_forecast")
        }
        onMouseEnter={() => void preloadRoute(menu.to)}
        onFocus={() => void preloadRoute(menu.to)}
        onTouchStart={() => void preloadRoute(menu.to)}
        onClick={closeOnClick ? () => setMobileMenuOpen(false) : undefined}
        className={({ isActive }) =>
          cn(
            "pos-nav-link group relative flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
            isActive
              ? "pos-nav-active"
              : "text-white/60 hover:bg-white/[0.07] hover:text-white"
          )
        }
      >
        {({ isActive }) => (
          <>
            <span
              className={cn(
                "pos-nav-icon grid size-8 shrink-0 place-items-center rounded-lg transition-all duration-200",
                isActive
                  ? "pos-nav-icon-active"
                  : "bg-white/[0.04] text-white/50 group-hover:bg-white/10 group-hover:text-primary"
              )}
            >
              <menu.icon className="size-[18px]" />
            </span>
            <span className="pos-nav-label">{menu.label}</span>
            {menu.to === "/pos" && !isActive && (
              <span className="ml-auto size-2 rounded-full bg-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]" />
            )}
          </>
        )}
      </NavLink>
    );

    return link;
  };

  const renderWorkspaceSwitcher = () => (
    <div
      className="relative mx-3 mt-3 grid grid-cols-2 gap-1 rounded-xl border border-sidebar-border bg-sidebar-accent/40 p-1"
      aria-label="พื้นที่ทำงานกิจการ"
    >
      {[
        { label: "หน้าขาย", items: posWorkspaceMenus, selected: posWorkspace },
        {
          label: "หลังบ้านกิจการ",
          items: businessWorkspaceMenus,
          selected: !posWorkspace,
        },
      ].map(workspace => (
        <button
          key={workspace.label}
          type="button"
          aria-pressed={workspace.selected}
          disabled={!workspace.items.length}
          onClick={() => {
            navigate(workspace.items[0].to);
            setMobileMenuOpen(false);
          }}
          className={cn(
            "min-h-11 rounded-lg px-2 text-xs font-medium transition-colors disabled:opacity-40",
            workspace.selected
              ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          )}
        >
          {workspace.label}
        </button>
      ))}
    </div>
  );

  return (
    <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
      <div className="pos-shell relative flex min-h-[100dvh] bg-transparent">
        <aside className="pos-sidebar fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col overflow-hidden border-r border-white/10 text-white shadow-[10px_0_30px_rgba(15,39,52,0.08)] lg:flex">
          <div className="pos-sidebar-decoration surface-grid pointer-events-none absolute inset-0 opacity-20" />
          <div className="pos-sidebar-brand relative flex h-[72px] shrink-0 items-center gap-3 border-b border-white/[0.08] px-5">
            <div className="pos-brand-mark grid size-10 place-items-center rounded-xl text-primary-foreground shadow-[0_8px_20px_hsl(var(--primary)/0.24)] ring-1 ring-white/15">
              <Droplet className="size-5 fill-white/20" />
            </div>
            <div className="min-w-0">
              <div className="pos-sidebar-title truncate font-heading text-base font-semibold leading-tight">
                {shopName}
              </div>
              <div className="pos-sidebar-subtitle mt-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-white/40">
                <Sparkles className="size-2.5 text-primary" /> {workspaceLabel}
              </div>
            </div>
          </div>

          <div className="pos-sidebar-status relative mx-3 mt-3 rounded-xl border border-white/[0.1] bg-white/[0.045] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "relative flex size-2.5",
                    currentShift ? "" : "opacity-70"
                  )}
                >
                  {currentShift && (
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  )}
                  <span
                    className={cn(
                      "relative inline-flex size-2.5 rounded-full",
                      currentShift ? "bg-primary" : "bg-orange-400"
                    )}
                  />
                </span>
                <div>
                  <div className="pos-sidebar-status-title text-xs font-semibold text-white">
                    {currentShift ? "กะกำลังเปิด" : "ยังไม่ได้เปิดกะ"}
                  </div>
                  <div className="pos-sidebar-status-label mt-0.5 text-[11px] text-white/50">
                    {currentShift?.staffName ?? "พร้อมเริ่มงาน"}
                  </div>
                </div>
              </div>
              {loadSecondaryData && canSeeStockAlerts && (
                <Suspense fallback={null}>
                  <LowStockAlert />
                </Suspense>
              )}
            </div>
          </div>

          {renderWorkspaceSwitcher()}
          <nav className="relative flex-1 overflow-y-auto overscroll-contain px-2.5 pb-4 pt-3 station-scrollbar">
            {(["station", "customer", "document", "system"] as const).map(
              group => {
                const groupMenus = workspaceMenus.filter(
                  menu => menu.group === group
                );
                if (!groupMenus.length) return null;
                return (
                  <div key={group} className="mb-4">
                    <div className="pos-sidebar-section-label mb-1.5 px-3 text-[9px] font-bold uppercase tracking-[0.18em] text-white/[0.28]">
                      {groupLabels[group]}
                    </div>
                    <div className="space-y-1">
                      {groupMenus.map(menu => (
                        <div key={menu.to}>{renderNavItem(menu)}</div>
                      ))}
                    </div>
                  </div>
                );
              }
            )}
          </nav>

          <div className="pos-sidebar-footer relative shrink-0 border-t border-white/10 bg-black/10 p-4">
            <label className="mb-3 block">
              <span className="pos-sidebar-section-label mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">
                <Building2 className="size-3" /> สาขาที่ใช้งาน
              </span>
              <select
                value={staff?.branch.id ?? ""}
                disabled={
                  staff?.role !== "admin" ||
                  switchingBranch ||
                  savingAppearance ||
                  savingSetup ||
                  (staff?.branches.length ?? 0) <= 1
                }
                onChange={event =>
                  void handleBranchChange(Number(event.target.value))
                }
                className="pos-sidebar-branch h-10 w-full rounded-lg border border-white/10 bg-white/[0.07] px-3 text-sm font-medium text-white outline-none transition focus:border-[#47c6b7] disabled:opacity-60 [&>option]:text-slate-900"
              >
                {staff?.branches.map(branch => (
                  <option key={branch.id} value={branch.id}>
                    {branch.code} · {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-3">
              <div className="pos-sidebar-avatar grid size-10 shrink-0 place-items-center rounded-lg bg-sidebar-accent font-heading text-sm font-semibold text-white ring-1 ring-white/10">
                {staff?.name?.trim().charAt(0) || "P"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="pos-sidebar-staff-name truncate text-sm font-semibold">
                  {staff?.name}
                </div>
                <div className="pos-sidebar-staff-role mt-0.5 flex items-center gap-1 text-[11px] text-white/50">
                  <ShieldCheck className="size-3" />{" "}
                  {staff ? (roleLabel[staff.role] ?? staff.role) : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                aria-label="ออกจากระบบ"
                className="pos-sidebar-logout grid size-9 place-items-center rounded-lg text-white/[0.55] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <LogOut className="size-[18px]" />
              </button>
            </div>
          </div>
        </aside>

        <div className="pos-shell-body min-w-0 flex-1 pb-[calc(88px+env(safe-area-inset-bottom))] lg:ml-[248px] lg:pb-0">
          <header className="pos-desktop-header sticky top-0 z-20 hidden h-[72px] items-center justify-between border-b border-slate-200/90 bg-white/95 px-7 shadow-[0_1px_8px_rgba(15,39,52,0.04)] backdrop-blur-xl lg:flex">
            <div className="flex items-center gap-4">
              <div className="grid size-10 place-items-center rounded-lg bg-accent text-accent-foreground ring-1 ring-border">
                <CurrentMenuIcon className="size-5" />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary/70">
                  {workspaceLabel} · {staff?.branch.name}
                </div>
                <div className="mt-0.5 font-heading text-lg font-bold tracking-[-0.03em] text-slate-900">
                  {currentMenu?.label ?? "PumpPOS"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setCommandOpen(true)}
                className="group flex h-10 w-48 items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-card hover:text-primary xl:w-56"
              >
                <Search className="size-4 transition-transform group-hover:scale-110" />
                <span className="flex-1">ค้นหาเมนู...</span>
                <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-sans text-[10px] font-semibold text-slate-500 shadow-xs">
                  Ctrl K
                </kbd>
              </button>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    currentShift ? "bg-primary" : "bg-orange-500"
                  )}
                />
                <span className="font-medium text-slate-700">
                  {currentShift ? `กะ: ${currentShift.staffName}` : "รอเปิดกะ"}
                </span>
              </div>
              <div className="h-8 w-px bg-slate-200" />
              <div className="text-right">
                <div className="font-heading text-sm font-semibold tabular-nums text-slate-800">
                  {timeLabel} น.
                </div>
                <div className="text-[11px] text-slate-500">{dateLabel}</div>
              </div>
              {loadSecondaryData && canSeeStockAlerts && (
                <Suspense fallback={null}>
                  <LowStockAlert />
                </Suspense>
              )}
            </div>
          </header>

          <header className="pos-mobile-header sticky top-0 z-30 flex h-[calc(64px+env(safe-area-inset-top))] items-center gap-2 border-b border-white/10 px-3 pt-[env(safe-area-inset-top)] text-white shadow-[0_8px_24px_rgba(15,39,52,0.18)] lg:hidden">
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="เปิดเมนูทั้งหมด"
                className="pos-mobile-action grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 hover:bg-white/[0.15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <Menu className="size-5" />
              </button>
            </SheetTrigger>
            <div className="pos-brand-mark hidden size-9 shrink-0 place-items-center rounded-lg text-primary-foreground shadow-md min-[390px]:grid">
              <Droplet className="size-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="pos-mobile-brand truncate font-heading text-sm font-semibold">
                {currentMenu?.label ?? shopName}
              </div>
              <div className="pos-mobile-status flex items-center gap-1.5 text-[10px] text-white/60">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    currentShift ? "bg-primary" : "bg-orange-400"
                  )}
                />
                {workspaceLabel} ·{" "}
                {currentShift ? "กะเปิดอยู่" : "ยังไม่เปิดกะ"}
              </div>
            </div>
            <div className="pos-mobile-time hidden font-heading text-xs tabular-nums text-white/75 sm:block">
              {timeLabel}
            </div>
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              aria-label="ค้นหาเมนู"
              className="pos-mobile-action grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 transition-colors hover:bg-white/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <Search className="size-[18px]" />
            </button>
            {loadSecondaryData && canSeeStockAlerts && (
              <Suspense fallback={null}>
                <LowStockAlert />
              </Suspense>
            )}
          </header>

          <DesktopSyncBanner />
          <main className="pos-main relative mx-auto w-full min-w-0 max-w-[1650px] p-3 pb-5 sm:p-5 lg:p-6 xl:p-7">
            <div key={location.pathname} className="page-enter">
              <Outlet />
            </div>
          </main>
        </div>

        <nav
          aria-label="เมนูหลักบนมือถือ"
          className="fixed inset-x-3 bottom-[calc(0.6rem+env(safe-area-inset-bottom))] z-30 flex h-16 rounded-2xl border border-slate-200 bg-white/95 px-1.5 shadow-[0_12px_32px_rgba(15,39,52,0.15)] backdrop-blur-xl lg:hidden"
        >
          {visibleMenus
            .filter(menu => workspaceMobilePaths.includes(menu.to))
            .map(menu => (
              <NavLink
                key={menu.to}
                to={menu.to}
                end={
                  menu.end ||
                  (menu.to === "/stock" &&
                    currentMenu?.permission === "fuel_forecast")
                }
                className={({ isActive }) =>
                  cn(
                    "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-all",
                    isActive ? "text-primary" : "text-slate-600"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute top-1 h-1 w-1 rounded-full bg-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]" />
                    )}
                    <menu.icon
                      className={cn(
                        "size-[21px] transition-all duration-200",
                        isActive && "-translate-y-0.5 scale-110",
                        menu.to === "/pos" &&
                          "size-6 rounded-lg bg-primary p-1 text-primary-foreground shadow-md shadow-primary/20"
                      )}
                    />
                    <span className="truncate">
                      {menu.shortLabel ?? menu.label}
                    </span>
                  </>
                )}
              </NavLink>
            ))}
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="เปิดเมนูเพิ่มเติม"
              aria-current={moreMenuIsActive ? "page" : undefined}
              className={cn(
                "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors",
                moreMenuIsActive ? "text-primary" : "text-slate-600"
              )}
            >
              {moreMenuIsActive && (
                <span className="absolute top-1 h-1 w-1 rounded-full bg-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]" />
              )}
              <MoreHorizontal className="size-[22px]" />
              <span>เพิ่มเติม</span>
            </button>
          </SheetTrigger>
        </nav>

        <SheetContent
          side="left"
          className="pos-sidebar flex w-[304px] max-w-[88vw] flex-col gap-0 border-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-white"
        >
          <SheetHeader className="pos-sidebar-brand flex h-[78px] shrink-0 justify-center border-b border-white/10 px-5 pr-12 text-left">
            <SheetTitle className="pos-sidebar-title font-heading text-base font-semibold text-white">
              {shopName}
            </SheetTitle>
            <SheetDescription className="pos-sidebar-subtitle text-[11px] text-white/[0.55]">
              {workspaceLabel}
            </SheetDescription>
          </SheetHeader>
          {renderWorkspaceSwitcher()}
          <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 station-scrollbar">
            {(["station", "customer", "document", "system"] as const).map(
              group => {
                const groupMenus = workspaceMenus.filter(
                  menu => menu.group === group
                );
                if (!groupMenus.length) return null;
                return (
                  <div key={group} className="mb-5">
                    <div className="pos-sidebar-section-label mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/[0.35]">
                      {groupLabels[group]}
                    </div>
                    <div className="space-y-1">
                      {groupMenus.map(menu => (
                        <div key={menu.to}>{renderNavItem(menu, true)}</div>
                      ))}
                    </div>
                  </div>
                );
              }
            )}
          </nav>
          <div className="pos-sidebar-footer shrink-0 border-t border-white/10 p-4">
            <label className="mb-4 block">
              <span className="pos-sidebar-section-label mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">
                <Building2 className="size-3" /> สาขาที่ใช้งาน
              </span>
              <select
                value={staff?.branch.id ?? ""}
                disabled={
                  staff?.role !== "admin" ||
                  switchingBranch ||
                  savingAppearance ||
                  savingSetup ||
                  (staff?.branches.length ?? 0) <= 1
                }
                onChange={event =>
                  void handleBranchChange(Number(event.target.value))
                }
                className="pos-sidebar-branch h-11 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm font-medium text-white outline-none focus:border-primary disabled:opacity-60 [&>option]:text-slate-900"
              >
                {staff?.branches.map(branch => (
                  <option key={branch.id} value={branch.id}>
                    {branch.code} · {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mb-3 flex items-center gap-3">
              <div className="pos-sidebar-avatar grid size-10 place-items-center rounded-xl bg-white/10 font-semibold">
                {staff?.name?.trim().charAt(0) || "P"}
              </div>
              <div className="min-w-0">
                <div className="pos-sidebar-staff-name truncate text-sm font-semibold">
                  {staff?.name}
                </div>
                <div className="pos-sidebar-staff-role text-xs text-white/[0.45]">
                  {staff ? (roleLabel[staff.role] ?? staff.role) : ""}
                </div>
              </div>
            </div>
            <SheetClose asChild>
              <button
                type="button"
                onClick={handleLogout}
                className="pos-sidebar-logout flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 text-sm text-white/70 hover:bg-white/10 hover:text-white"
              >
                <LogOut className="size-4" /> ออกจากระบบ
              </button>
            </SheetClose>
          </div>
        </SheetContent>
      </div>

      <CommandDialog
        open={commandOpen}
        onOpenChange={setCommandOpen}
        title="ค้นหาเมนู"
        description="พิมพ์ชื่อหน้าที่ต้องการเปิด"
        className="max-w-xl overflow-hidden rounded-xl border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,39,52,0.24)]"
      >
        <CommandInput placeholder="ค้นหางานขาย สต๊อก รายงาน หรือการตั้งค่า..." />
        <CommandList className="soft-scrollbar max-h-[min(430px,65vh)] p-2">
          <CommandEmpty className="py-12 text-center text-sm text-slate-500">
            ไม่พบเมนูที่ค้นหา
          </CommandEmpty>
          {(["station", "customer", "document", "system"] as const).map(
            group => {
              const groupMenus = visibleMenus.filter(
                menu => menu.group === group
              );
              if (!groupMenus.length) return null;
              return (
                <CommandGroup
                  key={group}
                  heading={groupLabels[group]}
                  className="mb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-2 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em]"
                >
                  {groupMenus.map(menu => (
                    <CommandItem
                      key={menu.to}
                      value={`${menu.label} ${groupLabels[group]}`}
                      onSelect={() => {
                        navigate(menu.to);
                        setCommandOpen(false);
                        setMobileMenuOpen(false);
                      }}
                      className="mb-1 rounded-lg px-3 py-3 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                    >
                      <span className="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground ring-1 ring-border">
                        <menu.icon className="size-[18px]" />
                      </span>
                      <span className="font-medium">{menu.label}</span>
                      <CommandShortcut>
                        <CornerDownLeft className="size-3.5" />
                      </CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            }
          )}
        </CommandList>
      </CommandDialog>
      {loadSecondaryData && (
        <Suspense fallback={null}>
          <AssistantChat />
        </Suspense>
      )}
    </Sheet>
  );
}
