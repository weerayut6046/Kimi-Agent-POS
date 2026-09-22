import { BrowserRouter } from "react-router";
import { LockKeyhole, LogOut, RefreshCw, WifiOff } from "lucide-react";
import App from "@/App";
import { Button } from "@/components/ui/button";
import "@/index.css";
import "@/lib/enableTailwindMerge";
import { useStaff } from "@/hooks/useStaff";
import { trpc } from "@/providers/trpc";

type AccessStatus = {
  message: string | null;
  workDate: string;
  activeShift: {
    id: number;
    staffName: string;
    openedAt: string;
  } | null;
};

function thaiWorkDate(value: string): string {
  const date = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("th-TH", {
    dateStyle: "long",
    timeZone: "Asia/Bangkok",
  });
}

function thaiDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  });
}

function AccessStatusPage({
  access,
  error,
  onRefresh,
}: {
  access?: AccessStatus;
  error?: string;
  onRefresh: () => void;
}) {
  const { staff, logout } = useStaff();
  const shift = access?.activeShift;

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f5fb] p-5">
      <section className="w-full max-w-lg rounded-[30px] border border-violet-100 bg-white p-7 text-center shadow-xl shadow-violet-100/45 sm:p-9">
        <div className="mx-auto grid size-16 place-items-center rounded-[22px] bg-orange-50 text-orange-600">
          {error ? (
            <WifiOff className="size-8" />
          ) : (
            <LockKeyhole className="size-8" />
          )}
        </div>
        <h1 className="mt-5 font-heading text-2xl font-bold text-slate-900">
          {error ? "ตรวจสอบสิทธิ์ไม่สำเร็จ" : "ยังเข้าใช้งานระบบไม่ได้"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {error ?? access?.message ?? "มีกะของพนักงานคนอื่นกำลังใช้งานอยู่"}
        </p>

        {shift && access && (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left text-sm text-slate-700">
            <div className="font-bold text-slate-900">
              กะที่กำลังใช้งาน #{shift.id}
            </div>
            <div className="mt-2">ผู้เปิดกะ: {shift.staffName}</div>
            <div className="mt-1">
              เปิดเมื่อ: {thaiDateTime(shift.openedAt)}
            </div>
            <div className="mt-1">
              วันที่ตรวจตารางงาน: {thaiWorkDate(access.workDate)}
            </div>
          </div>
        )}

        <p className="mt-5 text-xs text-slate-500">
          {staff?.name} · {staff?.branch.name}
        </p>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <Button onClick={onRefresh}>
            <RefreshCw className="mr-2 size-4" /> ตรวจสอบอีกครั้ง
          </Button>
          <Button variant="outline" onClick={logout}>
            <LogOut className="mr-2 size-4" /> ออกจากระบบ
          </Button>
        </div>
        {!error && (
          <p className="mt-4 text-xs leading-5 text-slate-500">
            หากคุณมีตารางงานวันนี้ ให้ผู้จัดการตรวจสอบตารางงานในระบบ
          </p>
        )}
      </section>
    </main>
  );
}

export default function AuthenticatedApp() {
  const access = trpc.auth.systemAccess.useQuery(undefined, {
    retry: 1,
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  if (!access.data && access.isPending) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f6f5fb]">
        <div className="flex items-center gap-3 text-sm font-semibold text-slate-700">
          <span className="size-6 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
          กำลังตรวจสอบสิทธิ์เข้าใช้งาน...
        </div>
      </main>
    );
  }

  if (!access.data) {
    return (
      <AccessStatusPage
        error={access.error?.message ?? "ไม่สามารถตรวจสอบสถานะกะได้"}
        onRefresh={() => void access.refetch()}
      />
    );
  }

  if (!access.data.allowed) {
    return (
      <AccessStatusPage
        access={access.data}
        onRefresh={() => void access.refetch()}
      />
    );
  }

  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}
