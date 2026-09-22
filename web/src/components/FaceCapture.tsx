import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  LoaderCircle,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  detectFaceFrame,
  faceFacingCenter,
  loadFaceEngine,
  type FaceFrame,
} from "@/lib/faceRecognition";
import { frameStatus } from "@/lib/faceScanQuality";

export type FaceLivenessAction = "blink" | "turn_left" | "turn_right";

export type FaceCaptureResult = {
  embeddings: number[][];
  quality: {
    faceScore: number;
    real: number;
    live: number;
    faceSize: number;
    actionSatisfied: true;
  };
};

type Props = {
  mode: "enroll" | "verify";
  action?: FaceLivenessAction;
  onComplete: (result: FaceCaptureResult) => void;
  onCancel: () => void;
};

type ScanUi = {
  message: string;
  progress: number;
  faceReady: boolean;
  clarityReady: boolean;
  livenessReady: boolean;
};

const actionLabel: Record<FaceLivenessAction, string> = {
  blink: "หลับตาค้างครู่หนึ่ง แล้วลืมตา",
  turn_left: "หันหน้าไปทางซ้ายค้างครู่หนึ่ง แล้วกลับมามองตรง",
  turn_right: "หันหน้าไปทางขวาค้างครู่หนึ่ง แล้วกลับมามองตรง",
};

const initialScanUi: ScanUi = {
  message: "กำลังเตรียมระบบสแกนใบหน้า...",
  progress: 8,
  faceReady: false,
  clarityReady: false,
  livenessReady: false,
};
const VERIFY_SAMPLE_COUNT = 3;
const ENROLL_SAMPLE_COUNT = 3;
const MAX_TRANSIENT_MISSING_FRAMES = 3;

function qualityReady(frame: FaceFrame): boolean {
  return (
    frame.embedding.length >= 128 &&
    frame.faceScore >= 0.6 &&
    frame.real >= 0.6 &&
    frame.live >= 0.6 &&
    frame.faceSize >= 160
  );
}

