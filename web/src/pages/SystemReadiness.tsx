import {
  CheckCircle2,
  CircleAlert,
  Database,
  Droplet,
  RefreshCw,
} from "lucide-react";
import type { InitialSetupState } from "@contracts/initialSetup";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

const labels = {
  database: "เชื่อมต่อฐานข้อมูล",
  schema: "โครงสร้างข้อมูล",
  session: "ระบบเข้าสู่ระบบ",
  staff_auth: "ระบบบัญชีผู้ใช้งาน",
  installation_code: "สิทธิ์เริ่มต้นกิจการ",
};
const statusLabels = {
  ready: "พร้อมแล้ว",
  missing: "รอเตรียม",
  unavailable: "ยังตรวจสอบไม่ได้",
};

export default function SystemReadiness({
  state,
  onRefresh,
}: {
  state: InitialSetupState;
  onRefresh: () => void;
}) {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-2xl space-y-5">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-blue-600 text-white">
            <Droplet className="size-6" />
          </span>
          <div>
            <p className="font-heading text-lg font-bold text-slate-900">
              PumpPOS
            </p>
            <p className="text-sm text-slate-600">เตรียมระบบก่อนเริ่มใช้งาน</p>
          </div>
        </div>
        <Card className="border-slate-200 bg-white">
          <CardHeader>
            <h1 className="font-heading text-2xl font-semibold text-slate-900">
              เตรียมฐานข้อมูลและระบบ
            </h1>
            <p className="text-sm leading-6 text-slate-600">
              ให้ผู้ติดตั้งเปิดตัวช่วยเตรียมระบบบนเครื่องเซิร์ฟเวอร์ แล้วเลือก
              Supabase หรือฐานข้อมูลในเครื่อง
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              <p className="flex items-center gap-2 font-medium">
                <Database className="size-4 shrink-0" />
                {state.databaseMode === "supabase"
                  ? "ใช้ฐานข้อมูล Supabase"
                  : state.databaseMode === "local"
                    ? "ใช้ฐานข้อมูลในเครื่อง"
                    : "เลือกฐานข้อมูลในตัวช่วยติดตั้ง"}
              </p>
              <p className="mt-2">
                เมื่อตรวจผ่านครบ ระบบจะพาไปสร้างบัญชีเจ้าของและเตรียมกิจการต่อ
                ข้อมูลเชื่อมต่อให้กรอกในตัวช่วยของผู้ติดตั้ง
              </p>
            </div>
            <div className="space-y-3" aria-label="ความพร้อมของระบบ">
              {state.checks?.map(check => (
                <div
                  key={check.key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-4 text-sm"
                >
                  <span className="flex items-center gap-2 text-slate-800">
                    {check.status === "ready" ? (
                      <CheckCircle2 className="size-4 text-emerald-600" />
                    ) : (
                      <CircleAlert className="size-4 text-amber-600" />
                    )}
                    {labels[check.key]}
                  </span>
                  <span
                    className={
                      check.status === "ready"
                        ? "text-emerald-700"
                        : "text-slate-600"
                    }
                  >
                    {statusLabels[check.status]}
                  </span>
                </div>
              ))}
            </div>
            <Button
              className="h-auto min-h-11 w-full whitespace-normal"
              onClick={onRefresh}
            >
              <RefreshCw className="size-4" /> ตรวจความพร้อมอีกครั้ง
            </Button>
            <details className="rounded-xl border border-slate-200 p-4 text-sm">
              <summary className="cursor-pointer font-medium text-slate-800">
                คู่มือผู้ติดตั้ง
              </summary>
              <div className="mt-3 space-y-3 leading-6 text-slate-600">
                <p>
                  เปิดโฟลเดอร์โครงการบนเครื่องเซิร์ฟเวอร์
                  แล้วเรียกตัวช่วยเตรียมระบบ
                </p>
                <pre className="overflow-x-auto rounded-lg bg-slate-100 px-3 py-2 text-slate-800">
                  <code>npm run setup:system</code>
                </pre>
                <p>
                  ตัวช่วยจะเปิดหน้าตั้งค่าบนเครื่องผู้ติดตั้ง ให้เลือก Supabase
                  หรือฐานข้อมูลในเครื่อง และเตรียมข้อมูลตามขั้นตอน
                  จากนั้นกลับมาหน้านี้แล้วตรวจความพร้อมอีกครั้ง
                </p>
              </div>
            </details>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
