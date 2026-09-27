import { lazy, Suspense, useEffect } from "react";
import Login from "@/pages/Login";
import { useStaff } from "@/hooks/useStaff";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";

const AuthenticatedApp = lazy(() => import("@/AuthenticatedApp"));
const CustomerLoyalty = lazy(() => import("@/pages/CustomerLoyalty"));

function CustomerLoyaltyRoot() {
  const deployment = trpc.auth.deploymentInfo.useQuery(undefined, {
    retry: 1,
    staleTime: 60_000,
    trpc: { context: { skipBatch: true } },
  });
  if (!deployment.data && deployment.isPending) {
    return (
      <main className="p-6" role="status">
        กำลังตรวจสอบพื้นที่ทำงาน...
      </main>
    );
  }
  if (!deployment.data) {
    return (
      <main className="space-y-3 p-6" role="alert">
        <p>ตรวจสอบพื้นที่ทำงานไม่สำเร็จ</p>
        <Button onClick={() => void deployment.refetch()}>ลองใหม่</Button>
      </main>
    );
  }
  if (deployment.data.mode === "platform") return <StaffRoot />;
  return <CustomerLoyalty />;
}

function StaffRoot() {
  const { staff, isCheckingSession } = useStaff();

  useEffect(() => {
    if (!isCheckingSession && !staff && window.location.pathname !== "/login") {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (returnTo.startsWith("/") && !returnTo.startsWith("//")) {
        window.sessionStorage.setItem("pos:return-to", returnTo);
      }
      window.history.replaceState(null, "", "/login");
    }
  }, [isCheckingSession, staff]);

  if (isCheckingSession) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 p-6">
        <div
          className="flex items-center gap-3 rounded-xl border border-teal-100 bg-white px-5 py-4 text-sm font-semibold text-slate-700 shadow-lg shadow-slate-200/60"
          role="status"
        >
          <span className="size-5 animate-spin rounded-full border-2 border-teal-200 border-t-teal-700" />
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
        <main className="grid min-h-screen place-items-center bg-slate-100">
          <span
            className="size-6 animate-spin rounded-full border-2 border-teal-200 border-t-teal-700"
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
        <CustomerLoyaltyRoot />
      </Suspense>
    );
  }
  return <StaffRoot />;
}