function scanUiEqual(left: ScanUi, right: ScanUi): boolean {
  return (
    left.message === right.message &&
    left.progress === right.progress &&
    left.faceReady === right.faceReady &&
    left.clarityReady === right.clarityReady &&
    left.livenessReady === right.livenessReady
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

export function FaceCapture({ mode, action, onComplete, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCompleteRef = useRef(onComplete);
  const onCancelRef = useRef(onCancel);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);
  const processingRef = useRef(false);
  const blinkStartedRef = useRef(false);
  const actionDoneRef = useRef(false);
  const stableFramesRef = useRef(0);
  const missingFaceFramesRef = useRef(0);
  const lastFaceSeenAtRef = useRef(0);
  const samplesRef = useRef<number[][]>([]);
  const lastSampleAtRef = useRef(0);
  const [phase, setPhase] = useState<"loading" | "scanning" | "done" | "error">(
    "loading"
  );
  const [scanUi, setScanUi] = useState<ScanUi>(initialScanUi);
  const [error, setError] = useState("");
  const [samples, setSamples] = useState(0);
  const [actionComplete, setActionComplete] = useState(false);
  const displayedAction = mode === "enroll" ? "blink" : action;

  useEffect(() => {
    onCompleteRef.current = onComplete;
    onCancelRef.current = onCancel;
  }, [onCancel, onComplete]);

  const stopCamera = useCallback(() => {
    cancelledRef.current = true;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    cancelledRef.current = false;
    const startedAt = Date.now();
    const requestedAction = mode === "enroll" ? "blink" : action;

    const updateScanUi = (next: ScanUi) => {
      setScanUi(current => (scanUiEqual(current, next) ? current : next));
    };

    const resetCapturedSamples = () => {
      if (samplesRef.current.length > 0) {
        samplesRef.current = [];
        setSamples(0);
      }
    };

    const resetIdentityProgress = () => {
      resetCapturedSamples();
      blinkStartedRef.current = false;
      actionDoneRef.current = false;
      setActionComplete(false);
    };

    const fail = (value: string) => {
      stopCamera();
      setError(value);
      setPhase("error");
      updateScanUi({ ...initialScanUi, message: "สแกนไม่สำเร็จ", progress: 0 });
    };

    const run = async () => {
      if (!navigator.mediaDevices?.getUserMedia || !videoRef.current) {
        fail(
          "อุปกรณ์นี้ไม่รองรับกล้อง กรุณาเปิดด้วยเบราว์เซอร์ล่าสุดผ่าน HTTPS"
        );
        return;
      }
      try {
        const [engine, stream] = await Promise.all([
          loadFaceEngine(),
          navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: "user",
              width: { ideal: 480 },
              height: { ideal: 640 },
              frameRate: { ideal: 24, max: 30 },
            },
          }),
        ]);
        if (cancelledRef.current) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setPhase("scanning");
        updateScanUi({
          ...initialScanUi,
          message: requestedAction
            ? actionLabel[requestedAction]
            : "มองตรงเข้าหากล้อง",
          progress: 18,
        });

        while (!cancelledRef.current) {
          if (Date.now() - startedAt > 60_000) {
            fail("ตรวจใบหน้าไม่สำเร็จภายในเวลาที่กำหนด กรุณาลองใหม่");
            return;
          }
          if (processingRef.current || video.readyState < 2) {
            await delay(80);
            continue;
          }
          processingRef.current = true;
          try {
            const { frame, faceCount } = await detectFaceFrame(engine, video);
            if (cancelledRef.current) return;
            if (!frame) {
              stableFramesRef.current = 0;
              missingFaceFramesRef.current += 1;
              if (faceCount > 1 ||
                  missingFaceFramesRef.current > MAX_TRANSIENT_MISSING_FRAMES ||
                  Date.now() - lastFaceSeenAtRef.current > 600) {
                resetIdentityProgress();
              } else if (actionDoneRef.current || blinkStartedRef.current || samplesRef.current.length > 0) {
                // A brief detector dropout is common during a blink or turn.
                // Keep the challenge progress, but still require a fresh good
                // frame before collecting another sample.
                continue;
              }
              updateScanUi({
                message: frameStatus(frame, faceCount),
                progress: faceCount === 1 ? 28 : 18,
                faceReady: false,
                clarityReady: false,
                livenessReady: false,
              });
              continue;
            }

            missingFaceFramesRef.current = 0;
            lastFaceSeenAtRef.current = Date.now();

            const faceReady = frame.faceSize >= 160;
            const clarityReady = frame.faceScore >= 0.6;
            const livenessReady = frame.real >= 0.6 && frame.live >= 0.6;
            const blinkNow = frame.gestures.some(gesture =>
              gesture.startsWith("blink ")
            );
            if (blinkNow) blinkStartedRef.current = true;
            const blinkComplete = blinkStartedRef.current && !blinkNow;
            const actionObserved =
              requestedAction === "blink"
                ? blinkComplete
                : requestedAction === "turn_left"
                  ? frame.gestures.includes("facing left")
                  : requestedAction === "turn_right"
                    ? frame.gestures.includes("facing right")
                    : true;
            if (actionObserved && !actionDoneRef.current) {
              actionDoneRef.current = true;
              setActionComplete(true);
            }

            if (!qualityReady(frame)) {
              stableFramesRef.current = 0;
              updateScanUi({
                message: frameStatus(frame, faceCount),
                progress: !faceReady ? 36 : !clarityReady ? 46 : 58,
                faceReady,
                clarityReady,
                livenessReady,
              });
              continue;
            }
            if (!actionDoneRef.current) {
              updateScanUi({
                message: requestedAction
                  ? actionLabel[requestedAction]
                  : "มองตรงเข้าหากล้อง",
                progress: 68,
                faceReady,
                clarityReady,
                livenessReady,
              });
              continue;
            }
            const facingCenter = faceFacingCenter(frame);
            if (!facingCenter) {
              stableFramesRef.current = 0;
              updateScanUi({
                message: "ดีมาก ตอนนี้กลับมามองตรง",
                progress: 82,
                faceReady,
                clarityReady,
                livenessReady,
              });
              continue;
            }

            stableFramesRef.current += 1;
            // Wait for two steady frames after the liveness action. Once the
            // face is centered, later samples only need one fresh good frame.
            const stableFramesRequired = mode === "verify" && samplesRef.current.length > 0
              ? 1 : 2;
            if (stableFramesRef.current < stableFramesRequired) {
              updateScanUi({
                message: "อยู่นิ่ง ๆ อีกนิด กำลังยืนยันใบหน้า",
                progress: 92,
                faceReady,
                clarityReady,
                livenessReady,
              });
              continue;
            }

            if (Date.now() - lastSampleAtRef.current < 400) continue;
            lastSampleAtRef.current = Date.now();
            samplesRef.current.push(frame.embedding);
            const sampleCount = samplesRef.current.length;
            const sampleTarget = mode === "verify"
              ? VERIFY_SAMPLE_COUNT : ENROLL_SAMPLE_COUNT;
            setSamples(sampleCount);
            stableFramesRef.current = 0;
            if (sampleCount < sampleTarget) {
              updateScanUi({
                message: mode === "verify"
                  ? `เก็บภาพที่ชัด ${sampleCount}/${sampleTarget} เฟรม มองกล้องตรงและอยู่นิ่ง ๆ`
                  : `บันทึกครั้งที่ ${sampleCount}/${sampleTarget} แล้ว ขยับหน้าเล็กน้อย`,
                progress: 70 + Math.round(sampleCount * 29 / sampleTarget),
                faceReady,
                clarityReady,
                livenessReady,
              });
              continue;
            }
            cancelledRef.current = true;
            stream.getTracks().forEach(track => track.stop());
            streamRef.current = null;
            setPhase("done");
            updateScanUi({
              message: "ยืนยันใบหน้าสำเร็จ",
              progress: 100,
              faceReady: true,
              clarityReady: true,
              livenessReady: true,
            });
            onCompleteRef.current({
              embeddings: samplesRef.current,
              quality: {
                faceScore: frame.faceScore,
                real: frame.real,
                live: frame.live,
                faceSize: frame.faceSize,
                actionSatisfied: true,
              },
            });
            return;
          } finally {
            processingRef.current = false;
            if (!cancelledRef.current) await delay(70);
          }
        }
      } catch (cause) {
        fail(
          cause instanceof Error && cause.name === "NotAllowedError"
            ? "ไม่ได้รับอนุญาตให้ใช้กล้อง กรุณาอนุญาตกล้องแล้วลองใหม่"
            : "เปิดระบบตรวจใบหน้าไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตและลองใหม่"
        );
      }
    };

    void run();
    return stopCamera;
  }, [action, mode, stopCamera]);

  const ringTone =
    phase === "done"
      ? "border-emerald-300 shadow-[0_0_42px_rgba(52,211,153,0.38)]"
      : phase === "error"
        ? "border-rose-300 shadow-[0_0_42px_rgba(251,113,133,0.3)]"
        : "border-cyan-300 shadow-[0_0_42px_rgba(34,211,238,0.28)]";
  const statusTone =
    phase === "done"
      ? "bg-emerald-400/15 text-emerald-100 ring-emerald-300/30"
      : phase === "error"
        ? "bg-rose-400/15 text-rose-100 ring-rose-300/30"
        : "bg-slate-950/55 text-white ring-white/15";
  const qualityChecks = [
    { label: "อยู่ในกรอบ", ready: scanUi.faceReady },
    { label: "ภาพชัด", ready: scanUi.clarityReady },
    { label: "บุคคลจริง", ready: scanUi.livenessReady },
  ];

  return (
    <div
      className="overflow-hidden rounded-[2rem] bg-slate-950 text-white shadow-2xl shadow-slate-950/25 ring-1 ring-white/10"
      aria-busy={phase === "loading" || phase === "scanning"}
    >
      <div className="relative aspect-[3/4] min-h-[30rem] overflow-hidden sm:aspect-[4/3] sm:min-h-0">
        <video
          ref={videoRef}
          muted
          playsInline
          className="size-full -scale-x-100 object-cover"
        />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,.68)_0%,transparent_24%,transparent_55%,rgba(2,6,23,.92)_100%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_43%,rgba(34,211,238,.08),transparent_44%)]" />

        <div className="absolute inset-x-4 top-4 z-20 flex items-center justify-between gap-3">
          <div className="rounded-full bg-slate-950/55 px-3.5 py-2 text-xs font-semibold text-white/90 ring-1 ring-white/15 backdrop-blur-xl">
            <ShieldCheck className="mr-1.5 inline size-3.5 text-cyan-300" />
            {mode === "enroll" ? "ลงทะเบียนใบหน้า" : "ยืนยันตัวตน"}
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onCancelRef.current();
            }}
            className="grid size-10 place-items-center rounded-full bg-slate-950/55 text-white ring-1 ring-white/15 backdrop-blur-xl transition hover:bg-slate-900/80"
            aria-label="ยกเลิกการสแกนใบหน้า"
          >
            <X className="size-5" />
          </button>
        </div>

        <div
          className={`pointer-events-none absolute left-1/2 top-[43%] h-[55%] w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-[48%] border-[3px] transition-all duration-500 ${ringTone}`}
        >
          <span className="absolute -left-1 -top-1 size-10 rounded-tl-[2rem] border-l-4 border-t-4 border-white" />
          <span className="absolute -right-1 -top-1 size-10 rounded-tr-[2rem] border-r-4 border-t-4 border-white" />
          <span className="absolute -bottom-1 -left-1 size-10 rounded-bl-[2rem] border-b-4 border-l-4 border-white" />
          <span className="absolute -bottom-1 -right-1 size-10 rounded-br-[2rem] border-b-4 border-r-4 border-white" />
          {phase === "scanning" && (
            <div className="absolute inset-x-[9%] inset-y-[12%] overflow-hidden rounded-[48%]">
              <div className="face-scan-beam" />
            </div>
          )}
        </div>

        {phase === "loading" && (
          <div className="absolute inset-0 z-10 grid place-items-center">
            <div className="text-center">
              <div className="mx-auto grid size-20 place-items-center rounded-full bg-cyan-300/10 ring-1 ring-cyan-200/25 backdrop-blur">
                <ScanFace className="size-10 text-cyan-200" />
              </div>
              <div className="mt-4 flex items-center justify-center gap-2 text-sm font-medium text-white/90">
                <LoaderCircle className="size-4 animate-spin text-cyan-300" />
                โหลดระบบครั้งแรก
              </div>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-emerald-950/35 backdrop-blur-[2px]">
            <div className="text-center">
              <div className="mx-auto grid size-24 place-items-center rounded-full bg-emerald-400 text-emerald-950 shadow-2xl shadow-emerald-400/30">
                <ShieldCheck className="size-12" />
              </div>
              <div className="mt-5 text-xl font-bold">ยืนยันสำเร็จ</div>
            </div>
          </div>
        )}

        <div className="absolute inset-x-3 bottom-3 z-20 rounded-2xl bg-slate-950/72 p-4 ring-1 ring-white/10 backdrop-blur-xl sm:inset-x-5 sm:bottom-5">
          <div className="flex items-center justify-between gap-3">
            <div aria-live="polite" className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">
                {mode === "enroll"
                  ? `ตัวอย่าง ${Math.min(samples + 1, ENROLL_SAMPLE_COUNT)}/${ENROLL_SAMPLE_COUNT}`
                  : `ภาพยืนยัน ${Math.min(samples + 1, VERIFY_SAMPLE_COUNT)}/${VERIFY_SAMPLE_COUNT}`}
              </div>
              <div className="mt-1 text-sm font-semibold leading-5 sm:text-base">
                {scanUi.message}
              </div>
            </div>
            <div
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ${statusTone}`}
            >
              {phase === "loading"
                ? "กำลังโหลด"
                : phase === "done"
                  ? "สำเร็จ"
                  : phase === "error"
                    ? "ลองใหม่"
                    : `${scanUi.progress}%`}
            </div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-[width,background-color] duration-500 ${
                phase === "done" ? "bg-emerald-400" : "bg-cyan-300"
              }`}
              style={{ width: `${scanUi.progress}%` }}
            />
          </div>
          {displayedAction && (phase === "loading" || phase === "scanning") && (
            <div
              aria-live="polite"
              className="mt-3 rounded-xl bg-violet-400/15 px-3 py-2 text-sm font-semibold text-violet-100 ring-1 ring-violet-300/25"
            >
              {actionComplete
                ? "ตรวจพบท่าทางแล้ว มองกล้องตรงและอยู่นิ่ง ๆ"
                : `ท่าที่ต้องทำ: ${actionLabel[displayedAction]}`}
            </div>
          )}
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {qualityChecks.map(item => (
              <div
                key={item.label}
                className={`flex items-center justify-center gap-1 rounded-full px-2 py-1.5 text-[10px] font-medium transition sm:text-xs ${
                  item.ready
                    ? "bg-emerald-400/15 text-emerald-200"
                    : "bg-white/[0.07] text-slate-400"
                }`}
              >
                <span
                  className={`grid size-3.5 place-items-center rounded-full ${
                    item.ready
                      ? "bg-emerald-400 text-emerald-950"
                      : "bg-white/10"
                  }`}
                >
                  {item.ready && <Check className="size-2.5" strokeWidth={3} />}
                </span>
                {item.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="space-y-3 border-t border-white/10 bg-slate-950 p-4">
          <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-100">
            {error}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => window.location.reload()}>
              <RefreshCw /> ลองใหม่
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              onClick={() => {
                stopCamera();
                onCancelRef.current();
              }}
            >
              <Camera /> ปิดกล้อง
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
