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
import { useStaff } from "@/hooks/useStaff";

export default function App() {
  const { staff } = useStaff();

  if (!staff) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/pos" element={<Pos />} />
        <Route path="/shifts" element={<Shifts />} />
        <Route path="/stock" element={<Stock />} />
        <Route path="/members" element={<Members />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/debts" element={<Debts />} />
        <Route path="/sales" element={<Sales />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/tax-invoices" element={<TaxInvoices />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
