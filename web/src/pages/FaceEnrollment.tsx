import "@/index.css";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Camera,
  RefreshCw,
  ScanFace,
  Trash2,
  UserRoundCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FaceCapture, type FaceCaptureResult } from "@/components/FaceCapture";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useStaff } from "@/hooks/useStaff";
import { loadFaceEngine } from "@/lib/faceRecognition";
import { trpc } from "@/providers/trpc";

function thaiDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  });
}

export default function FaceEnrollment() {
  const { staff } = useStaff();
  const canManage = staff?.role === "admin" || staff?.role === "manager";
  const profiles = trpc.faceAuth.faceProfileList.useQuery(undefined, {
    enabled: canManage,
  });
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const activeStaffId = selectedStaffId ?? profiles.data?.[0]?.staffId ?? null;

  useEffect(() => {
    // Prepare the models before the manager presses the capture button.
    void loadFaceEngine().catch(() => undefined);
  }, []);

  const enrollFace = trpc.faceAuth.enrollFace.useMutation({
    onSuccess: () => {
      setCapturing(false);
      setConsentConfirmed(false);
      void profiles.refetch();
      toast.success("ลงทะเบียนใบหน้าสำเร็จ");
    },
    onError: error => {
      setCapturing(false);
      toast.error(error.message);
    },
  });
  const deleteFace = trpc.faceAuth.deleteFaceProfile.useMutation({
    onSuccess: result => {
      if (result.deleted) toast.success("ลบข้อมูลใบหน้าแล้ว");
      void profiles.refetch();
    },
    onError: error => toast.error(error.message),
  });

  const finishEnrollment = useCallback(
    (result: FaceCaptureResult) => {
      if (activeStaffId == null || !consentConfirmed) return;
      enrollFace.mutate({
        staffId: activeStaffId,
        embeddings: result.embeddings,
        consentConfirmed: true,
      });
    },
    [activeStaffId, consentConfirmed, enrollFace]
  );

  if (!canManage) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>ไม่มีสิทธิ์ลงทะเบียนใบหน้าพนักงาน</CardTitle>
            <CardDescription>
              เฉพาะผู้ดูแลระบบหรือผู้จัดการสาขาเท่านั้น
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <a href="/workforce">
                <ArrowLeft /> กลับหน้าพนักงาน
              </a>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const selected = profiles.data?.find(row => row.staffId === activeStaffId);

  return (
    <main className="min-h-screen bg-[#f6f5fb] px-4 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-violet-600">
              <ScanFace className="size-4" /> Face enrollment
            </div>
            <h1 className="mt-1 font-heading text-2xl font-bold text-slate-950 sm:text-3xl">
              ลงทะเบียนใบหน้าพนักงาน
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {staff?.branch.name} · เก็บเฉพาะข้อมูลตัวเลขที่เข้ารหัส
              ไม่เก็บรูปภาพ
            </p>
          </div>
          <Button variant="outline" asChild>
            <a href="/workforce">
              <ArrowLeft /> กลับหน้าพนักงาน
            </a>
          </Button>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(320px,.85fr)_minmax(0,1.15fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRoundCheck className="size-5 text-violet-600" />{" "}
                เลือกพนักงาน
              </CardTitle>
              <CardDescription>
                พนักงานต้องอยู่ต่อหน้ากล้องและยินยอมก่อนลงทะเบียน
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <select
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                value={activeStaffId ?? ""}
                disabled={capturing || profiles.isPending}
                onChange={event => {
                  setSelectedStaffId(Number(event.target.value));
                  setConsentConfirmed(false);
                }}
              >
                {profiles.data?.map(row => (
                  <option key={row.staffId} value={row.staffId}>
                    {row.staffName} {row.enrolledAt ? "(ลงทะเบียนแล้ว)" : ""}
                  </option>
                ))}
              </select>
              {selected && (
                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="font-semibold text-slate-900">
                    {selected.staffName}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    สถานะ:{" "}
                    {selected.enrolledAt ? "ลงทะเบียนแล้ว" : "ยังไม่ลงทะเบียน"}
                  </div>
                  {selected.updatedAt && (
                    <div className="mt-1 text-xs text-slate-500">
                      อัปเดต {thaiDateTime(selected.updatedAt)}
                    </div>
                  )}
                </div>
              )}
              <label className="flex items-start gap-3 rounded-2xl border border-violet-100 bg-violet-50 p-4 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-violet-600"
                  checked={consentConfirmed}
                  disabled={capturing}
                  onChange={event => setConsentConfirmed(event.target.checked)}
                />
                <span>
                  พนักงานได้รับคำอธิบายและยินยอมให้เก็บ Face Embedding
                  เพื่อใช้ล็อกอิน โดยสามารถขอลบหรือลงทะเบียนใหม่ได้
                </span>
              </label>
              {!capturing && (
                <Button
                  className="w-full"
                  size="lg"
                  disabled={activeStaffId == null || !consentConfirmed}
                  onClick={() => setCapturing(true)}
                >
                  <Camera /> เริ่มสแกนใบหน้า
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                {capturing
                  ? `กำลังลงทะเบียน ${selected?.staffName ?? ""}`
                  : "กล้องลงทะเบียน"}
              </CardTitle>
              <CardDescription>
                ระบบจะตรวจคนจริงและเก็บตัวอย่างใบหน้า 3 ครั้ง
              </CardDescription>
            </CardHeader>
            <CardContent>
              {capturing ? (
                <FaceCapture
                  mode="enroll"
                  onComplete={finishEnrollment}
                  onCancel={() => setCapturing(false)}
                />
              ) : (
                <div className="grid min-h-72 place-items-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 text-center">
                  <div>
                    <ScanFace className="mx-auto size-14 text-slate-400" />
                    <p className="mt-3 text-sm text-slate-600">
                      เลือกพนักงานและยืนยันความยินยอมเพื่อเปิดกล้อง
                    </p>
                  </div>
                </div>
              )}
              {enrollFace.isPending && (
                <div className="mt-3 rounded-xl bg-violet-50 p-3 text-center text-sm font-medium text-violet-700">
                  <RefreshCw className="mr-2 inline size-4 animate-spin" />
                  กำลังเข้ารหัสและบันทึกข้อมูลใบหน้า...
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>สถานะใบหน้าพนักงานในสาขา</CardTitle>
            <CardDescription>
              ลบข้อมูลได้ทันที
              เมื่อลบแล้วพนักงานจะล็อกอินด้วยใบหน้าไม่ได้จนกว่าจะลงทะเบียนใหม่
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-slate-100">
              {profiles.data?.map(row => (
                <div
                  key={row.staffId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <div className="font-medium text-slate-900">
                      {row.staffName}
                    </div>
                    <div className="text-xs text-slate-500">
                      {row.enrolledAt
                        ? `ลงทะเบียนเมื่อ ${thaiDateTime(row.enrolledAt)}`
                        : "ยังไม่ลงทะเบียน"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        row.enrolledAt
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-50 text-slate-600"
                      }
                    >
                      {row.enrolledAt ? "พร้อมใช้งาน" : "ยังไม่มีใบหน้า"}
                    </Badge>
                    {row.enrolledAt && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={deleteFace.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `ยืนยันลบข้อมูลใบหน้าของ ${row.staffName} หรือไม่?`
                            )
                          ) {
                            deleteFace.mutate({ staffId: row.staffId });
                          }
                        }}
                      >
                        <Trash2 /> ลบ
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
