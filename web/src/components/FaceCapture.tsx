import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  LoaderCircle,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  detectFaceFrame,
  loadFaceEngine,
  type FaceFrame,
} from "@/lib/faceRecognition";

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

const actionLabel: Record<FaceLivenessAction, string> = {
  blink: "กะพริบตา 1 ครั้ง",
  turn_left: "หันหน้าไปทางซ้าย",
  turn_right: "หันหน้าไปทางขวา",
};

function qualityReady(frame: FaceFrame): boolean {
  return (
    frame.faceScore >= 0.6 &&
    frame.real >= 0.6 &&
    frame.live >= 0.6 &&
    frame.faceSize >= 160
  );
}

function frameStatus(frame: FaceFrame | null, faceCount: number): string {
  if (faceCount === 0) return "วางใบหน้าให้อยู่ในกรอบ";
  if (faceCount > 1) return "กรุณาให้มีเพียง 1 คนในภาพ";
  if (!frame) return "กำลังอ่านรายละเอียดใบหน้า...";
  if (frame.faceSize < 160) return "ขยับเข้าใกล้กล้องอีกเล็กน้อย";
  if (frame.faceScore < 0.6) return "หันหน้าเข้าหากล้องและเพิ่มแสงสว่าง";
  if (frame.real < 0.6 || frame.live < 0.6) {
    return "กำลังตรวจว่าเป็นบุคคลจริง...";
  }
  return "ตรวจพบใบหน้าแล้ว";
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
  const samplesRef = useRef<number[][]>([]);
  const lastSampleAtRef = useRef(0);
  const [phase, setPhase] = useState<"loading" | "scanning" | "done" | "error">(
    "loading"
  );
  const [message, setMessage] = useState("กำลังโหลดโมเดลตรวจใบหน้า...");
  const [error, setError] = useState("");
  const [samples, setSamples] = useState(0);
  const [scores, setScores] = useState({ real: 0, live: 0 });

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

    const fail = (value: string) => {
      stopCamera();
      setError(value);
      setPhase("error");
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
              width: { ideal: 720 },
              height: { ideal: 720 },
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
        setMessage(
          mode === "enroll"
            ? "มองตรงและกะพริบตา 1 ครั้ง"
            : action
              ? actionLabel[action]
              : "มองตรงเข้าหากล้อง"
        );

        while (!cancelledRef.current) {
          if (Date.now() - startedAt > 60_000) {
            fail("ตรวจใบหน้าไม่สำเร็จภายในเวลาที่กำหนด กรุณาลองใหม่");
            return;
          }
          if (processingRef.current || video.readyState < 2) {
            await new Promise(resolve => window.setTimeout(resolve, 120));
            continue;
          }
          processingRef.current = true;
          try {
            const { frame, faceCount } = await detectFaceFrame(engine, video);
            if (cancelledRef.current) return;
            if (!frame) {
              stableFramesRef.current = 0;
              setMessage(frameStatus(frame, faceCount));
              continue;
            }
            setScores({ real: frame.real, live: frame.live });
            const blinkNow = frame.gestures.some(gesture =>
              gesture.startsWith("blink ")
            );
            if (blinkNow) blinkStartedRef.current = true;
            const blinkComplete = blinkStartedRef.current && !blinkNow;
            const requestedAction = mode === "enroll" ? "blink" : action;
            const actionObserved =
              requestedAction === "blink"
                ? blinkComplete
                : requestedAction === "turn_left"
                  ? frame.gestures.includes("facing left")
                  : requestedAction === "turn_right"
                    ? frame.gestures.includes("facing right")
                    : true;
            if (actionObserved) actionDoneRef.current = true;

            if (!qualityReady(frame)) {
              stableFramesRef.current = 0;
              setMessage(frameStatus(frame, faceCount));
              continue;
            }
            if (!actionDoneRef.current) {
              setMessage(
                requestedAction
                  ? actionLabel[requestedAction]
                  : "มองตรงเข้าหากล้อง"
              );
              continue;
            }
            const facingCenter = frame.gestures.includes("facing center");
            if (!facingCenter) {
              stableFramesRef.current = 0;
              setMessage("ดีมาก ตอนนี้กลับมามองตรงเข้าหากล้อง");
              continue;
            }
            stableFramesRef.current += 1;
            if (stableFramesRef.current < 2) {
              setMessage("อยู่นิ่ง ๆ กำลังเก็บข้อมูลใบหน้า...");
              continue;
            }

            if (mode === "enroll") {
              if (Date.now() - lastSampleAtRef.current < 650) continue;
              lastSampleAtRef.current = Date.now();
              samplesRef.current.push(frame.embedding);
              setSamples(samplesRef.current.length);
              stableFramesRef.current = 0;
              if (samplesRef.current.length < 3) {
                setMessage(
                  `เก็บตัวอย่าง ${samplesRef.current.length}/3 แล้ว ขยับใบหน้าเล็กน้อยและมองตรง`
                );
                continue;
              }
            }

            cancelledRef.current = true;
            stream.getTracks().forEach(track => track.stop());
            streamRef.current = null;
            setPhase("done");
            setMessage("ตรวจใบหน้าสำเร็จ");
            onCompleteRef.current({
              embeddings:
                mode === "enroll" ? samplesRef.current : [frame.embedding],
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

  return (
    <div className="space-y-4">
      <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-slate-950">
        <video
          ref={videoRef}
          muted
          playsInline
          className="size-full -scale-x-100 object-cover"
        />
        <div className="pointer-events-none absolute inset-[12%_20%] rounded-[45%] border-2 border-cyan-300 shadow-[0_0_0_999px_rgba(2,6,23,0.42)]" />
        <div className="absolute inset-x-4 top-4 flex justify-center">
          <div className="rounded-full bg-slate-950/75 px-4 py-2 text-center text-sm font-semibold text-white backdrop-blur">
            {phase === "loading" && (
              <LoaderCircle className="mr-2 inline size-4 animate-spin" />
            )}
            {phase === "done" && (
              <ShieldCheck className="mr-2 inline size-4 text-emerald-300" />
            )}
            {message}
          </div>
        </div>
        {phase === "loading" && (
          <div className="absolute inset-0 grid place-items-center text-white">
            <div className="text-center">
              <ScanFace className="mx-auto size-14 text-cyan-300" />
              <p className="mt-3 text-sm text-slate-300">
                ครั้งแรกอาจใช้เวลาสักครู่
              </p>
            </div>
          </div>
        )}
      </div>

      {mode === "enroll" && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-slate-600">
            <span>ตัวอย่างใบหน้า</span>
            <span>{samples}/3</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-violet-600 transition-all"
              style={{ width: `${(samples / 3) * 100}%` }}
            />
          </div>
        </div>
      )}

      {phase === "scanning" && (
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
          <div className="rounded-xl bg-slate-100 p-2 text-center">
            บุคคลจริง {Math.round(scores.real * 100)}%
          </div>
          <div className="rounded-xl bg-slate-100 p-2 text-center">
            การเคลื่อนไหว {Math.round(scores.live * 100)}%
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        {phase === "error" && (
          <Button className="flex-1" onClick={() => window.location.reload()}>
            <RefreshCw /> ลองใหม่
          </Button>
        )}
        <Button
          className="flex-1"
          type="button"
          variant="outline"
          onClick={() => {
            stopCamera();
            onCancelRef.current();
          }}
        >
          {phase === "error" ? <Camera /> : <X />} ยกเลิก
        </Button>
      </div>
    </div>
  );
}
