import { lazy, Suspense, useEffect } from "react";
import Login from "@/pages/Login";
import { useStaff } from "@/hooks/useStaff";

const AuthenticatedApp = lazy(() => import("@/AuthenticatedApp"));
const CustomerLoyalty = lazy(() => import("@/pages/CustomerLoyalty"));

function StaffRoot() {
  const { staff, isCheckingSession } = useStaff();

  useEffect(() => {
    if (
      !isCheckingSession &&
      !staff &&
      window.location.pathname !== "/login"
    ) {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (returnTo.startsWith("/") && !returnTo.startsWith("//")) {
        window.sessionStorage.setItem("pos:return-to", returnTo);
      }
      window.history.replaceState(null, "", "/login");
    }
  }, [isCheckingSession, staff]);

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
    return <Login />;
  }

  return (
    <Suspense
      fallback={
        <main className="grid min-h-screen place-items-center bg-[#f6f5fb]">
          <span
            className="size-6 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600"
            role="status"
            aria-label="กำลังโหลด"
          />
        </main>
      }
    >
      <AuthenticatedApp />
    </Suspense>
  );
}

export default function Root() {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  if (pathname === "/loyalty") {
    return (
      <Suspense
        fallback={
          <main className="grid min-h-screen place-items-center bg-slate-950 p-6">
            <span
              className="size-7 animate-spin rounded-full border-2 border-blue-200/30 border-t-cyan-300"
              role="status"
              aria-label="กำลังโหลดหน้าตรวจสอบแต้ม"
            />
          </main>
        }
      >
        <CustomerLoyalty />
      </Suspense>
    );
  }
  return <StaffRoot />;
}
