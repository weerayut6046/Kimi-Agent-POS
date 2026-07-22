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
  Search,
  CornerDownLeft,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { DesktopSyncBanner } from "@/components/DesktopSyncBanner";
import AssistantChat from "@/components/AssistantChat";
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
    permission: "members",
    to: "/members",
    label: "สมาชิก",
    icon: Users,
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
    permission: "reports",
    to: "/reports",
    label: "รายงานปิดวัน",
    icon: ClipboardList,
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
    permission: "settings",
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
  const [commandOpen, setCommandOpen] = useState(false);
  const shopName = settingMap?.shop_name ?? "PumpPOS";
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
  const CurrentMenuIcon = currentMenu?.icon ?? Droplet;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
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
  const greeting =
    now.getHours() < 12
      ? "อรุณสวัสดิ์"
      : now.getHours() < 17
        ? "สวัสดียามบ่าย"
        : "สวัสดียามเย็น";

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
              ? "translate-x-1 bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500 text-white shadow-[0_10px_28px_rgba(82,64,220,0.32)] ring-1 ring-white/20"
              : "text-white/60 hover:translate-x-1 hover:bg-white/[0.08] hover:text-white"
          )
        }
      >
        {({ isActive }) => (
          <>
            <span
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-lg transition-all duration-200",
                isActive
                  ? "bg-white/[0.16] text-white shadow-inner ring-1 ring-white/10"
                  : "bg-white/[0.055] text-white/55 group-hover:scale-110 group-hover:bg-white/10 group-hover:text-cyan-200"
              )}
            >
              <menu.icon className="size-[18px]" />
            </span>
            <span>{menu.label}</span>
            {menu.to === "/pos" && !isActive && (
              <span className="ml-auto size-2 rounded-full bg-cyan-300 shadow-[0_0_0_4px_rgba(103,232,249,0.12)]" />
            )}
          </>
        )}
      </NavLink>
    );

    return link;
  };

  return (
    <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
      <div className="relative flex min-h-[100dvh] bg-transparent">
        <aside className="fixed bottom-3 left-3 top-3 z-30 hidden w-[264px] flex-col overflow-hidden rounded-[28px] bg-gradient-to-b from-[#11112b] via-[#171644] to-[#10132f] text-white shadow-[0_24px_70px_rgba(24,20,64,0.3)] ring-1 ring-white/10 lg:flex">
          <div className="surface-grid pointer-events-none absolute inset-0 opacity-60" />
          <div className="ambient-float pointer-events-none absolute -right-20 top-16 size-56 rounded-full bg-violet-500/[0.2] blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-20 size-56 rounded-full bg-cyan-400/[0.1] blur-3xl" />
          <div className="relative flex h-[82px] shrink-0 items-center gap-3 border-b border-white/[0.08] px-5">
            <div className="grid size-11 place-items-center rounded-[15px] bg-gradient-to-br from-cyan-300 via-violet-500 to-indigo-700 shadow-[0_10px_28px_rgba(92,67,224,0.4)] ring-1 ring-white/25">
              <Droplet className="size-5 fill-white/20" />
            </div>
            <div className="min-w-0">
              <div className="truncate font-heading text-base font-semibold leading-tight">
                {shopName}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-cyan-200/60">
                <Sparkles className="size-2.5" /> Smart Station
              </div>
            </div>
          </div>

          <div className="relative mx-3.5 mt-3.5 rounded-2xl border border-white/[0.1] bg-white/[0.055] p-3.5 shadow-inner backdrop-blur-md">
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
                      currentShift ? "bg-cyan-300" : "bg-orange-400"
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

          <nav className="relative flex-1 overflow-y-auto overscroll-contain px-2.5 pb-4 pt-3 station-scrollbar">
            {(["station", "customer", "document", "system"] as const).map(
              group => {
                const groupMenus = visibleMenus.filter(
                  menu => menu.group === group
                );
                if (!groupMenus.length) return null;
                return (
                  <div key={group} className="mb-4">
                    <div className="mb-1.5 px-3 text-[9px] font-bold uppercase tracking-[0.18em] text-white/[0.28]">
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

          <div className="relative shrink-0 border-t border-white/10 bg-black/10 p-4 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-400/30 to-cyan-300/10 font-heading text-sm font-semibold text-white ring-1 ring-white/10">
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

        <div className="min-w-0 flex-1 pb-[calc(88px+env(safe-area-inset-bottom))] lg:ml-[288px] lg:pb-0">
          <header className="sticky top-0 z-20 hidden h-[84px] items-center justify-between border-b border-white/60 bg-[#f8f8fc]/70 px-7 shadow-[0_10px_34px_rgba(43,37,94,0.045)] backdrop-blur-2xl lg:flex">
            <div className="flex items-center gap-4">
              <div className="grid size-11 place-items-center rounded-2xl bg-white/80 text-violet-600 shadow-sm ring-1 ring-slate-200/70">
                <CurrentMenuIcon className="size-5" />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-500/70">
                  {greeting} · {groupLabels[currentMenu?.group ?? "station"]}
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
                className="group flex h-11 w-48 items-center gap-2 rounded-2xl border border-white/90 bg-white/70 px-3 text-left text-xs text-slate-400 shadow-sm ring-1 ring-slate-200/60 backdrop-blur-md transition-all hover:w-52 hover:border-violet-200 hover:bg-white hover:text-violet-700 hover:shadow-[0_12px_26px_rgba(75,61,157,0.12)] xl:w-56 xl:hover:w-60"
                aria-label="ค้นหาเมนู"
              >
                <Search className="size-4 transition-transform group-hover:scale-110" />
                <span className="flex-1">ค้นหาเมนู...</span>
                <kbd className="rounded-lg border border-violet-100 bg-violet-50 px-1.5 py-0.5 font-sans text-[10px] text-violet-400 shadow-xs">
                  Ctrl K
                </kbd>
              </button>
              <div className="flex items-center gap-2 rounded-2xl border border-white/90 bg-white/70 px-3 py-2 text-xs shadow-sm ring-1 ring-slate-200/60 backdrop-blur-md">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    currentShift ? "bg-cyan-500" : "bg-orange-500"
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

          <header className="sticky top-0 z-30 flex h-[calc(64px+env(safe-area-inset-top))] items-center gap-2 border-b border-white/10 bg-gradient-to-r from-[#141436]/95 via-[#211d58]/95 to-[#12344b]/95 px-3 pt-[env(safe-area-inset-top)] text-white shadow-[0_12px_34px_rgba(25,21,72,0.24)] backdrop-blur-xl lg:hidden">
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="เปิดเมนูทั้งหมด"
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 hover:bg-white/[0.15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <Menu className="size-5" />
              </button>
            </SheetTrigger>
            <div className="hidden size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 shadow-lg min-[390px]:grid">
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
                    currentShift ? "bg-cyan-300" : "bg-orange-400"
                  )}
                />
                {currentShift ? "กะเปิดอยู่" : "ยังไม่เปิดกะ"}
              </div>
            </div>
            <div className="hidden font-heading text-xs tabular-nums text-white/75 sm:block">
              {timeLabel}
            </div>
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              aria-label="ค้นหาเมนู"
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 transition-colors hover:bg-white/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <Search className="size-[18px]" />
            </button>
            <LowStockAlert />
          </header>

          <DesktopSyncBanner />
          <main className="relative mx-auto w-full min-w-0 max-w-[1650px] p-3 pb-5 sm:p-5 lg:p-7 xl:p-9">
            <div className="surface-dots pointer-events-none absolute inset-x-5 top-0 -z-10 h-64 opacity-45 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
            <div key={location.pathname} className="page-enter">
              <Outlet />
            </div>
          </main>
        </div>

        <nav
          aria-label="เมนูหลักบนมือถือ"
          className="fixed inset-x-3 bottom-[calc(0.6rem+env(safe-area-inset-bottom))] z-30 flex h-16 rounded-[22px] border border-white/90 bg-white/80 px-1.5 shadow-[0_16px_46px_rgba(37,30,86,0.2)] ring-1 ring-slate-200/60 backdrop-blur-2xl lg:hidden"
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
                    "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-all",
                    isActive ? "text-violet-700" : "text-slate-400"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute top-1 h-1 w-1 rounded-full bg-cyan-500 shadow-[0_0_0_4px_rgba(6,182,212,0.12)]" />
                    )}
                    <menu.icon
                      className={cn(
                        "size-[21px] transition-all duration-200",
                        isActive && "-translate-y-0.5 scale-110",
                        menu.to === "/pos" &&
                          "size-6 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-700 p-1 text-white shadow-lg shadow-violet-500/25"
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
                moreMenuIsActive ? "text-violet-700" : "text-slate-400"
              )}
            >
              {moreMenuIsActive && (
                <span className="absolute top-1 h-1 w-1 rounded-full bg-cyan-500 shadow-[0_0_0_4px_rgba(6,182,212,0.12)]" />
              )}
              <MoreHorizontal className="size-[22px]" />
              <span>เพิ่มเติม</span>
            </button>
          </SheetTrigger>
        </nav>

        <SheetContent
          side="left"
          className="flex w-[304px] max-w-[88vw] flex-col gap-0 border-0 bg-gradient-to-b from-[#11112b] via-[#171644] to-[#10132f] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-white"
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

      <CommandDialog
        open={commandOpen}
        onOpenChange={setCommandOpen}
        title="ค้นหาเมนู"
        description="พิมพ์ชื่อหน้าที่ต้องการเปิด"
        className="max-w-xl overflow-hidden rounded-[24px] border-white/80 bg-white/90 shadow-[0_32px_100px_rgba(29,23,78,0.32)] backdrop-blur-2xl"
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
                      className="mb-1 rounded-xl px-3 py-3 data-[selected=true]:bg-violet-50 data-[selected=true]:text-violet-800"
                    >
                      <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-violet-50 to-cyan-50 text-violet-600 ring-1 ring-violet-100/70">
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
      <AssistantChat />
    </Sheet>
  );
}
