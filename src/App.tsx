import { Routes, Route, Navigate } from "react-router";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Pos from "@/pages/Pos";
import Shifts from "@/pages/Shifts";
import Stock from "@/pages/Stock";
import Members from "@/pages/Members";
import Customers from "@/pages/Customers";
import Sales from "@/pages/Sales";
import TaxInvoices from "@/pages/TaxInvoices";
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
        <Route path="/sales" element={<Sales />} />
        <Route path="/tax-invoices" element={<TaxInvoices />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
