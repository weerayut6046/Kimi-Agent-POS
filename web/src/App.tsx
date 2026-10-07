import { Routes, Route, Navigate } from "react-router";
import { lazy, Suspense, type ReactNode } from "react";
import { useStaff } from "@/hooks/useStaff";
import { Button } from "@/components/ui/button";
import { trpc } from "@/providers/trpc";
import { getBusinessLandingPath } from "@/lib/navigationWorkspaces";
import {
  hasMenuPermission,
  type MenuPermissionKey,
} from "@contracts/menuPermissions";

const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Layout = lazy(() => import("@/components/Layout"));
const Pos = lazy(() => import("@/pages/Pos"));
const Shifts = lazy(() => import("@/pages/Shifts"));
const Stock = lazy(() => import("@/pages/Stock"));
const FuelForecast = lazy(() => import("@/pages/FuelForecast"));
const StockCount = lazy(() => import("@/pages/StockCount"));
const Members = lazy(() => import("@/pages/Members"));
const MemberCardBatches = lazy(() => import("@/pages/MemberCardBatches"));
const Customers = lazy(() => import("@/pages/Customers"));
const Debts = lazy(() => import("@/pages/Debts"));
const Sales = lazy(() => import("@/pages/Sales"));
const Expenses = lazy(() => import("@/pages/Expenses"));
const Profitability = lazy(() => import("@/pages/Profitability"));
const FuelStockReport = lazy(() => import("@/pages/FuelStockReport"));
const TankReconciliation = lazy(() => import("@/pages/TankReconciliation"));
const TaxInvoices = lazy(() => import("@/pages/TaxInvoices"));
const Documents = lazy(() => import("@/pages/Documents"));
const Audit = lazy(() => import("@/pages/Audit"));
const Security = lazy(() => import("@/pages/Security"));
const Settings = lazy(() => import("@/pages/Settings"));
const Workforce = lazy(() => import("@/pages/Workforce"));
const Platform = lazy(() => import("@/pages/Platform"));
const Setup = lazy(() => import("@/pages/Setup"));

function MenuRoute({
  permission,
  managerOnly = false,
  children,
}: {
  permission: MenuPermissionKey;
  managerOnly?: boolean;
  children: ReactNode;
}) {
  const { staff } = useStaff();
  if (!staff) return <Navigate to="/login" replace />;
  if (
    hasMenuPermission(staff.role, staff.menuPermissions, permission) &&
    (!managerOnly || staff.role === "admin" || staff.role === "manager")
  ) {
    return children;
  }
  const fallback = getBusinessLandingPath(staff.role, staff.menuPermissions);
  return fallback ? <Navigate to={fallback} replace /> : null;
}

