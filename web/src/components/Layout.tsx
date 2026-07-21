import { useEffect, useMemo, useState } from "react";
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
  ClipboardList,
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
  CalendarDays,
  type LucideIcon,
} from "lucide-react";
import { DesktopSyncBanner } from "@/components/DesktopSyncBanner";
import { useStaff } from "@/hooks/useStaff";
import LowStockAlert from "@/components/LowStockAlert";
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

type MenuItem = {
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
    to: "/",
    label: "ภาพรวมสถานี",
    shortLabel: "ภาพรวม",
    icon: LayoutDashboard,
    end: true,
    group: "station",
  },
  {
    to: "/pos",
    label: "ขายหน้าลาน",
    shortLabel: "ขาย",
    icon: ShoppingCart,
    group: "station",
  },
  {
    to: "/shifts",
    label: "จัดการกะ",
    shortLabel: "กะ",
    icon: Clock,
    group: "station",
  },
  {
    to: "/workforce",
    label: "พนักงานและตารางงาน",
    shortLabel: "พนักงาน",
    icon: CalendarDays,
    group: "station",
  },
  {
    to: "/stock",
    label: "สต๊อกและถัง",
    shortLabel: "สต๊อก",
    icon: Fuel,
    group: "station",
  },
  { to: "/members", label: "สมาชิก", icon: Users, group: "customer" },
  {
    to: "/customers",
    label: "ลูกค้าธุรกิจ",
    icon: Building2,
    group: "customer",
  },
  { to: "/debts", label: "ลูกหนี้เครดิต", icon: HandCoins, group: "customer" },
  { to: "/sales", label: "ประวัติการขาย", icon: Receipt, group: "document" },
  {
    to: "/reports",
    label: "รายงานปิดวัน",
    icon: ClipboardList,
    group: "document",
  },
  { to: "/expenses", label: "ค่าใช้จ่าย", icon: Banknote, group: "document" },
  {
    to: "/tax-invoices",
    label: "ใบกำกับภาษี",
    icon: FileText,
    group: "document",
  },
  {
    to: "/documents",
    label: "เอกสาร",
    icon: FileSignature,
    managerOnly: true,
    group: "document",
  },
  {
    to: "/audit",
    label: "บันทึกการใช้งาน",
    icon: ScrollText,
    adminOnly: true,
    group: "system",
  },
  {
    to: "/settings",
    label: "ตั้งค่าระบบ",
    shortLabel: "ตั้งค่า",
    icon: Settings,
    group: "system",
  },
];

const groupLabels: Record<MenuItem["group"], string> = {
  station: "งานหน้าสถานี",
  customer: "ลูกค้าและเครดิต",
  document: "เอกสารและรายงาน",
  system: "ระบบ",
};

const mobileMenuPaths = ["/", "/pos", "/shifts", "/stock"];

