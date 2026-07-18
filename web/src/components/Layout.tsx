import { NavLink, Outlet, useNavigate } from "react-router";
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
  Settings,
  LogOut,
  Droplet,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { useStaff } from "@/hooks/useStaff";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { roleLabel } from "@/lib/format";

const menus: { to: string; label: string; icon: LucideIcon; end?: boolean; adminOnly?: boolean }[] = [
  { to: "/", label: "แดชบอร์ด", icon: LayoutDashboard, end: true },
  { to: "/pos", label: "ขาย (POS)", icon: ShoppingCart },
  { to: "/shifts", label: "ตัดกะ", icon: Clock },
  { to: "/stock", label: "สต๊อก/ถัง", icon: Fuel },
  { to: "/members", label: "สมาชิก", icon: Users },
  { to: "/customers", label: "ลูกค้า", icon: Building2 },
  { to: "/debts", label: "ลูกหนี้เครดิต", icon: HandCoins },
  { to: "/sales", label: "ประวัติขาย", icon: Receipt },
  { to: "/reports", label: "รายงานปิดวัน", icon: ClipboardList },
  { to: "/expenses", label: "ค่าใช้จ่าย", icon: Banknote },
  { to: "/tax-invoices", label: "ใบกำกับภาษี", icon: FileText },
  { to: "/audit", label: "บันทึกการใช้งาน", icon: ScrollText, adminOnly: true },
  { to: "/settings", label: "ตั้งค่า", icon: Settings },
];

export default function Layout() {
  const { staff, logout } = useStaff();
  const navigate = useNavigate();
  const { data: settingMap } = trpc.catalog.getSettings.useQuery();
  const shopName = settingMap?.shop_name ?? "PumpPOS";

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex w-60 flex-col bg-primary text-primary-foreground fixed inset-y-0 z-30">
        <div className="flex items-center gap-2 px-5 h-16 border-b border-white/15">
          <div className="bg-white/20 rounded-xl p-2">
            <Droplet className="w-5 h-5" />
          </div>
          <div>
            <div className="font-heading font-semibold leading-tight text-sm">{shopName}</div>
            <div className="text-xs opacity-70">PumpPOS ครบวงจร</div>
          </div>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {menus.filter((m) => !m.adminOnly || staff?.role === "admin").map((m) => (
            <NavLink
              key={m.to}
              to={m.to}
              end={m.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive ? "bg-white text-primary shadow" : "text-white/80 hover:bg-white/10 hover:text-white",
                )
              }
            >
              <m.icon className="w-5 h-5" />
              {m.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-white/15">
          <div className="text-sm font-medium">{staff?.name}</div>
          <div className="text-xs opacity-70 mb-2">{staff ? (roleLabel[staff.role] ?? staff.role) : ""}</div>
          <button
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="flex items-center gap-2 text-xs text-white/70 hover:text-white"
          >
            <LogOut className="w-4 h-4" /> ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 md:ml-60 pb-20 md:pb-0">
        {/* Topbar — mobile */}
        <header className="md:hidden sticky top-0 z-30 bg-primary text-primary-foreground h-14 flex items-center gap-2 px-4 shadow">
          <Droplet className="w-5 h-5" />
          <span className="font-heading font-semibold text-sm">{shopName}</span>
          <span className="ml-auto text-xs opacity-80">{staff?.name}</span>
        </header>
        <main className="p-4 md:p-6 max-w-7xl mx-auto">
          <Outlet />
        </main>
      </div>

      {/* Bottom nav — mobile */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t flex justify-around py-1.5">
        {menus.slice(0, 5).map((m) => (
          <NavLink
            key={m.to}
            to={m.to}
            end={m.end}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] rounded-md",
                isActive ? "text-primary font-semibold" : "text-muted-foreground",
              )
            }
          >
            <m.icon className="w-5 h-5" />
            {m.label}
          </NavLink>
        ))}
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              "flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] rounded-md",
              isActive ? "text-primary font-semibold" : "text-muted-foreground",
            )
          }
        >
          <Settings className="w-5 h-5" />
          ตั้งค่า
        </NavLink>
      </nav>
    </div>
  );
}
