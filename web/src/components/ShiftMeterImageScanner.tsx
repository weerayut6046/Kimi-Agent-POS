import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ImagePlus,
  Images,
  LoaderCircle,
  ScanLine,
  Trash2,
} from "lucide-react";
import {
  METER_OCR_MAX_SELECTED_IMAGES,
  type MeterDisplayMode,
  type MeterDisplaySide,
} from "@contracts/meterOcr";
import { assessMeterReading } from "@contracts/meterReconciliation";
import {
  scanMeterImageLocally,
  type MeterImageScanResult,
} from "@/lib/localMeterOcr";
import {
  prepareMeterImage,
  suggestNozzleId,
  type MeterNozzleTarget,
  type PreparedMeterImage,
} from "@/lib/shiftMeterScan";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ReviewRow = {
  id: string;
  imageId: string;
  imageName: string;
  pumpNumber: number | null;
  mode: MeterDisplayMode;
  side: MeterDisplaySide;
  prefixDigits: string;
  mainDigits: string;
  value: string;
  confidence: number;
  nozzleId: number | null;
  sourceValid: boolean;
};

type ScanNote = {
  imageId: string;
  imageName: string;
  pumpNumber: number | null;
  mode: MeterDisplayMode;
  issue: string;
  screenCount: number;
};

type Props = {
  targets: MeterNozzleTarget[];
  onApply: (values: Record<number, { l?: string; p?: string }>) => void;
};

function sideLabel(side: MeterDisplaySide) {
  return side === "left" ? "จอซ้าย" : "จอขวา";
}

function modeLabel(mode: MeterDisplayMode) {
  if (mode === "L") return "L · ลิตร";
  if (mode === "P") return "P · บาท";
  return "ยังไม่ทราบ L/P";
}