export default function Layout() {
  const { staff, logout } = useStaff();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: settingMap } = trpc.catalog.getSettings.useQuery();
  const { data: currentShift } = trpc.pos.currentShift.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const [now, setNow] = useState(() => new Date());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const shopName = settingMap?.shop_name ?? "PumpPOS";
  const visibleMenus = useMemo(
    () =>
      menus.filter(
        menu =>
          (!menu.adminOnly || staff?.role === "admin") &&
          (!menu.managerOnly ||
            staff?.role === "admin" ||
            staff?.role === "manager")
      ),
    [staff?.role]
  );
  const currentMenu = visibleMenus.find(menu =>
    menu.end
      ? location.pathname === menu.to
      : location.pathname.startsWith(menu.to)
  );
  const moreMenuIsActive = !mobileMenuPaths.some(path =>
    path === "/"
      ? location.pathname === path
      : location.pathname.startsWith(path)
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
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
        end={menu.end}
        onClick={closeOnClick ? () => setMobileMenuOpen(false) : undefined}
        className={({ isActive }) =>
          cn(
            "group relative flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
            isActive
              ? "bg-white text-[#0b2854] shadow-[0_8px_24px_rgba(0,0,0,0.16)]"
              : "text-white/70 hover:bg-white/[0.08] hover:text-white"
          )
        }
      >
        {({ isActive }) => (
          <>
            <span
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-lg transition-colors",
                isActive
                  ? "bg-blue-50 text-blue-700"
                  : "bg-white/[0.07] text-white/70 group-hover:bg-white/10"
              )}
            >
              <menu.icon className="size-[18px]" />
            </span>
            <span>{menu.label}</span>
            {menu.to === "/pos" && !isActive && (
              <span className="ml-auto size-2 rounded-full bg-orange-400 shadow-[0_0_0_4px_rgba(251,146,60,0.12)]" />
            )}
          </>
        )}
      </NavLink>
    );

    return link;
  };

  return (
    <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
      <div className="flex min-h-[100dvh] bg-background">
        <aside className="fixed inset-y-0 z-30 hidden w-[276px] flex-col overflow-hidden bg-[#091a36] text-white lg:flex">
          <div className="pointer-events-none absolute -right-20 top-16 size-52 rounded-full bg-blue-500/[0.12] blur-3xl" />
          <div className="relative flex h-[78px] shrink-0 items-center gap-3 border-b border-white/10 px-5">
            <div className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg shadow-blue-950/40">
              <Droplet className="size-5 fill-white/20" />
            </div>
            <div className="min-w-0">
              <div className="truncate font-heading text-base font-semibold leading-tight">
                {shopName}
              </div>
              <div className="mt-1 text-[11px] font-medium uppercase tracking-[0.16em] text-blue-200/60">
                Station Console
              </div>
            </div>
          </div>

          <div className="relative mx-4 mt-4 rounded-xl border border-white/10 bg-white/[0.055] p-3.5">
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
                      currentShift ? "bg-emerald-400" : "bg-amber-400"
                    )}
                  />
                </span>
                <div>
                  <div className="text-xs font-semibold text-white">
                    {currentShift ? "กะกำลังเปิด" : "ยังไม่ได้เปิดกะ"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-white/50">
                    {currentShift?.staffName ?? "พร้อมเริ่มงาน"}
                  </div>
                </div>
              </div>
              <LowStockAlert />
            </div>
          </div>

          <nav className="relative flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-3 station-scrollbar">
            {(["station", "customer", "document", "system"] as const).map(
              group => {
                const groupMenus = visibleMenus.filter(
                  menu => menu.group === group
                );
                if (!groupMenus.length) return null;
                return (
                  <div key={group} className="mb-4">
                    <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/[0.35]">
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

          <div className="relative shrink-0 border-t border-white/10 bg-black/10 p-4">
            <div className="flex items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 font-heading text-sm font-semibold text-white">
                {staff?.name?.trim().charAt(0) || "P"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {staff?.name}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-white/50">
                  <ShieldCheck className="size-3" />{" "}
                  {staff ? (roleLabel[staff.role] ?? staff.role) : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                aria-label="ออกจากระบบ"
                className="grid size-9 place-items-center rounded-lg text-white/[0.55] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <LogOut className="size-[18px]" />
              </button>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1 pb-[calc(68px+env(safe-area-inset-bottom))] lg:ml-[276px] lg:pb-0">
          <header className="sticky top-0 z-20 hidden h-[72px] items-center justify-between border-b border-slate-200/80 bg-white/90 px-7 backdrop-blur-xl lg:flex">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                {groupLabels[currentMenu?.group ?? "station"]}
              </div>
              <div className="mt-0.5 font-heading text-base font-semibold text-slate-800">
                {currentMenu?.label ?? "PumpPOS"}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    currentShift ? "bg-emerald-500" : "bg-amber-500"
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
              <LowStockAlert />
            </div>
          </header>

          <header className="sticky top-0 z-30 flex h-[calc(60px+env(safe-area-inset-top))] items-center gap-2 border-b border-white/10 bg-[#0b2854] px-3 pt-[env(safe-area-inset-top)] text-white shadow-lg shadow-blue-950/10 lg:hidden">
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="เปิดเมนูทั้งหมด"
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 hover:bg-white/[0.15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <Menu className="size-5" />
              </button>
            </SheetTrigger>
            <div className="hidden size-9 shrink-0 place-items-center rounded-lg bg-blue-600 min-[390px]:grid">
              <Droplet className="size-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-heading text-sm font-semibold">
                {currentMenu?.label ?? shopName}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-white/60">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    currentShift ? "bg-emerald-400" : "bg-amber-400"
                  )}
                />
                {currentShift ? "กะเปิดอยู่" : "ยังไม่เปิดกะ"}
              </div>
            </div>
            <div className="hidden font-heading text-xs tabular-nums text-white/75 sm:block">
              {timeLabel}
            </div>
            <LowStockAlert />
          </header>

          <DesktopSyncBanner />
          <main className="mx-auto w-full min-w-0 max-w-[1540px] p-3 pb-5 sm:p-5 lg:p-7 xl:p-8">
            <Outlet />
          </main>
        </div>

        <nav
          aria-label="เมนูหลักบนมือถือ"
          className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(68px+env(safe-area-inset-bottom))] border-t border-slate-200 bg-white/95 px-1.5 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl lg:hidden"
        >
          {visibleMenus
            .filter(menu => mobileMenuPaths.includes(menu.to))
            .map(menu => (
              <NavLink
                key={menu.to}
                to={menu.to}
                end={menu.end}
                className={({ isActive }) =>
                  cn(
                    "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors",
                    isActive ? "text-blue-700" : "text-slate-400"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute top-0 h-0.5 w-8 rounded-full bg-orange-500" />
                    )}
                    <menu.icon
                      className={cn(
                        "size-[21px]",
                        menu.to === "/pos" && "size-6"
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
                moreMenuIsActive ? "text-blue-700" : "text-slate-400"
              )}
            >
              {moreMenuIsActive && (
                <span className="absolute top-0 h-0.5 w-8 rounded-full bg-orange-500" />
              )}
              <MoreHorizontal className="size-[22px]" />
              <span>เพิ่มเติม</span>
            </button>
          </SheetTrigger>
        </nav>

        <SheetContent
          side="left"
          className="flex w-[304px] max-w-[88vw] flex-col gap-0 border-0 bg-[#091a36] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-white"
        >
          <SheetHeader className="flex h-[78px] shrink-0 justify-center border-b border-white/10 px-5 pr-12 text-left">
            <SheetTitle className="font-heading text-base font-semibold text-white">
              {shopName}
            </SheetTitle>
            <SheetDescription className="text-[11px] text-white/[0.55]">
              เมนูจัดการสถานี
            </SheetDescription>
          </SheetHeader>
          <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 station-scrollbar">
            {(["station", "customer", "document", "system"] as const).map(
              group => {
                const groupMenus = visibleMenus.filter(
                  menu => menu.group === group
                );
                if (!groupMenus.length) return null;
                return (
                  <div key={group} className="mb-5">
                    <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/[0.35]">
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
          <div className="shrink-0 border-t border-white/10 p-4">
            <div className="mb-3 flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-white/10 font-semibold">
                {staff?.name?.trim().charAt(0) || "P"}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {staff?.name}
                </div>
                <div className="text-xs text-white/[0.45]">
                  {staff ? (roleLabel[staff.role] ?? staff.role) : ""}
                </div>
              </div>
            </div>
            <SheetClose asChild>
              <button
                type="button"
                onClick={handleLogout}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 text-sm text-white/70 hover:bg-white/10 hover:text-white"
              >
                <LogOut className="size-4" /> ออกจากระบบ
              </button>
            </SheetClose>
          </div>
        </SheetContent>
      </div>
    </Sheet>
  );
}
