import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  CheckCircle2,
  CircleAlert,
  HandCoins,
  Loader2,
  ScanLine,
  Timer,
  Wallet,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trpc } from "@/providers/trpc";
import { fmtMoney } from "@/lib/format";
import type { DesktopReceipt } from "@contracts/offline";

export type ThungngernSession = {
  sessionId: number;
  refCode: string;
  payload: string;
  amount: number;
  expiresAt: Date;
};

type DialogStatus = "pending" | "confirmed" | "expired" | "cancelled";

const POLL_INTERVAL_MS = 3_000;

/** เสียงสั้นๆ เมื่อเงินเข้า — แคชเชียร์ไม่ต้องจ้องจอตลอด (ไม่มีไฟล์เสียง ใช้ WebAudio ตรงๆ) */
function playMoneyArrivedChime() {
  try {
    const AudioContextCtor =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    // โทน 2 จังหวะ (สูง → ต่ำลงนิดหน่อย) ฟังแล้วรู้ทันทีว่าเงินเข้า
    [1046.5, 1568].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startAt = context.currentTime + index * 0.18;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.25, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.35);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.4);
    });
    setTimeout(() => void context.close(), 900);
  } catch {
    // เล่นเสียงไม่ได้ (เช่น browser บล็อก) — ไม่กระทบ flow หลัก
  }
}

