import { Routes, Route, Navigate } from "react-router";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Pos from "@/pages/Pos";
import Shifts from "@/pages/Shifts";
import Stock from "@/pages/Stock";
import Members from "@/pages/Members";
import Customers from "@/pages/Customers";
import Debts from "@/pages/Debts";
import Sales from "@/pages/Sales";
import Expenses from "@/pages/Expenses";
import Reports from "@/pages/Reports";
import TaxInvoices from "@/pages/TaxInvoices";
import Documents from "@/pages/Documents";
import Audit from "@/pages/Audit";
import Settings from "@/pages/Settings";
import Workforce from "@/pages/Workforce";
import { useStaff } from "@/hooks/useStaff";
import { Button } from "@/components/ui/button";
import {
  getFirstAllowedMenuPath,
  hasMenuPermission,
  type MenuPermissionKey,
} from "@contracts/menuPermissions";
import type { ReactNode } from "react";

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
  );
}