export default function ShiftMeterImageScanner({ targets, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState<PreparedMeterImage[]>([]);
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([]);
  const [scanNotes, setScanNotes] = useState<ScanNote[]>([]);
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [localScanning, setLocalScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const multipleInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const scanning = localScanning;

  const imageById = useMemo(
    () => new Map(images.map(image => [image.id, image])),
    [images]
  );
  const targetById = useMemo(
    () => new Map(targets.map(target => [target.nozzleId, target])),
    [targets]
  );

  const rowProblems = useMemo(() => {
    const problems = new Map<string, string>();
    const keys = new Map<string, number>();
    for (const row of reviewRows) {
      if (row.mode !== "L" && row.mode !== "P") {
        problems.set(row.id, "กรุณาเลือกว่าภาพนี้เป็น L หรือ P");
        continue;
      }
      if (row.nozzleId == null) {
        problems.set(row.id, "กรุณาเลือกหัวจ่าย");
        continue;
      }
      const value = Number(row.value);
      if (!row.value.trim() || !Number.isFinite(value) || value < 0) {
        problems.set(row.id, "เลขมิเตอร์ไม่ถูกต้อง");
        continue;
      }
      const target = targetById.get(row.nozzleId);
      if (!target) {
        problems.set(row.id, "ไม่พบหัวจ่ายในกะปัจจุบัน");
        continue;
      }
      const openingValue =
        row.mode === "L" ? target.openMeter : target.openMoney;
      if (value < openingValue) {
        problems.set(
          row.id,
          `${row.mode} ปิดกะต้องไม่น้อยกว่าค่าเปิดกะ ${openingValue}`
        );
        continue;
      }
      const key = `${row.nozzleId}:${row.mode}`;
      keys.set(key, (keys.get(key) ?? 0) + 1);
    }
    for (const row of reviewRows) {
      if (
        row.nozzleId != null &&
        (row.mode === "L" || row.mode === "P") &&
        (keys.get(`${row.nozzleId}:${row.mode}`) ?? 0) > 1
      ) {
        problems.set(row.id, `มีค่า ${row.mode} ของหัวจ่ายนี้ซ้ำ`);
      }
    }
    for (const target of targets) {
      const literRows = reviewRows.filter(
        row => row.nozzleId === target.nozzleId && row.mode === "L"
      );
      const moneyRows = reviewRows.filter(
        row => row.nozzleId === target.nozzleId && row.mode === "P"
      );
      if (literRows.length !== 1 || moneyRows.length !== 1) continue;
      const literRow = literRows[0]!;
      const moneyRow = moneyRows[0]!;
      if (problems.has(literRow.id) || problems.has(moneyRow.id)) continue;
      const closeMeter = Number(literRow.value);
      const closeMoney = Number(moneyRow.value);
      if (!Number.isFinite(closeMeter) || !Number.isFinite(closeMoney))
        continue;
      const assessment = assessMeterReading({
        openMeter: target.openMeter,
        closeMeter,
        openMoney: target.openMoney,
        closeMoney,
        pricePerLiter: target.pricePerLiter,
        priceChangedDuringShift: target.priceChangedDuringShift,
      });
      if (!assessment.implausible) continue;
      const suggestion =
        assessment.suggestedCloseMoney == null
          ? ""
          : ` ค่าที่น่าจะเป็นคือ ${assessment.suggestedCloseMoney.toLocaleString("th-TH", { maximumFractionDigits: 3 })}`;
      problems.set(
        moneyRow.id,
        `ยอด P เพิ่ม ${assessment.moneyFromMeter?.toLocaleString("th-TH")} บาท แต่ยอดจาก L × ราคาเป็น ${assessment.amountFromLiters.toLocaleString("th-TH")} บาท คลาดเคลื่อนมากผิดปกติ กรุณาตรวจเลข P${suggestion}`
      );
    }
    return problems;
  }, [reviewRows, targetById, targets]);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setError("");
    const existingIds = new Set(images.map(image => image.id));
    const available = METER_OCR_MAX_SELECTED_IMAGES - existingIds.size;
    if (available <= 0) {
      setError(`เลือกได้สูงสุด ${METER_OCR_MAX_SELECTED_IMAGES} ภาพต่อครั้ง`);
      return;
    }

    const files = Array.from(fileList)
      .filter(file => {
        const id = `${file.name}:${file.size}:${file.lastModified}`;
        return !existingIds.has(id);
      })
      .slice(0, available);
    if (!files.length) return;

    setPreparing(true);
    try {
      const prepared: PreparedMeterImage[] = [];
      for (const file of files) {
        prepared.push(await prepareMeterImage(file));
      }
      setImages(current => [...current, ...prepared]);
      setReviewRows([]);
      setScanNotes([]);
      if (fileList.length > files.length) {
        setError(
          `รับภาพได้ ${files.length} ภาพ โดยเลือกได้สูงสุด ${METER_OCR_MAX_SELECTED_IMAGES} ภาพต่อครั้ง`
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "เตรียมไฟล์ภาพไม่สำเร็จ"
      );
    } finally {
      setPreparing(false);
      if (multipleInputRef.current) multipleInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  };

  const removeImage = (imageId: string) => {
    setImages(current => current.filter(image => image.id !== imageId));
    setReviewRows(current => current.filter(row => row.imageId !== imageId));
    setScanNotes(current => current.filter(note => note.imageId !== imageId));
  };

  const scanImages = async () => {
    if (!images.length) return;
    setError("");
    setReviewRows([]);
    setScanNotes([]);
    setProgress({ done: 0, total: images.length });
    const nextRows: ReviewRow[] = [];
    const nextNotes: ScanNote[] = [];

    try {
      setLocalScanning(true);
      for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
        const image = images[imageIndex]!;
        const result: MeterImageScanResult = await scanMeterImageLocally(
          image,
          imageIndex
        );
        nextNotes.push({
          imageId: image.id,
          imageName: image.fileName,
          pumpNumber: result.pumpNumber,
          mode: result.mode,
          issue: result.issue,
          screenCount: result.screens.length,
        });
        for (const screen of result.screens) {
          nextRows.push({
            id: `${image.id}:${screen.side}`,
            imageId: image.id,
            imageName: image.fileName,
            pumpNumber: result.pumpNumber,
            mode: result.mode,
            side: screen.side,
            prefixDigits: screen.prefixDigits,
            mainDigits: screen.mainDigits,
            value: screen.combinedText ?? "",
            confidence: screen.confidence,
            nozzleId: suggestNozzleId(targets, result.pumpNumber, screen.side),
            sourceValid: screen.valid,
          });
        }
        setProgress(current => ({
          ...current,
          done: Math.min(current.total, imageIndex + 1),
        }));
        await new Promise<void>(resolve =>
          requestAnimationFrame(() => resolve())
        );
      }
      setReviewRows(nextRows);
      setScanNotes(nextNotes);
      if (!nextRows.length) {
        setError("ยังอ่านเลขมิเตอร์จากภาพไม่ได้ กรุณาตรวจภาพหรือกรอกด้วยตนเอง");
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "อ่านตัวเลขจากภาพไม่สำเร็จ"
      );
    } finally {
      setLocalScanning(false);
    }
  };

  const applyValues = () => {
    if (!reviewRows.length || rowProblems.size > 0) return;
    const values: Record<number, { l?: string; p?: string }> = {};
    for (const row of reviewRows) {
      if (row.nozzleId == null || (row.mode !== "L" && row.mode !== "P")) {
        return;
      }
      values[row.nozzleId] = {
        ...values[row.nozzleId],
        ...(row.mode === "L" ? { l: row.value } : { p: row.value }),
      };
    }
    onApply(values);
    setOpen(false);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-10"
        onClick={() => setOpen(true)}
      >
        <Images className="mr-2 h-4 w-4" />
        อ่านมิเตอร์จากรูปภาพ
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="border-b bg-slate-50 px-5 py-4 text-left">
            <DialogTitle className="flex items-center gap-2">
              <ScanLine className="h-5 w-5 text-blue-600" />
              อ่านมิเตอร์ L/P จากหลายรูป
            </DialogTitle>
            <DialogDescription>
              เลือกรูปของหลายตู้พร้อมกันได้ ระบบจะรวมเลขด้านบนกับด้านล่าง
              แล้วให้ตรวจทานก่อนเติมแบบฟอร์มปิดกะ ·
              ประมวลผลในเครื่องและไม่ส่งภาพออก
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
            <input
              ref={multipleInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={event => handleFiles(event.target.files)}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={event => handleFiles(event.target.files)}
            />

            <section className="rounded-xl border bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">1. เพิ่มภาพหน้าตู้</div>
                  <p className="text-xs text-muted-foreground">
                    เลือกได้สูงสุด {METER_OCR_MAX_SELECTED_IMAGES} ภาพ
                    และสามารถถ่ายเพิ่มทีละภาพได้
                  </p>
                  <p className="mt-1 text-xs text-blue-700">
                    เพื่อความแม่นยำ ให้ถ่ายหน้าตรง เห็น LCD
                    หลักทั้งสองจอเต็มกรอบ และหลีกเลี่ยงเงาหรือแสงสะท้อนบนจอ
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={preparing || scanning}
                    onClick={() => multipleInputRef.current?.click()}
                  >
                    <ImagePlus className="mr-2 h-4 w-4" />
                    เลือกหลายรูป
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={preparing || scanning}
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    <Camera className="mr-2 h-4 w-4" />
                    ถ่ายเพิ่ม
                  </Button>
                </div>
              </div>

              {preparing && (
                <div className="mt-3 flex items-center gap-2 text-sm text-blue-700">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  กำลังย่อและเตรียมภาพ…
                </div>
              )}

              {images.length > 0 && (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {images.map(image => (
                    <div
                      key={image.id}
                      className="group relative overflow-hidden rounded-lg border bg-slate-50"
                    >
                      <img
                        src={image.previewDataUrl}
                        alt={image.fileName}
                        className="aspect-[4/3] w-full object-cover"
                      />
                      <div className="truncate px-2 py-1.5 text-[11px]">
                        {image.fileName}
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="destructive"
                        aria-label={`ลบ ${image.fileName}`}
                        className="absolute right-1.5 top-1.5 h-7 w-7 opacity-90"
                        disabled={scanning}
                        onClick={() => removeImage(image.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  disabled={!images.length || preparing || scanning}
                  onClick={scanImages}
                >
                  {scanning ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ScanLine className="mr-2 h-4 w-4" />
                  )}
                  {scanning
                    ? `กำลังอ่าน ${progress.done}/${progress.total} ภาพ`
                    : `อ่านตัวเลขจาก ${images.length} ภาพ`}
                </Button>
                {images.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={scanning}
                    onClick={() => {
                      setImages([]);
                      setReviewRows([]);
                      setScanNotes([]);
                      setError("");
                    }}
                  >
                    ล้างทั้งหมด
                  </Button>
                )}
              </div>
            </section>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {scanNotes.length > 0 && (
              <section className="space-y-3 rounded-xl border bg-white p-4">
                <div>
                  <div className="font-medium">2. ตรวจผลการอ่านแต่ละภาพ</div>
                  <p className="text-xs text-muted-foreground">
                    จอราคาลิตรละด้านล่างจะไม่ถูกนำมาเป็นเลขมิเตอร์
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {scanNotes.map(note => (
                    <div
                      key={note.imageId}
                      className="flex items-start gap-3 rounded-lg border px-3 py-2"
                    >
                      <img
                        src={imageById.get(note.imageId)?.previewDataUrl}
                        alt=""
                        className="h-14 w-16 rounded object-cover"
                      />
                      <div className="min-w-0 text-xs">
                        <div className="truncate font-medium">
                          {note.imageName}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge variant="secondary">
                            ตู้ {note.pumpNumber ?? "?"}
                          </Badge>
                          <Badge variant="secondary">
                            {modeLabel(note.mode)}
                          </Badge>
                          <Badge variant="secondary">
                            {note.screenCount} จอ
                          </Badge>
                          <Badge variant="outline">อ่านในเครื่อง</Badge>
                        </div>
                        {note.issue && (
                          <div className="mt-1 text-amber-700">
                            {note.issue}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {reviewRows.length > 0 && (
              <section className="space-y-3 rounded-xl border bg-white p-4">
                <div>
                  <div className="font-medium">3. ยืนยันตัวเลขและหัวจ่าย</div>
                  <p className="text-xs text-muted-foreground">
                    แก้เลขหรือเลือกหัวจ่ายได้ก่อนนำไปเติมแบบฟอร์ม
                  </p>
                </div>

                <div className="space-y-3">
                  {reviewRows.map(row => {
                    const problem = rowProblems.get(row.id);
                    const lowConfidence =
                      row.confidence < 0.85 || !row.sourceValid;
                    return (
                      <div
                        key={row.id}
                        className={`grid gap-3 rounded-xl border p-3 lg:grid-cols-[110px_150px_minmax(180px,1fr)_minmax(230px,1.2fr)_36px] ${
                          problem
                            ? "border-red-300 bg-red-50/40"
                            : lowConfidence
                              ? "border-amber-300 bg-amber-50/40"
                              : "border-emerald-200"
                        }`}
                      >
                        <div className="flex items-center gap-2 lg:block">
                          <img
                            src={imageById.get(row.imageId)?.previewDataUrl}
                            alt={row.imageName}
                            className="h-16 w-24 rounded-md object-cover"
                          />
                          <div className="mt-1 truncate text-[10px] text-muted-foreground">
                            {row.imageName}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <div className="text-xs text-muted-foreground">
                            ตู้ {row.pumpNumber ?? "?"} · {sideLabel(row.side)}
                          </div>
                          <Select
                            value={row.mode}
                            onValueChange={value =>
                              setReviewRows(current =>
                                current.map(item =>
                                  item.id === row.id
                                    ? {
                                        ...item,
                                        mode: value as MeterDisplayMode,
                                        nozzleId: suggestNozzleId(
                                          targets,
                                          item.pumpNumber,
                                          item.side
                                        ),
                                      }
                                    : item
                                )
                              )
                            }
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="L">L · ลิตร</SelectItem>
                              <SelectItem value="P">P · บาท</SelectItem>
                              <SelectItem value="unknown">
                                ยังไม่ทราบ
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <div className="text-xs text-muted-foreground">
                            {row.prefixDigits || "—"} + {row.mainDigits || "—"}{" "}
                            →{" "}
                            <span className="font-semibold text-foreground">
                              {row.value || "อ่านไม่ได้"}
                            </span>
                          </div>
                          <Input
                            type="number"
                            min="0"
                            step={row.mode === "L" ? "0.001" : "0.01"}
                            value={row.value}
                            onChange={event =>
                              setReviewRows(current =>
                                current.map(item =>
                                  item.id === row.id
                                    ? { ...item, value: event.target.value }
                                    : item
                                )
                              )
                            }
                            className="h-9"
                          />
                          <div
                            className={`text-[11px] ${
                              lowConfidence
                                ? "text-amber-700"
                                : "text-emerald-700"
                            }`}
                          >
                            ความมั่นใจ {Math.round(row.confidence * 100)}%
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <div className="text-xs text-muted-foreground">
                            นำไปใส่หัวจ่าย
                          </div>
                          <Select
                            value={
                              row.nozzleId == null
                                ? "unassigned"
                                : String(row.nozzleId)
                            }
                            onValueChange={value =>
                              setReviewRows(current =>
                                current.map(item =>
                                  item.id === row.id
                                    ? {
                                        ...item,
                                        nozzleId:
                                          value === "unassigned"
                                            ? null
                                            : Number(value),
                                      }
                                    : item
                                )
                              )
                            }
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="เลือกหัวจ่าย" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unassigned">
                                ยังไม่เลือก
                              </SelectItem>
                              {targets.map(target => (
                                <SelectItem
                                  key={target.nozzleId}
                                  value={String(target.nozzleId)}
                                >
                                  {target.pumpName} · {target.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {problem ? (
                            <div className="text-[11px] text-red-700">
                              {problem}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-[11px] text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" />
                              พร้อมนำไปใช้
                            </div>
                          )}
                        </div>

                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label="ไม่ใช้ค่ารายการนี้"
                          className="h-9 w-9 text-muted-foreground hover:text-red-600"
                          onClick={() =>
                            setReviewRows(current =>
                              current.filter(item => item.id !== row.id)
                            )
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>

          <DialogFooter className="border-t bg-white px-5 py-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              ปิด
            </Button>
            <Button
              type="button"
              disabled={!reviewRows.length || rowProblems.size > 0}
              onClick={applyValues}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              เติมค่าลงแบบฟอร์ม ({reviewRows.length} ค่า)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