export default function App() {
  const { staff, logout } = useStaff();
  const deployment = trpc.auth.deploymentInfo.useQuery(undefined, {
    staleTime: Infinity,
    enabled: Boolean(staff),
    trpc: { context: { skipBatch: true } },
  });
  if (!staff) return null;

  if (deployment.isPending || deployment.isError || !deployment.data) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6 text-center">
        <div className="max-w-md space-y-4">
          <h1 className="font-heading text-xl font-semibold">
            {deployment.isPending
              ? "กำลังตรวจสอบพื้นที่ทำงาน"
              : "ตรวจสอบพื้นที่ทำงานไม่สำเร็จ"}
          </h1>
          {deployment.isError && (
            <>
              <p className="text-sm text-muted-foreground">
                {deployment.error.message}
              </p>
              <div className="flex justify-center gap-2">
                <Button onClick={() => void deployment.refetch()}>
                  ลองใหม่
                </Button>
                <Button variant="outline" onClick={logout}>
                  ออกจากระบบ
                </Button>
              </div>
            </>
          )}
        </div>
      </main>
    );
  }

  if (deployment.data.mode === "platform") {
    if (
      staff.role !== "admin" ||
      !hasMenuPermission(staff.role, staff.menuPermissions, "platform")
    ) {
      return (
        <main className="grid min-h-screen place-items-center bg-background p-6 text-center">
          <div className="max-w-md space-y-4" role="alert">
            <h1 className="font-heading text-xl font-semibold">
              พื้นที่สำหรับผู้ดูแลแพลตฟอร์ม
            </h1>
            <p className="text-sm text-muted-foreground">
              บัญชีนี้ไม่มีสิทธิ์เข้าใช้งานแพลตฟอร์ม
              กรุณาเข้าสู่ระบบกิจการของคุณ
            </p>
            <Button variant="outline" onClick={logout}>
              ออกจากระบบ
            </Button>
          </div>
        </main>
      );
    }
    return (
      <Suspense fallback={<main className="p-6">กำลังเปิดแพลตฟอร์ม...</main>}>
        <Routes>
          <Route element={<Layout deploymentMode="platform" />}>
            <Route
              path="/platform"
              element={
                <MenuRoute permission="platform">
                  <Platform />
                </MenuRoute>
              }
            />
            <Route path="*" element={<Navigate to="/platform" replace />} />
          </Route>
        </Routes>
      </Suspense>
    );
  }

  const landingPath = getBusinessLandingPath(staff.role, staff.menuPermissions);
  if (!landingPath) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
        <div
          data-slot="notice"
          data-tone="warning"
          role="alert"
          className="max-w-md rounded-3xl border bg-white p-8 shadow-sm"
        >
          <h1 className="font-heading text-xl font-bold">
            ยังไม่มีสิทธิ์เข้าใช้งานเมนู
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            กรุณาติดต่อผู้ดูแลระบบเพื่อเปิดสิทธิ์อย่างน้อยหนึ่งเมนู
          </p>
          <Button className="mt-5" variant="outline" onClick={logout}>
            ออกจากระบบ
          </Button>
        </div>
      </main>
    );
  }
  const fallbackPath = landingPath;

  return (
    <Suspense
      fallback={
        <main className="grid min-h-screen place-items-center bg-[#f6f5fb]">
          <span
            className="size-6 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600"
            role="status"
            aria-label="Loading"
          />
        </main>
      }
    >
      <Routes>
        <Route path="/login" element={<Navigate to={fallbackPath} replace />} />
        <Route element={<Layout />}>
          <Route
            path="/setup"
            element={
              <MenuRoute permission="setup">
                <Setup />
              </MenuRoute>
            }
          />
          <Route
            path="/"
            element={
              <MenuRoute permission="dashboard">
                <Dashboard />
              </MenuRoute>
            }
          />
          <Route
            path="/pos"
            element={
              <MenuRoute permission="pos">
                <Pos />
              </MenuRoute>
            }
          />
          <Route
            path="/shifts"
            element={
              <MenuRoute permission="shifts">
                <Shifts />
              </MenuRoute>
            }
          />
          <Route
            path="/workforce"
            element={
              <MenuRoute permission="workforce">
                <Workforce />
              </MenuRoute>
            }
          />
          <Route
            path="/stock"
            element={
              <MenuRoute permission="stock">
                <Stock />
              </MenuRoute>
            }
          />
          <Route
            path="/stock/forecast"
            element={
              <MenuRoute permission="fuel_forecast">
                <FuelForecast />
              </MenuRoute>
            }
          />
          <Route
            path="/stock/count"
            element={
              <MenuRoute permission="stock">
                <StockCount />
              </MenuRoute>
            }
          />
          <Route
            path="/stock/count/:sessionId"
            element={
              <MenuRoute permission="stock">
                <StockCount />
              </MenuRoute>
            }
          />
          <Route
            path="/members"
            element={
              <MenuRoute permission="members">
                <Members />
              </MenuRoute>
            }
          />
          <Route
            path="/member-cards"
            element={
              <MenuRoute permission="members" managerOnly>
                <MemberCardBatches />
              </MenuRoute>
            }
          />
          <Route
            path="/customers"
            element={
              <MenuRoute permission="customers">
                <Customers />
              </MenuRoute>
            }
          />
          <Route
            path="/debts"
            element={
              <MenuRoute permission="debts">
                <Debts />
              </MenuRoute>
            }
          />
          <Route
            path="/sales"
            element={
              <MenuRoute permission="sales">
                <Sales />
              </MenuRoute>
            }
          />
          <Route
            path="/expenses"
            element={
              <MenuRoute permission="expenses">
                <Expenses />
              </MenuRoute>
            }
          />
          <Route
            path="/reports"
            element={<Navigate to="/reports/profitability" replace />}
          />
          <Route
            path="/reports/profitability"
            element={
              <MenuRoute permission="profitability" managerOnly>
                <Profitability />
              </MenuRoute>
            }
          />
          <Route
            path="/reports/fuel-stock"
            element={
              <MenuRoute permission="stock" managerOnly>
                <FuelStockReport />
              </MenuRoute>
            }
          />
          <Route
            path="/reports/tank-reconciliation"
            element={
              <MenuRoute permission="stock" managerOnly>
                <TankReconciliation />
              </MenuRoute>
            }
          />
          <Route
            path="/tax-invoices"
            element={
              <MenuRoute permission="tax_invoices">
                <TaxInvoices />
              </MenuRoute>
            }
          />
          <Route
            path="/documents"
            element={
              <MenuRoute permission="documents">
                <Documents />
              </MenuRoute>
            }
          />
          <Route
            path="/audit"
            element={
              <MenuRoute permission="audit">
                <Audit />
              </MenuRoute>
            }
          />
          <Route
            path="/security"
            element={
              <MenuRoute permission="security">
                <Security />
              </MenuRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <MenuRoute permission="settings">
                <Settings />
              </MenuRoute>
            }
          />
          <Route path="*" element={<Navigate to={fallbackPath} replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
