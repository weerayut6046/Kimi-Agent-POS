import { Routes, Route, Navigate } from "react-router";
import { lazy, Suspense, type ReactNode } from "react";
import Login from "@/pages/Login";
import { useStaff } from "@/hooks/useStaff";
import { Button } from "@/components/ui/button";
import {
  getFirstAllowedMenuPath,
  hasMenuPermission,
  type MenuPermissionKey,
} from "@contracts/menuPermissions";

const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Layout = lazy(() => import("@/components/Layout"));
const Pos = lazy(() => import("@/pages/Pos"));
const Shifts = lazy(() => import("@/pages/Shifts"));
const Stock = lazy(() => import("@/pages/Stock"));
const Members = lazy(() => import("@/pages/Members"));
const Customers = lazy(() => import("@/pages/Customers"));
const Debts = lazy(() => import("@/pages/Debts"));
const Sales = lazy(() => import("@/pages/Sales"));
const Expenses = lazy(() => import("@/pages/Expenses"));
const Reports = lazy(() => import("@/pages/Reports"));
const FuelStockReport = lazy(() => import("@/pages/FuelStockReport"));
const TaxInvoices = lazy(() => import("@/pages/TaxInvoices"));
const Documents = lazy(() => import("@/pages/Documents"));
const Audit = lazy(() => import("@/pages/Audit"));
const Settings = lazy(() => import("@/pages/Settings"));
const Workforce = lazy(() => import("@/pages/Workforce"));

function MenuRoute({
  permission,
  children,
}: {
  permission: MenuPermissionKey;
  children: ReactNode;
}) {
  const { staff } = useStaff();
  if (!staff) return <Navigate to="/login" replace />;
  if (hasMenuPermission(staff.role, staff.menuPermissions, permission)) {
    return children;
  }
  const fallback = getFirstAllowedMenuPath(staff.role, staff.menuPermissions);
  return fallback ? <Navigate to={fallback} replace /> : null;
}

export default function App() {
  const { staff, isCheckingSession, logout } = useStaff();

  if (isCheckingSession) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f6f5fb] p-6">
        <div
          className="flex items-center gap-3 rounded-2xl border border-violet-100 bg-white px-5 py-4 text-sm font-semibold text-slate-700 shadow-lg shadow-violet-100/50"
          role="status"
        >
          <span className="size-5 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
          กำลังตรวจสอบเซสชันผู้ใช้งาน...
        </div>
      </main>
    );
  }

  if (!staff) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const landingPath = getFirstAllowedMenuPath(
    staff.role,
    staff.menuPermissions
  );
  if (!landingPath) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
        <div className="max-w-md rounded-3xl border bg-white p-8 shadow-sm">
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
        <Route path="/login" element={<Navigate to={landingPath} replace />} />
        <Route element={<Layout />}>
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
            path="/members"
            element={
              <MenuRoute permission="members">
                <Members />
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
            element={
              <MenuRoute permission="reports">
                <Reports />
              </MenuRoute>
            }
          />
          <Route
            path="/reports/fuel-stock"
            element={
              <MenuRoute permission="reports">
                <FuelStockReport />
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
            path="/settings"
            element={
              <MenuRoute permission="settings">
                <Settings />
              </MenuRoute>
            }
          />
          <Route path="*" element={<Navigate to={landingPath} replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