/** Dialog QR ถุงเงิน — ล็อกยอด, นับถอยหลัง, สแกนสลิปยืนยันอัตโนมัติ, ยืนยันเองได้ */
export function ThungngernQrDialog({
  session,
  onConfirmed,
  onClosed,
}: {
  session: ThungngernSession | null;
  onConfirmed: (receipt: DesktopReceipt) => void;
  onClosed: () => void;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<DialogStatus>("pending");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [slipQr, setSlipQr] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!session) return;
    setStatus("pending");
    setErr("");
    setBusy(false);
    setVerifying(false);
    setSlipQr("");
    let cancelled = false;
    QRCode.toDataURL(session.payload, {
      width: 280,
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then(url => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setErr("สร้างรูป QR ไม่สำเร็จ");
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  // เก็บ callback ล่าสุดใน ref เพื่อไม่ให้ effect ผูกกับ closure เก่า
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  // เงินเข้าแล้ว (ไม่ว่าจาก webhook แจ้งเงินเข้า / สแกนสลิป / ยืนยันเอง) — แจ้งด้วยเสียงทันที
  useEffect(() => {
    if (status === "confirmed") playMoneyArrivedChime();
  }, [status]);

  // poll สถานะทุก 3 วินาที — อ่านอย่างเดียว; การปิดบิลเกิดจากการสแกนสลิป/ยืนยันเอง
  const statusQuery = trpc.payments.sessionStatus.useQuery(
    { sessionId: session?.sessionId ?? -1 },
    {
      enabled: !!session && status === "pending",
      refetchInterval: POLL_INTERVAL_MS,
      retry: false,
    }
  );

  const statusData = statusQuery.data;
  const statusError = statusQuery.error;
  useEffect(() => {
    if (statusError) {
      setErr(statusError.message);
      return;
    }
    if (!statusData || status !== "pending") return;
    setSecondsLeft(statusData.view.secondsLeft);
    if (statusData.receipt) {
      setStatus("confirmed");
      // ให้ผู้ใช้เห็นสถานะยืนยันสั้นๆ ก่อนปิดไปหน้าใบเสร็จ
      setTimeout(() => onConfirmedRef.current(statusData.receipt!), 900);
    } else if (
      statusData.view.status === "expired" ||
      statusData.view.secondsLeft <= 0
    ) {
      setStatus("expired");
    } else if (statusData.view.status === "cancelled") {
      setStatus("cancelled");
    }
  }, [statusData, statusError, status]);

  // นับถอยหลังฝั่งจอระหว่างรอ poll รอบถัดไป
  useEffect(() => {
    if (!session || status !== "pending") return;
    const expiresAtMs = new Date(session.expiresAt).getTime();
    const interval = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000)));
    }, 1_000);
    return () => clearInterval(interval);
  }, [session, status]);

  const manualConfirm = trpc.payments.manualConfirm.useMutation();
  const cancelSession = trpc.payments.cancelSession.useMutation();
  const verifySlip = trpc.payments.verifySlip.useMutation();

  const verifyScannedSlip = async () => {
    if (!session || busy || verifying) return;
    const qrCode = slipQr.trim();
    if (!qrCode) {
      setErr("กรุณาสแกนหรือวาง QR จากสลิปของลูกค้าก่อน");
      return;
    }
    setVerifying(true);
    setErr("");
    try {
      const result = await verifySlip.mutateAsync({
        sessionId: session.sessionId,
        qrCode,
      });
      setStatus("confirmed");
      setTimeout(() => onConfirmedRef.current(result.receipt), 900);
    } catch (error) {
      // session ยัง pending — แก้สลิปแล้วลองใหม่ได้
      setErr(error instanceof Error ? error.message : "ตรวจสลิปไม่สำเร็จ");
      setVerifying(false);
    }
  };

  const confirmManually = async () => {
    if (!session || busy) return;
    setBusy(true);
    setErr("");
    try {
      const result = await manualConfirm.mutateAsync({
        sessionId: session.sessionId,
      });
      setStatus("confirmed");
      setTimeout(() => onConfirmedRef.current(result.receipt), 900);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "ยืนยันการชำระไม่สำเร็จ");
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!session || busy) return;
    setBusy(true);
    try {
      await cancelSession.mutateAsync({ sessionId: session.sessionId });
    } catch {
      // session อาจถูกปิดไปแล้ว — ปิด dialog อยู่ดี
    } finally {
      setBusy(false);
      setStatus("cancelled");
      onClosed();
    }
  };

  const mm = String(Math.floor(secondsLeft / 60)).padStart(1, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <Dialog
      open={!!session}
      onOpenChange={open => {
        if (!open && status === "pending") void cancel();
        else if (!open) onClosed();
      }}
    >
      <DialogContent
        className="max-w-sm gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <div className="relative overflow-hidden border-b border-white/10 bg-gradient-to-br from-[#17143a] via-[#282263] to-[#15505d] px-6 py-5 text-white">
            <div className="surface-grid pointer-events-none absolute inset-0 opacity-50" />
            <div className="relative flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-600 text-white shadow-lg ring-1 ring-white/20">
                <Wallet className="size-5" />
              </div>
              <div>
                <DialogTitle className="font-heading text-lg text-white">
                  QR ถุงเงิน (Krungthai)
                </DialogTitle>
                <p className="mt-0.5 text-xs text-white/50">
                  อ้างอิง {session?.refCode}
                </p>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 p-6">
          <div className="flex items-end justify-between rounded-2xl bg-gradient-to-br from-[#181540] via-[#292269] to-[#145064] px-4 py-3.5 text-white ring-1 ring-white/10">
            <div className="text-xs font-medium text-blue-200">
              ยอดที่ต้องชำระ (ล็อกใน QR)
            </div>
            <span className="font-heading text-2xl font-bold number-display">
              ฿{fmtMoney(session?.amount ?? 0)}
            </span>
          </div>

          <div className="grid place-items-center rounded-2xl border border-slate-200 bg-white p-3">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QR พร้อมเพย์สำหรับชำระเข้าบัญชีถุงเงิน"
                className="size-[240px] rounded-lg"
              />
            ) : (
              <div className="grid size-[240px] place-items-center text-slate-300">
                <Loader2 className="size-8 animate-spin" />
              </div>
            )}
          </div>

          {status === "pending" && (
            <div className="flex items-center justify-between rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800 ring-1 ring-amber-200">
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> รอชำระ —
                ให้ลูกค้าสแกนด้วยแอปธนาคารใดก็ได้
                เงินเข้าแล้วระบบจะยืนยันให้อัตโนมัติ
              </span>
              <span className="flex items-center gap-1 font-bold number-display">
                <Timer className="size-4" /> {mm}:{ss}
              </span>
            </div>
          )}

          {status === "pending" && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <label
                htmlFor="slip-qr-input"
                className="flex items-center gap-1.5 text-xs font-medium text-slate-600"
              >
                <ScanLine className="size-3.5" />
                ระบบยังไม่แจ้งเงินเข้า? สแกน QR บนสลิปจากแอปธนาคารของลูกค้า
                เพื่อยืนยันทันที
              </label>
              <Input
                id="slip-qr-input"
                autoFocus
                value={slipQr}
                onChange={event => setSlipQr(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void verifyScannedSlip();
                  }
                }}
                placeholder="สแกนหรือวาง QR จากสลิปที่นี่"
                disabled={verifying || busy}
                className="h-11 bg-white font-mono text-xs"
              />
              <Button
                type="button"
                className="h-11 w-full rounded-xl"
                disabled={verifying || busy || !slipQr.trim()}
                onClick={() => void verifyScannedSlip()}
              >
                {verifying ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    กำลังตรวจสลิปกับธนาคาร...
                  </>
                ) : (
                  <>
                    <ScanLine className="size-4" />
                    ตรวจสลิปและยืนยันรับเงิน
                  </>
                )}
              </Button>
            </div>
          )}
          {status === "confirmed" && (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200">
              <CheckCircle2 className="size-5" /> เงินเข้าแล้ว —
              ได้รับเงินเรียบร้อย กำลังพิมพ์ใบเสร็จ
            </div>
          )}
          {status === "expired" && (
            <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600 ring-1 ring-slate-200">
              <XCircle className="size-5" /> หมดเวลา —
              QR นี้ใช้ไม่ได้แล้ว กรุณาสร้างใหม่
            </div>
          )}
          {status === "cancelled" && (
            <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600 ring-1 ring-slate-200">
              <XCircle className="size-5" /> ยกเลิกรายการแล้ว
            </div>
          )}

          {err && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" /> {err}
            </div>
          )}

          {status === "pending" && (
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                className="h-12 w-full rounded-xl"
                disabled={busy || verifying}
                onClick={() => void confirmManually()}
              >
                <HandCoins className="size-4" />
                {busy ? "กำลังยืนยัน..." : "ลูกค้าจ่ายแล้ว — ยืนยันเอง"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-full rounded-xl text-slate-500"
                disabled={busy || verifying}
                onClick={() => void cancel()}
              >
                ยกเลิกรายการ
              </Button>
            </div>
          )}
          {(status === "expired" || status === "cancelled") && (
            <Button
              type="button"
              className="h-12 w-full rounded-xl"
              onClick={onClosed}
            >
              ปิด
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
