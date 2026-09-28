import { lazy, Suspense, useEffect, useState } from "react";
import Login from "@/pages/Login";
import { useStaff } from "@/hooks/useStaff";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import {
  initialInstallationCode,
  initialSetupErrorMessage,
  resolveInitialEntry,
  withoutInstallationCode,
} from "@/lib/initialSetupEntry";

const AuthenticatedApp = lazy(() => import("@/AuthenticatedApp"));
const CustomerLoyalty = lazy(() => import("@/pages/CustomerLoyalty"));
const InitialSetup = lazy(() => import("@/pages/InitialSetup"));
const SystemReadiness = lazy(() => import("@/pages/SystemReadiness"));

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
  const [installationCode, setInstallationCode] = useState(() =>
    initialInstallationCode(window.location.hash)
  );
  const installation = trpc.initialSetup.state.useQuery(undefined, {
    enabled: !staff && !isCheckingSession,
    networkMode: "always",
    retry: 1,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    trpc: { context: { skipBatch: true } },
  });
  const entry = resolveInitialEntry({
    hasStaff: Boolean(staff),
    checkingSession: isCheckingSession,
    state: installation.data,
    loading: installation.isPending || installation.isFetching,
    error: installation.isError,
    fetchedAfterMount: installation.isFetchedAfterMount,
  });

  useEffect(() => {
    const hash = withoutInstallationCode(window.location.hash);
    if (hash !== window.location.hash)
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}${hash}`
      );
  }, []);

  useEffect(() => {
    if (entry === "owner_setup" || entry === "system_setup") {
      window.sessionStorage.removeItem("pos:return-to");
      if (window.location.pathname !== "/setup")
        window.history.replaceState(null, "", "/setup");
    } else if (entry === "login" && window.location.pathname !== "/login") {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (returnTo.startsWith("/") && !returnTo.startsWith("//")) {
        window.sessionStorage.setItem("pos:return-to", returnTo);
      }
      window.history.replaceState(null, "", "/login");
    }
  }, [entry]);

  if (entry === "session_check" || entry === "installation_check") {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 p-6">
        <div
          className="flex items-center gap-3 rounded-xl border border-teal-100 bg-white px-5 py-4 text-sm font-semibold text-slate-700 shadow-lg shadow-slate-200/60"
          role="status"
        >
          <span className="size-5 animate-spin rounded-full border-2 border-teal-200 border-t-teal-700" />
          {entry === "session_check"
            ? "กำลังตรวจสอบเซสชันผู้ใช้งาน..."
            : "กำลังตรวจสอบระบบก่อนเริ่มใช้งาน..."}
        </div>
      </main>
    );
  }

  if (!staff) {
    if (entry === "system_setup" && installation.data)
      return (
        <Suspense
          fallback={
            <main className="p-6" role="status">
              กำลังเปิดหน้าเตรียมระบบ...
            </main>
          }
        >
          <SystemReadiness
            state={installation.data}
            onRefresh={() => void installation.refetch()}
          />
        </Suspense>
      );
    if (entry === "installation_error")
      return (
        <main className="grid min-h-screen place-items-center bg-slate-100 p-6">
          <div
            className="max-w-md space-y-4 rounded-xl border bg-white p-6"
            role="alert"
          >
            <h1 className="font-heading text-xl font-semibold">
              ตรวจสอบระบบไม่สำเร็จ
            </h1>
            <p className="text-sm leading-6 text-slate-600">
              {initialSetupErrorMessage(installation.error, [installationCode])}
            </p>
            <Button onClick={() => void installation.refetch()}>ลองใหม่</Button>
          </div>
        </main>
      );
    if (entry === "owner_setup" && installation.data)
      return (
        <Suspense
          fallback={
            <main className="p-6" role="status">
              กำลังเปิดหน้าสร้างเจ้าของ...
            </main>
          }
        >
          <InitialSetup
            state={installation.data}
            installationCode={installationCode}
            onCompleted={() => setInstallationCode("")}
            onRefresh={() => void installation.refetch()}
          />
        </Suspense>
      );
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
