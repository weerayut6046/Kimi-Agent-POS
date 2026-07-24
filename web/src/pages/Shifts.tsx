import { useMemo, useState } from "react";
import {
  Banknote,
  CalendarClock,
  Clock,
  ClipboardPenLine,
  Fuel,
  Gauge,
  Info,
  LoaderCircle,
  PlayCircle,
  ReceiptText,
  Save,
  StopCircle,
  UserRound,
  WalletCards,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { fmtMoney, fmtNum, fmtDateTime, cashDenomLabel } from "@/lib/format";
import CashDenomCounter from "@/components/CashDenomCounter";
import { CASH_DENOMINATIONS, sumCashCounts } from "@contracts/cash";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const DIFF_TOLERANCE = 1; // บาท

type HistoryStatusFilter = "all" | "open" | "closed";

type HistoryFilters = {
  q: string;
  status: HistoryStatusFilter;
  from: string;
  to: string;
};

type HistoryForm = {
  id?: number;
  staffId: string;
  staffName: string;
  openedAt: string;
  closedAt: string;
  totalLiters: string;
  totalAmount: string;
  totalMoneyMeter: string;
  posAmount: string;
  openingFloat: string;
  countedCash: string;
  transferAmount: string;
  expectedCash: string;
  note: string;
  readings: HistoryReadingForm[] | null;
};

type HistoryReadingForm = {
  nozzleId: number;
  label: string;
  productName: string;
  openMeter: number | string;
  closeMeter: string;
  openMoney: number | string;
  closeMoney: string;
  pricePerLiter: number;
};

const blankHistoryFilters: HistoryFilters = {
  q: "",
  status: "all",
  from: "",
  to: "",
};

function toDateTimeLocal(value: Date | string | number) {
  const date = new Date(value);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function newHistoryForm(readings: HistoryReadingForm[]): HistoryForm {
  const closedAt = new Date();
  const openedAt = new Date(closedAt.getTime() - 8 * 60 * 60 * 1000);
  return {
    staffId: "manual",
    staffName: "",
    openedAt: toDateTimeLocal(openedAt),
    closedAt: toDateTimeLocal(closedAt),
    totalLiters: "0",
    totalAmount: "0",
    totalMoneyMeter: "0",
    posAmount: "0",
    openingFloat: "0",
    countedCash: "",
    transferAmount: "",
    expectedCash: "",
    note: "",
    readings,
  };
}

function getHistoryReadingPreview(
  readings: HistoryReadingForm[] | null,
  countZeroOpeningMoney = false
) {
  if (!readings?.length) return null;
  let totalLiters = 0;
  let totalAmount = 0;
  let totalMoneyMeter = 0;
  let valid = true;
  for (const reading of readings) {
    if (
      reading.openMeter === "" ||
      reading.openMoney === "" ||
      reading.closeMeter === "" ||
      reading.closeMoney === ""
    ) {
      valid = false;
      continue;
    }
    const closeMeter = Number(reading.closeMeter);
    const closeMoney = Number(reading.closeMoney);
    const openMeter = Number(reading.openMeter);
    const openMoney = Number(reading.openMoney);
    const tracksMoney = countZeroOpeningMoney || openMoney > 0;
    if (
      !Number.isFinite(closeMeter) ||
      !Number.isFinite(closeMoney) ||
      !Number.isFinite(openMeter) ||
      !Number.isFinite(openMoney) ||
      closeMeter < openMeter ||
      (tracksMoney && closeMoney < openMoney)
    ) {
      valid = false;
      continue;
    }
    const liters = r3(closeMeter - openMeter);
    totalLiters = r3(totalLiters + liters);
    totalAmount = r2(totalAmount + liters * reading.pricePerLiter);
    if (tracksMoney) {
      totalMoneyMeter = r2(totalMoneyMeter + closeMoney - openMoney);
    }
  }
  return { totalLiters, totalAmount, totalMoneyMeter, valid };
}

function getHistoryTiming(openedAt?: string, closedAt?: string) {
  if (!openedAt || !closedAt) return { invalid: false, label: "" };
  const openedTime = new Date(openedAt).getTime();
  const closedTime = new Date(closedAt).getTime();
  if (
    !Number.isFinite(openedTime) ||
    !Number.isFinite(closedTime) ||
    closedTime <= openedTime
  ) {
    return { invalid: true, label: "" };
  }
  const minutes = Math.round((closedTime - openedTime) / 60000);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return {
    invalid: false,
    label: `${hours ? `${hours} ชม.` : ""}${
      remainingMinutes ? ` ${remainingMinutes} นาที` : ""
    }`.trim(),
  };
}

function HistoryMeterEditor({
  readings,
  preview,
  onChange,
  editableOpening = false,
}: {
  readings: HistoryReadingForm[];
  preview: {
    totalLiters: number;
    totalAmount: number;
    totalMoneyMeter: number;
    valid: boolean;
  };
  onChange: (readings: HistoryReadingForm[]) => void;
  editableOpening?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {readings.map((reading, index) => {
          const closeMeter = Number(reading.closeMeter);
          const closeMoney = Number(reading.closeMoney);
          const openMeter = Number(reading.openMeter);
          const openMoney = Number(reading.openMoney);
          const tracksMoney = editableOpening || openMoney > 0;
          const meterInvalid =
            reading.closeMeter !== "" && closeMeter < openMeter;
          const moneyInvalid =
            reading.closeMoney !== "" && tracksMoney && closeMoney < openMoney;
          const litersSold =
            reading.closeMeter !== "" && !meterInvalid
              ? r3(closeMeter - openMeter)
              : null;
          const meterSales =
            reading.closeMoney !== "" && tracksMoney && !moneyInvalid
              ? r2(closeMoney - openMoney)
              : null;
          const moneyInputId = "history-close-money-" + reading.nozzleId;
          const meterInputId = "history-close-meter-" + reading.nozzleId;
          return (
            <div
              key={reading.nozzleId}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/60"
            >
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3.5">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-200">
                    <Fuel className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-900">
                      {reading.label}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">
                      {reading.productName}
                    </div>
                  </div>
                </div>
                <Badge
                  variant="secondary"
                  className="shrink-0 whitespace-nowrap border border-blue-100 bg-blue-50 text-blue-700"
                >
                  ฿{fmtMoney(reading.pricePerLiter)}/ล.
                </Badge>
              </div>
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label
                      htmlFor={moneyInputId}
                      className="text-xs font-semibold text-slate-700"
                    >
                      {editableOpening ? "มิเตอร์ P" : "มิเตอร์ P ปิดกะ"}
                    </Label>
                    {!editableOpening && (
                      <span className="text-[11px] text-slate-400">
                        เริ่ม ฿{fmtNum(openMoney)}
                      </span>
                    )}
                  </div>
                  {editableOpening && (
                    <div className="space-y-1.5">
                      <Label
                        htmlFor={`history-open-money-${reading.nozzleId}`}
                        className="text-[11px] font-medium text-slate-500"
                      >
                        P ตั้งต้น
                      </Label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">
                          ฿
                        </span>
                        <Input
                          id={`history-open-money-${reading.nozzleId}`}
                          aria-label={reading.label + " P ตั้งต้น"}
                          type="number"
                          min="0"
                          step="0.01"
                          required
                          className="rounded-xl bg-slate-50 pl-8 font-medium tabular-nums"
                          value={String(reading.openMoney)}
                          onChange={event =>
                            onChange(
                              readings.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      openMoney: event.target.value,
                                    }
                                  : item
                              )
                            )
                          }
                        />
                      </div>
                    </div>
                  )}
                  <Label
                    htmlFor={moneyInputId}
                    className={
                      editableOpening
                        ? "text-[11px] font-medium text-slate-500"
                        : "sr-only"
                    }
                  >
                    P ปิดกะ
                  </Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">
                      ฿
                    </span>
                    <Input
                      id={moneyInputId}
                      aria-label={reading.label + " P ปิดกะ"}
                      aria-invalid={moneyInvalid}
                      type="number"
                      min={openMoney}
                      step="0.01"
                      required
                      className="rounded-xl bg-white pl-8 font-medium tabular-nums"
                      placeholder="0.00"
                      value={reading.closeMoney}
                      onChange={event =>
                        onChange(
                          readings.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, closeMoney: event.target.value }
                              : item
                          )
                        )
                      }
                    />
                  </div>
                  {meterSales != null && (
                    <p className="text-[11px] font-medium text-emerald-600">
                      ยอดขายจาก P +฿{fmtMoney(meterSales)}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label
                      htmlFor={meterInputId}
                      className="text-xs font-semibold text-slate-700"
                    >
                      {editableOpening ? "มิเตอร์ L" : "มิเตอร์ L ปิดกะ"}
                    </Label>
                    {!editableOpening && (
                      <span className="text-[11px] text-slate-400">
                        เริ่ม {fmtNum(openMeter)}
                      </span>
                    )}
                  </div>
                  {editableOpening && (
                    <div className="space-y-1.5">
                      <Label
                        htmlFor={`history-open-meter-${reading.nozzleId}`}
                        className="text-[11px] font-medium text-slate-500"
                      >
                        L ตั้งต้น
                      </Label>
                      <div className="relative">
                        <Input
                          id={`history-open-meter-${reading.nozzleId}`}
                          aria-label={reading.label + " L ตั้งต้น"}
                          type="number"
                          min="0"
                          step="0.001"
                          required
                          className="rounded-xl bg-slate-50 pr-12 font-medium tabular-nums"
                          value={String(reading.openMeter)}
                          onChange={event =>
                            onChange(
                              readings.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      openMeter: event.target.value,
                                    }
                                  : item
                              )
                            )
                          }
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                          ลิตร
                        </span>
                      </div>
                    </div>
                  )}
                  <Label
                    htmlFor={meterInputId}
                    className={
                      editableOpening
                        ? "text-[11px] font-medium text-slate-500"
                        : "sr-only"
                    }
                  >
                    L ปิดกะ
                  </Label>
                  <div className="relative">
                    <Input
                      id={meterInputId}
                      aria-label={reading.label + " L ปิดกะ"}
                      aria-invalid={meterInvalid}
                      type="number"
                      min={openMeter}
                      step="0.001"
                      required
                      className="rounded-xl bg-white pr-12 font-medium tabular-nums"
                      placeholder="0.000"
                      value={reading.closeMeter}
                      onChange={event =>
                        onChange(
                          readings.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, closeMeter: event.target.value }
                              : item
                          )
                        )
                      }
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                      ลิตร
                    </span>
                  </div>
                  {litersSold != null && (
                    <p className="text-[11px] font-medium text-blue-600">
                      ปริมาณขาย +{fmtNum(litersSold)} ลิตร
                    </p>
                  )}
                </div>
                {(meterInvalid || moneyInvalid) && (
                  <p className="sm:col-span-2 flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    เลขปิดกะต้องไม่น้อยกว่าเลขตั้งต้น
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid overflow-hidden rounded-2xl border border-blue-100 bg-blue-50/70 sm:grid-cols-3">
        <div className="flex items-center gap-3 border-b border-blue-100 px-4 py-3 sm:border-b-0 sm:border-r">
          <div className="flex size-9 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm">
            <Gauge className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-blue-600">รวมปริมาณ</p>
            <p className="font-heading text-lg font-bold text-slate-900">
              {fmtNum(preview.totalLiters)}{" "}
              <span className="text-xs">ลิตร</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 border-b border-blue-100 px-4 py-3 sm:border-b-0 sm:border-r">
          <div className="flex size-9 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm">
            <Fuel className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-blue-600">ยอดจากลิตร</p>
            <p className="font-heading text-lg font-bold text-slate-900">
              ฿{fmtMoney(preview.totalAmount)}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm">
              <Banknote className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-blue-600">ยอดจาก P</p>
              <p className="font-heading text-lg font-bold text-slate-900">
                ฿{fmtMoney(preview.totalMoneyMeter)}
              </p>
            </div>
          </div>
          {preview.valid && preview.totalMoneyMeter > 0 && (
            <DiffBadge
              diff={r2(preview.totalMoneyMeter - preview.totalAmount)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryMetricInput({
  field,
  label,
  value,
  onChange,
  unit = "money",
  optional = false,
}: {
  field: keyof Pick<
    HistoryForm,
    | "totalLiters"
    | "totalAmount"
    | "totalMoneyMeter"
    | "posAmount"
    | "openingFloat"
    | "expectedCash"
    | "countedCash"
    | "transferAmount"
  >;
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit?: "money" | "liters";
  optional?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label
          htmlFor={`history-${field}`}
          className="text-xs font-semibold text-slate-700"
        >
          {label}
        </Label>
        {optional && (
          <span className="text-[10px] font-medium text-slate-400">
            ไม่บังคับ
          </span>
        )}
      </div>
      <div className="relative">
        {unit === "money" && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">
            ฿
          </span>
        )}
        <Input
          id={`history-${field}`}
          type="number"
          min="0"
          step={unit === "liters" ? "0.001" : "0.01"}
          required={!optional}
          placeholder={unit === "liters" ? "0.000" : "0.00"}
          className={`rounded-xl bg-white font-medium tabular-nums ${
            unit === "money" ? "pl-8" : "pr-12"
          }`}
          value={value}
          onChange={event => onChange(event.target.value)}
        />
        {unit === "liters" && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
            ลิตร
          </span>
        )}
      </div>
    </div>
  );
}

function DiffBadge({ diff }: { diff: number | null }) {
  if (diff == null) return null;
  const ok = Math.abs(diff) <= DIFF_TOLERANCE;
  if (ok) {
    return (
      <Badge className="bg-green-600 hover:bg-green-600 gap-1">
        <CheckCircle2 className="w-3 h-3" /> ตรงกัน
      </Badge>
    );
  }
  // บวก = เงินเกิน (เขียว) / ลบ = เงินขาด (แดง)
  if (diff > 0) {
    return (
      <Badge className="bg-green-600 hover:bg-green-600 gap-1">
        <AlertTriangle className="w-3 h-3" /> ต่าง +{fmtMoney(diff)}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <AlertTriangle className="w-3 h-3" /> ต่าง {fmtMoney(diff)}
    </Badge>
  );
}

function MeterDiffBadge({
  diff,
  priceChangedDuringShift,
}: {
  diff: number | null;
  priceChangedDuringShift: boolean;
}) {
  if (priceChangedDuringShift) {
    return (
      <Badge className="bg-amber-500 hover:bg-amber-500 gap-1 text-white">
        <AlertTriangle className="w-3 h-3" /> เปลี่ยนราคาในกะ
      </Badge>
    );
  }
  return <DiffBadge diff={diff} />;
}

export default function Shifts() {
  const { staff } = useStaff();
  const isAdmin = staff?.role === "admin";
  const utils = trpc.useUtils();
  const { data: currentShift, isLoading } = trpc.pos.currentShift.useQuery();
  const { data: pumps } = trpc.catalog.listPumps.useQuery();
  const { data: publicHistory } = trpc.pos.shiftHistory.useQuery(undefined, {
    enabled: !isAdmin,
  });

  const [openVals, setOpenVals] = useState<
    Record<number, { l?: string; p?: string }>
  >({});
  const [closeVals, setCloseVals] = useState<
    Record<number, { l?: string; p?: string }>
  >({});
  const [floatVal, setFloatVal] = useState(""); // เงินทอนเริ่มกะ
  const [cashCounts, setCashCounts] = useState<Record<string, string>>({}); // การนับแบงก์/เหรียญตอนปิดกะ
  const [transferVal, setTransferVal] = useState(""); // ยอดเงินที่ลูกค้าโอน
  const [detailId, setDetailId] = useState<number | null>(null);
  const [historyFilters, setHistoryFilters] =
    useState<HistoryFilters>(blankHistoryFilters);
  const [appliedHistoryFilters, setAppliedHistoryFilters] =
    useState<HistoryFilters>(blankHistoryFilters);
  const [historyForm, setHistoryForm] = useState<HistoryForm | null>(null);
  const [notice, setNotice] = useState("");
  const [err, setErr] = useState("");

  const adminHistoryInput = useMemo(
    () => ({
      q: appliedHistoryFilters.q.trim() || undefined,
      status:
        appliedHistoryFilters.status === "all"
          ? undefined
          : appliedHistoryFilters.status,
      from: appliedHistoryFilters.from || undefined,
      to: appliedHistoryFilters.to || undefined,
      limit: 200,
    }),
    [appliedHistoryFilters]
  );
  const { data: adminHistory } = trpc.pos.searchShiftHistory.useQuery(
    adminHistoryInput,
    { enabled: isAdmin }
  );
  const { data: staffUsers = [] } = trpc.auth.listStaff.useQuery(undefined, {
    enabled: isAdmin,
  });
  const history = isAdmin ? adminHistory : publicHistory;

  const { data: detail } = trpc.pos.shiftDetail.useQuery(
    { id: detailId! },
    { enabled: detailId != null }
  );
  const { data: editHistoryDetail, isLoading: editHistoryDetailLoading } =
    trpc.pos.shiftDetail.useQuery(
      { id: historyForm?.id ?? 0 },
      { enabled: isAdmin && historyForm?.id != null }
    );
  const historyReadings =
    historyForm?.readings ??
    (historyForm?.id && editHistoryDetail?.id === historyForm.id
      ? editHistoryDetail.readings.map(reading => ({
          nozzleId: reading.nozzleId,
          label: reading.nozzle?.label ?? `หัวจ่าย #${reading.nozzleId}`,
          productName: reading.product?.name ?? "ไม่ทราบชนิดน้ำมัน",
          openMeter: reading.openMeter,
          closeMeter:
            reading.closeMeter == null ? "" : String(reading.closeMeter),
          openMoney: reading.openMoney,
          closeMoney:
            reading.closeMoney == null ? "" : String(reading.closeMoney),
          pricePerLiter: reading.pricePerLiter,
        }))
      : null);

  const invalidate = () => {
    utils.pos.currentShift.invalidate();
    utils.pos.shiftHistory.invalidate();
    utils.pos.searchShiftHistory.invalidate();
    utils.pos.shiftDetail.invalidate();
    utils.pos.dashboard.invalidate();
    utils.catalog.listPumps.invalidate();
    utils.catalog.listTanks.invalidate();
  };

  const openShift = trpc.pos.openShift.useMutation({
    onSuccess: () => {
      invalidate();
      setErr("");
      setOpenVals({});
      setFloatVal("");
    },
    onError: e => setErr(e.message),
  });
  const closeShift = trpc.pos.closeShift.useMutation({
    onSuccess: () => {
      invalidate();
      setCloseVals({});
      setCashCounts({});
      setTransferVal("");
      setErr("");
    },
    onError: e => setErr(e.message),
  });
  const createShiftHistory = trpc.pos.createShiftHistory.useMutation({
    onSuccess: () => {
      invalidate();
      setHistoryForm(null);
      setErr("");
      setNotice("เพิ่มประวัติการตัดกะแล้ว");
    },
    onError: e => setErr(e.message),
  });
  const updateShiftHistory = trpc.pos.updateShiftHistory.useMutation({
    onSuccess: () => {
      invalidate();
      setHistoryForm(null);
      setErr("");
      setNotice("แก้ไขประวัติการตัดกะแล้ว");
    },
    onError: e => setErr(e.message),
  });
  const deleteShiftHistory = trpc.pos.deleteShiftHistory.useMutation({
    onSuccess: () => {
      invalidate();
      setDetailId(null);
      setErr("");
      setNotice("ลบประวัติการตัดกะแล้ว");
    },
    onError: e => setErr(e.message),
  });

  const submitHistoryForm = () => {
    if (!historyForm) return;
    const previewTotals =
      historyForm.readings?.length && historyReadingPreview
        ? historyReadingPreview
        : null;
    const values = {
      staffId:
        historyForm.staffId === "manual" ? null : Number(historyForm.staffId),
      staffName: historyForm.staffName,
      openedAt: new Date(historyForm.openedAt),
      closedAt: new Date(historyForm.closedAt),
      totalLiters:
        previewTotals?.totalLiters ?? Number(historyForm.totalLiters),
      totalAmount:
        previewTotals?.totalAmount ?? Number(historyForm.totalAmount),
      totalMoneyMeter:
        previewTotals?.totalMoneyMeter ?? Number(historyForm.totalMoneyMeter),
      posAmount: Number(historyForm.posAmount),
      openingFloat: Number(historyForm.openingFloat),
      countedCash:
        historyForm.countedCash === "" ? null : Number(historyForm.countedCash),
      transferAmount:
        historyForm.transferAmount === ""
          ? null
          : Number(historyForm.transferAmount),
      expectedCash:
        historyForm.expectedCash === ""
          ? null
          : Number(historyForm.expectedCash),
      note: historyForm.note.trim() || null,
    };
    if (historyForm.id) {
      updateShiftHistory.mutate({
        id: historyForm.id,
        ...values,
        ...(historyForm.readings && historyForm.readings.length > 0
          ? {
              readings: historyForm.readings.map(reading => ({
                nozzleId: reading.nozzleId,
                closeMeter: Number(reading.closeMeter),
                closeMoney: Number(reading.closeMoney),
              })),
            }
          : {}),
      });
    } else {
      createShiftHistory.mutate({
        ...values,
        readings: historyForm.readings?.map(reading => ({
          nozzleId: reading.nozzleId,
          openMeter: Number(reading.openMeter),
          closeMeter: Number(reading.closeMeter),
          openMoney: Number(reading.openMoney),
          closeMoney: Number(reading.closeMoney),
        })),
      });
    }
  };

  const nozzleList = useMemo(
    () =>
      (pumps ?? []).flatMap(p =>
        p.nozzles.filter(n => n.active).map(n => ({ ...n, pumpName: p.name }))
      ),
    [pumps]
  );

  const historyReadingPreview = getHistoryReadingPreview(
    historyReadings,
    historyForm?.id == null
  );
  const historyTiming = getHistoryTiming(
    historyForm?.openedAt,
    historyForm?.closedAt
  );

  // พรีวิวยอดปิดกะ
  const closePreview = useMemo(() => {
    if (!currentShift) return null;
    let liters = 0,
      amountL = 0,
      money = 0;
    let filled = true;
    for (const r of currentShift.readings) {
      const cl = Number(closeVals[r.nozzleId]?.l);
      const cp = Number(closeVals[r.nozzleId]?.p);
      if (!closeVals[r.nozzleId]?.l || !closeVals[r.nozzleId]?.p)
        filled = false;
      if (cl && cl >= r.openMeter) {
        liters += cl - r.openMeter;
        amountL += (cl - r.openMeter) * r.pricePerLiter;
      }
      if (cp && cp >= r.openMoney) money += cp - r.openMoney;
    }
    return {
      liters: r3(liters),
      amountL: r2(amountL),
      money: r2(money),
      diff: r2(money - amountL),
      filled,
    };
  }, [closeVals, currentShift]);

  // ยอดเงินสดที่นับได้จากการนับแบงก์/เหรียญ (realtime)
  const countedTotal = useMemo(() => {
    const numeric: Record<string, number> = {};
    for (const [k, v] of Object.entries(cashCounts))
      numeric[k] = Number(v) || 0;
    return sumCashCounts(numeric);
  }, [cashCounts]);
  const hasCounts = Object.values(cashCounts).some(v => Number(v) > 0);
  const hasPriceChangeDuringShift =
    currentShift?.readings.some(r => r.priceChangedDuringShift) ?? false;
  const detailHasPriceChange =
    detail?.readings.some(r => r.priceChangedDuringShift) ?? false;

  if (isLoading)
    return (
      <div className="py-20 text-center text-muted-foreground">
        กำลังโหลด...
      </div>
    );

  return (
    <div className="space-y-5">
      <h1 className="page-heading">ตัดกะ</h1>

      {err && (
        <Card className="border-destructive bg-red-50">
          <CardContent className="py-3 px-4 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {err}
          </CardContent>
        </Card>
      )}
      {notice && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="flex items-center gap-2 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> {notice}
          </CardContent>
        </Card>
      )}

      {/* ============ เปิดกะ ============ */}
      {!currentShift && (
        <Card>
          <CardHeader>
            <CardTitle className="font-heading flex items-center gap-2">
              <PlayCircle className="w-5 h-5 text-green-600" /> เปิดกะใหม่ —
              บันทึกมิเตอร์ตั้งต้น (L และ P)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              พนักงาน: <b>{staff?.name}</b> · ระบบดึงเลขมิเตอร์ล่าสุดมาให้แล้ว
              ตรวจสอบหน้าตู้จ่ายอีกครั้งก่อนกดเปิดกะ (<b>L</b> = ลิตรสะสม,{" "}
              <b>P</b> = ยอดเงินสะสม บาท)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {nozzleList.map(n => (
                <div key={n.id} className="border rounded-xl p-3 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-sm">{n.label}</span>
                    <Badge variant="secondary">{n.product?.name}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-24">
                      P ตั้งต้น (บาท)
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      value={openVals[n.id]?.p ?? String(n.currentMoney)}
                      onChange={e =>
                        setOpenVals(m => ({
                          ...m,
                          [n.id]: { ...m[n.id], p: e.target.value },
                        }))
                      }
                      className="h-9"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-24">
                      L ตั้งต้น (ลิตร)
                    </span>
                    <Input
                      type="number"
                      step="0.001"
                      value={openVals[n.id]?.l ?? String(n.currentMeter)}
                      onChange={e =>
                        setOpenVals(m => ({
                          ...m,
                          [n.id]: { ...m[n.id], l: e.target.value },
                        }))
                      }
                      className="h-9"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex max-w-md flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:gap-3">
              <span className="text-sm font-medium sm:whitespace-nowrap">
                เงินทอนเริ่มกะ (บาท)
              </span>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={floatVal}
                onChange={e => setFloatVal(e.target.value)}
                className="h-9"
              />
            </div>
            <Button
              className="w-full sm:w-auto h-11"
              disabled={openShift.isPending || nozzleList.length === 0}
              onClick={() =>
                openShift.mutate({
                  staffId: staff?.id,
                  staffName: staff?.name ?? "",
                  openingFloat: Number(floatVal) || 0,
                  readings: nozzleList.map(n => ({
                    nozzleId: n.id,
                    openMeter: Number(openVals[n.id]?.l ?? n.currentMeter),
                    openMoney: Number(openVals[n.id]?.p ?? n.currentMoney),
                  })),
                })
              }
            >
              <PlayCircle className="w-5 h-5 mr-2" /> เปิดกะ
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ============ ปิดกะ ============ */}
      {currentShift && (
        <Card className="border-green-300">
          <CardHeader>
            <CardTitle className="font-heading flex items-center gap-2 flex-wrap">
              <StopCircle className="w-5 h-5 text-destructive" /> ปิดกะ —
              บันทึกมิเตอร์ปลายทาง (L และ P)
              <Badge className="bg-green-600 hover:bg-green-600">
                <Clock className="w-3 h-3 mr-1" /> เปิดโดย{" "}
                {currentShift.staffName} เมื่อ{" "}
                {fmtDateTime(currentShift.openedAt)}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasPriceChangeDuringShift && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <b>พบการเปลี่ยนราคาน้ำมันหลังเปิดกะ</b> ยอด “ลิตร ×
                  ราคาเปิดกะ”
                  จึงเป็นเพียงค่าประมาณและไม่ควรตีความส่วนต่างเป็นเงินขาดทันที
                  ให้ตรวจเลขมิเตอร์ P/L ที่หน้าตู้เป็นหลัก โดยใช้มิเตอร์ P
                  เป็นยอดเงินจริงและมิเตอร์ L เป็นจำนวนลิตรที่ขาย
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {currentShift.readings.map(r => {
                const cl = Number(closeVals[r.nozzleId]?.l);
                const cp = Number(closeVals[r.nozzleId]?.p);
                const liters =
                  cl && cl >= r.openMeter ? r3(cl - r.openMeter) : null;
                const money =
                  cp && cp >= r.openMoney ? r2(cp - r.openMoney) : null;
                const amountL =
                  liters != null ? r2(liters * r.pricePerLiter) : null;
                const diff =
                  money != null && amountL != null ? r2(money - amountL) : null;
                const effectivePrice =
                  liters != null && liters > 0 && money != null
                    ? r2(money / liters)
                    : null;
                return (
                  <div
                    key={r.nozzleId}
                    className="border rounded-xl p-3 space-y-2"
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-sm">
                        {r.nozzle?.label}
                      </span>
                      {r.priceChangedDuringShift ? (
                        <Badge className="border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-50">
                          ฿{fmtMoney(r.pricePerLiter)} → ฿
                          {fmtMoney(r.currentPrice)}/ล.
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          ฿{fmtMoney(r.pricePerLiter)}/ล.
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {r.openMoney > 0 ? (
                        <span>
                          P ตั้งต้น:{" "}
                          <b className="text-foreground">
                            ฿{fmtNum(r.openMoney)}
                          </b>
                        </span>
                      ) : (
                        <span className="text-amber-600">
                          P ตั้งต้น: ไม่มี (กะเก่า)
                        </span>
                      )}
                      <span>
                        L ตั้งต้น:{" "}
                        <b className="text-foreground">{fmtNum(r.openMeter)}</b>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-24">
                        P ปิดกะ (บาท)
                      </span>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="เลขเงินปลายทาง"
                        value={closeVals[r.nozzleId]?.p ?? ""}
                        onChange={e =>
                          setCloseVals(m => ({
                            ...m,
                            [r.nozzleId]: {
                              ...m[r.nozzleId],
                              p: e.target.value,
                            },
                          }))
                        }
                        className="h-9"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-24">
                        L ปิดกะ (ลิตร)
                      </span>
                      <Input
                        type="number"
                        step="0.001"
                        placeholder="เลขลิตรปลายทาง"
                        value={closeVals[r.nozzleId]?.l ?? ""}
                        onChange={e =>
                          setCloseVals(m => ({
                            ...m,
                            [r.nozzleId]: {
                              ...m[r.nozzleId],
                              l: e.target.value,
                            },
                          }))
                        }
                        className="h-9"
                      />
                    </div>
                    {liters != null && (
                      <div
                        className={`text-xs rounded-lg px-2 py-1.5 flex flex-wrap justify-between gap-1 ${
                          r.priceChangedDuringShift
                            ? "bg-amber-50"
                            : "bg-blue-50"
                        }`}
                      >
                        <span>
                          ขาย <b>{fmtNum(liters)} ล.</b>
                        </span>
                        <span>
                          {r.priceChangedDuringShift
                            ? "คาดจากราคาเปิดกะ"
                            : "จากลิตร"}
                          : <b>฿{fmtMoney(amountL ?? 0)}</b>
                        </span>
                        {money != null && (
                          <span>
                            จาก P: <b>฿{fmtMoney(money)}</b>
                          </span>
                        )}
                        {r.priceChangedDuringShift &&
                          effectivePrice != null && (
                            <span>
                              ราคาเฉลี่ยจาก P:{" "}
                              <b>฿{fmtMoney(effectivePrice)}/ล.</b>
                            </span>
                          )}
                        <MeterDiffBadge
                          diff={diff}
                          priceChangedDuringShift={r.priceChangedDuringShift}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* สรุปเงินสดที่ควรมี (คำนวณจากยอดขาย/ค่าใช้จ่ายจริงในกะ) */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-wrap items-center gap-x-5 gap-y-2">
              <div>
                <div className="text-xs text-muted-foreground">
                  เงินทอน ฿{fmtMoney(currentShift.cash.openingFloat)}
                  {" + "}ขายเงินสด ฿{fmtMoney(currentShift.cash.cashSales)}
                  {" + "}ชำระหนี้เงินสด ฿
                  {fmtMoney(currentShift.cash.cashDebtPayments)}
                  {" − "}ค่าใช้จ่าย ฿{fmtMoney(currentShift.cash.expensesTotal)}
                </div>
                <div className="font-heading text-xl font-semibold text-amber-700">
                  ควรมี ฿{fmtMoney(currentShift.cash.expectedCash)}
                </div>
              </div>
              {hasCounts && (
                <div className="flex items-center gap-2">
                  <span className="text-sm">
                    นับได้ <b>฿{fmtMoney(countedTotal)}</b>
                  </span>
                  <DiffBadge
                    diff={r2(countedTotal - currentShift.cash.expectedCash)}
                  />
                </div>
              )}
            </div>

            {/* นับเงินสดแยกแบงก์/เหรียญ + ยอดเงินโอน */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="border rounded-xl p-3 space-y-2 sm:w-fit">
                <div className="font-medium text-sm">
                  นับเงินสดในลิ้นชัก (แยกแบงก์/เหรียญ)
                </div>
                <CashDenomCounter value={cashCounts} onChange={setCashCounts} />
              </div>
              <div className="border rounded-xl p-3 space-y-2 self-start">
                <div className="font-medium text-sm">
                  ยอดเงินที่ลูกค้าโอน (บาท)
                </div>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="ยอดโอนเข้าบัญชีร้าน"
                  value={transferVal}
                  onChange={e => setTransferVal(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>

            {closePreview && closePreview.filled && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
                <div>
                  <div className="text-xs text-muted-foreground">
                    รวมลิตรที่ขาย
                  </div>
                  <div className="font-heading text-xl font-semibold">
                    {fmtNum(closePreview.liters)} ลิตร
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    ยอดจากลิตร ×{" "}
                    {hasPriceChangeDuringShift ? "ราคาเปิดกะ (ประมาณ)" : "ราคา"}
                  </div>
                  <div className="font-heading text-xl font-semibold text-primary">
                    ฿{fmtMoney(closePreview.amountL)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    ยอดจากมิเตอร์เงิน (P)
                  </div>
                  <div className="font-heading text-xl font-semibold text-indigo-600">
                    ฿{fmtMoney(closePreview.money)}
                  </div>
                </div>
                {(hasCounts || transferVal) && (
                  <div>
                    <div className="text-xs text-muted-foreground">
                      รวมเงินที่นับได้ (สด + โอน)
                    </div>
                    <div className="font-heading text-xl font-semibold text-green-700">
                      ฿{fmtMoney(r2(countedTotal + (Number(transferVal) || 0)))}
                    </div>
                  </div>
                )}
                <div className="ml-auto">
                  <MeterDiffBadge
                    diff={closePreview.diff}
                    priceChangedDuringShift={hasPriceChangeDuringShift}
                  />
                </div>
              </div>
            )}

            <Button
              variant="destructive"
              className="w-full sm:w-auto h-11"
              disabled={closeShift.isPending || !closePreview?.filled}
              onClick={() => {
                // ส่งเฉพาะช่องที่กรอกจริง (จำนวน > 0) — ถ้าไม่ได้นับเลยไม่ส่ง cashCounts (บันทึกเป็น null เหมือนเดิม)
                const countsPayload = hasCounts
                  ? Object.fromEntries(
                      Object.entries(cashCounts)
                        .map(([k, v]) => [k, Number(v)] as const)
                        .filter(([, n]) => n > 0)
                    )
                  : undefined;
                closeShift.mutate({
                  shiftId: currentShift.id,
                  readings: currentShift.readings.map(r => ({
                    nozzleId: r.nozzleId,
                    closeMeter: Number(closeVals[r.nozzleId]?.l),
                    closeMoney: Number(closeVals[r.nozzleId]?.p),
                  })),
                  ...(countsPayload ? { cashCounts: countsPayload } : {}),
                  ...(transferVal
                    ? { transferAmount: Number(transferVal) }
                    : {}),
                });
              }}
            >
              <StopCircle className="w-5 h-5 mr-2" /> ยืนยันปิดกะ
              (หักถังอัตโนมัติ)
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ============ ประวัติ ============ */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="font-heading text-base">
            ประวัติการตัดกะ
          </CardTitle>
          {isAdmin && (
            <Button
              disabled={!pumps}
              onClick={() => {
                setNotice("");
                setErr("");
                if (nozzleList.length === 0) {
                  setErr("ไม่พบหัวจ่ายที่เปิดใช้งาน กรุณาตั้งค่าหัวจ่ายก่อน");
                  return;
                }
                setHistoryForm(
                  newHistoryForm(
                    nozzleList.map(nozzle => ({
                      nozzleId: nozzle.id,
                      label: nozzle.label,
                      productName: nozzle.product?.name ?? "ไม่ทราบชนิดน้ำมัน",
                      openMeter: String(nozzle.currentMeter),
                      closeMeter: "",
                      openMoney: String(nozzle.currentMoney),
                      closeMoney: "",
                      pricePerLiter: nozzle.product?.price ?? 0,
                    }))
                  )
                );
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> เพิ่มประวัติ
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin && (
            <form
              className="grid gap-3 rounded-xl border bg-muted/30 p-3 md:grid-cols-[minmax(180px,1fr)_160px_150px_150px_auto_auto]"
              onSubmit={event => {
                event.preventDefault();
                setAppliedHistoryFilters(historyFilters);
              }}
            >
              <Input
                aria-label="ค้นหาประวัติการตัดกะ"
                placeholder="ค้นหาชื่อพนักงาน เลขกะ หรือหมายเหตุ"
                value={historyFilters.q}
                onChange={event =>
                  setHistoryFilters({
                    ...historyFilters,
                    q: event.target.value,
                  })
                }
              />
              <Select
                value={historyFilters.status}
                onValueChange={(status: HistoryStatusFilter) =>
                  setHistoryFilters({ ...historyFilters, status })
                }
              >
                <SelectTrigger aria-label="สถานะกะ">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ทุกสถานะ</SelectItem>
                  <SelectItem value="closed">ปิดแล้ว</SelectItem>
                  <SelectItem value="open">เปิดอยู่</SelectItem>
                </SelectContent>
              </Select>
              <Input
                aria-label="ตั้งแต่วันที่"
                type="date"
                value={historyFilters.from}
                onChange={event =>
                  setHistoryFilters({
                    ...historyFilters,
                    from: event.target.value,
                  })
                }
              />
              <Input
                aria-label="ถึงวันที่"
                type="date"
                value={historyFilters.to}
                onChange={event =>
                  setHistoryFilters({
                    ...historyFilters,
                    to: event.target.value,
                  })
                }
              />
              <Button type="submit" variant="outline">
                <Search className="mr-2 h-4 w-4" /> ค้นหา
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setHistoryFilters(blankHistoryFilters);
                  setAppliedHistoryFilters(blankHistoryFilters);
                }}
              >
                ล้าง
              </Button>
            </form>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>เปิดกะ</TableHead>
                  <TableHead>พนักงาน</TableHead>
                  <TableHead className="text-right">ยอดจาก P</TableHead>
                  <TableHead className="text-right">ยอดจากลิตร</TableHead>
                  <TableHead className="text-right">ลิตร</TableHead>
                  <TableHead>เทียบ</TableHead>
                  <TableHead className="text-right">ยอด POS</TableHead>
                  <TableHead className="text-right">เงินทอน</TableHead>
                  <TableHead className="text-right">เงินสดนับได้</TableHead>
                  <TableHead>เงินสดต่าง</TableHead>
                  <TableHead className="text-right">ยอดโอน</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history ?? []).map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap">
                      {fmtDateTime(s.openedAt)}
                    </TableCell>
                    <TableCell>{s.staffName}</TableCell>
                    <TableCell className="text-right">
                      ฿{fmtMoney(s.totalMoneyMeter)}
                    </TableCell>
                    <TableCell className="text-right">
                      ฿{fmtMoney(s.totalAmount)}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtNum(s.totalLiters)}
                    </TableCell>
                    <TableCell>
                      {(s.priceChangedDuringShift ||
                        (s.status === "closed" && s.totalMoneyMeter > 0)) && (
                        <MeterDiffBadge
                          diff={r2(s.totalMoneyMeter - s.totalAmount)}
                          priceChangedDuringShift={
                            s.priceChangedDuringShift
                          }
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      ฿{fmtMoney(s.posAmount)}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.openingFloat > 0
                        ? `฿${fmtMoney(s.openingFloat)}`
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.countedCash != null
                        ? `฿${fmtMoney(s.countedCash)}`
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {s.countedCash != null && s.expectedCash != null ? (
                        <DiffBadge diff={r2(s.countedCash - s.expectedCash)} />
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.transferAmount != null
                        ? `฿${fmtMoney(s.transferAmount)}`
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {s.status === "open" ? (
                        <Badge className="bg-green-600 hover:bg-green-600">
                          เปิดอยู่
                        </Badge>
                      ) : (
                        <Badge variant="secondary">ปิดแล้ว</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          title="ดูรายละเอียด"
                          onClick={() => setDetailId(s.id)}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {isAdmin && s.status === "closed" && s.closedAt && (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              title="แก้ไขประวัติ"
                              onClick={() => {
                                setNotice("");
                                setErr("");
                                setHistoryForm({
                                  id: s.id,
                                  staffId: s.staffId
                                    ? String(s.staffId)
                                    : "manual",
                                  staffName: s.staffName,
                                  openedAt: toDateTimeLocal(s.openedAt),
                                  closedAt: toDateTimeLocal(s.closedAt!),
                                  totalLiters: String(s.totalLiters),
                                  totalAmount: String(s.totalAmount),
                                  totalMoneyMeter: String(s.totalMoneyMeter),
                                  posAmount: String(s.posAmount),
                                  openingFloat: String(s.openingFloat),
                                  countedCash:
                                    s.countedCash == null
                                      ? ""
                                      : String(s.countedCash),
                                  transferAmount:
                                    s.transferAmount == null
                                      ? ""
                                      : String(s.transferAmount),
                                  expectedCash:
                                    s.expectedCash == null
                                      ? ""
                                      : String(s.expectedCash),
                                  note: s.note ?? "",
                                  readings: null,
                                });
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              title="ลบประวัติ"
                              disabled={deleteShiftHistory.isPending}
                              onClick={() => {
                                if (
                                  confirm(
                                    `ลบประวัติกะ #${s.id} ของ ${s.staffName}?\n\nรายการขาย รับชำระ และค่าใช้จ่ายจะยังอยู่ แต่จะไม่ผูกกับกะนี้`
                                  )
                                ) {
                                  deleteShiftHistory.mutate({ id: s.id });
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(history ?? []).length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={13}
                      className="text-center text-muted-foreground py-8"
                    >
                      ยังไม่มีประวัติ
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* เพิ่ม/แก้ไขประวัติตัดกะ — admin เท่านั้น */}
      <Dialog
        open={isAdmin && historyForm != null}
        onOpenChange={open => !open && setHistoryForm(null)}
      >
        <DialogContent className="h-[min(94dvh,860px)] max-h-[calc(100dvh-0.5rem)] gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-5xl sm:rounded-2xl [&_[data-slot=dialog-close]]:right-5 [&_[data-slot=dialog-close]]:top-5 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-16 text-left text-white sm:px-7 sm:py-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-48 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-24 left-1/3 size-48 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <ClipboardPenLine className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    Shift history
                  </span>
                  <Badge className="h-5 border border-white/15 bg-white/10 px-2 text-[10px] text-white shadow-none hover:bg-white/10">
                    {historyForm?.id ? "โหมดแก้ไข" : "รายการใหม่"}
                  </Badge>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white sm:text-2xl">
                  {historyForm?.id
                    ? `แก้ไขประวัติกะ #${historyForm.id}`
                    : "เพิ่มประวัติการตัดกะ"}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  {historyForm?.id
                    ? "ตรวจสอบและแก้ไขข้อมูลกะให้ครบถ้วนก่อนบันทึก"
                    : "บันทึกข้อมูลกะย้อนหลัง โดยไม่กระทบมิเตอร์และสต๊อกปัจจุบัน"}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {historyForm && (
            <form
              data-testid="shift-history-form"
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              onSubmit={event => {
                event.preventDefault();
                submitHistoryForm();
              }}
            >
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-slate-50/80 p-4 sm:p-6">
                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3.5 sm:px-5">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                        <UserRound className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">
                          ผู้รับผิดชอบและช่วงเวลากะ
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          ระบุพนักงาน พร้อมเวลาเปิดและปิดกะ
                        </p>
                      </div>
                    </div>
                    {historyTiming.label && !historyTiming.invalid && (
                      <Badge
                        variant="secondary"
                        className="hidden gap-1.5 bg-white text-slate-600 shadow-sm sm:flex"
                      >
                        <Clock className="h-3.5 w-3.5 text-blue-600" />
                        {historyTiming.label}
                      </Badge>
                    )}
                  </div>
                  <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
                    <div className="space-y-2">
                      <Label
                        htmlFor="history-staff"
                        className="text-xs font-semibold text-slate-700"
                      >
                        เลือกพนักงาน
                      </Label>
                      <Select
                        value={historyForm.staffId}
                        onValueChange={value => {
                          const selected = staffUsers.find(
                            person => String(person.id) === value
                          );
                          setHistoryForm({
                            ...historyForm,
                            staffId: value,
                            staffName: selected?.name ?? historyForm.staffName,
                          });
                        }}
                      >
                        <SelectTrigger
                          id="history-staff"
                          className="h-11 w-full rounded-xl bg-white"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="manual">กรอกชื่อเอง</SelectItem>
                          {staffUsers.map(person => (
                            <SelectItem
                              key={person.id}
                              value={String(person.id)}
                            >
                              {person.name}
                              {!person.active ? " (ปิดใช้งาน)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label
                        htmlFor="history-staff-name"
                        className="text-xs font-semibold text-slate-700"
                      >
                        ชื่อพนักงานในกะ
                      </Label>
                      <Input
                        id="history-staff-name"
                        required
                        className="rounded-xl bg-white"
                        placeholder="ระบุชื่อพนักงาน"
                        value={historyForm.staffName}
                        onChange={event =>
                          setHistoryForm({
                            ...historyForm,
                            staffName: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label
                        htmlFor="history-opened-at"
                        className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"
                      >
                        <CalendarClock className="h-3.5 w-3.5 text-emerald-600" />
                        เวลาเปิดกะ
                      </Label>
                      <Input
                        id="history-opened-at"
                        type="datetime-local"
                        required
                        className="rounded-xl bg-white tabular-nums"
                        value={historyForm.openedAt}
                        onChange={event =>
                          setHistoryForm({
                            ...historyForm,
                            openedAt: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label
                        htmlFor="history-closed-at"
                        className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"
                      >
                        <CalendarClock className="h-3.5 w-3.5 text-rose-500" />
                        เวลาปิดกะ
                      </Label>
                      <Input
                        id="history-closed-at"
                        type="datetime-local"
                        required
                        aria-invalid={historyTiming.invalid}
                        className="rounded-xl bg-white tabular-nums"
                        value={historyForm.closedAt}
                        onChange={event =>
                          setHistoryForm({
                            ...historyForm,
                            closedAt: event.target.value,
                          })
                        }
                      />
                    </div>
                    {historyTiming.invalid && (
                      <p className="sm:col-span-2 flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        เวลาปิดกะต้องอยู่หลังเวลาเปิดกะ
                      </p>
                    )}
                  </div>
                </section>

                {historyForm.id && historyReadings === null ? (
                  <section className="flex min-h-44 items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
                    <div>
                      <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                        <LoaderCircle className="h-5 w-5 animate-spin" />
                      </div>
                      <p className="text-sm font-semibold text-slate-700">
                        {editHistoryDetailLoading
                          ? "กำลังโหลดเลขมิเตอร์ของกะ..."
                          : "กำลังเตรียมข้อมูลหัวจ่าย..."}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        กรุณารอสักครู่
                      </p>
                    </div>
                  </section>
                ) : (
                  <>
                    {historyReadings?.length && historyReadingPreview ? (
                      <section className="space-y-4">
                        <div className="flex items-center gap-3 px-1">
                          <div className="flex size-9 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700">
                            <Gauge className="h-4 w-4" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-slate-900">
                              {historyForm.id
                                ? "เลขมิเตอร์ปิดกะ"
                                : "เลขมิเตอร์เปิด–ปิดกะ"}
                            </h3>
                            <p className="text-[11px] text-slate-500">
                              {historyForm.id
                                ? "กรอกเลขปลายทาง ระบบจะคำนวณยอดรวมให้อัตโนมัติ"
                                : "ตรวจเลขตั้งต้นและกรอกเลขปิดกะ ระบบจะคำนวณยอดรวมให้อัตโนมัติ"}
                            </p>
                          </div>
                        </div>
                        <HistoryMeterEditor
                          readings={historyReadings}
                          preview={historyReadingPreview}
                          editableOpening={historyForm.id == null}
                          onChange={readings =>
                            setHistoryForm({ ...historyForm, readings })
                          }
                        />
                      </section>
                    ) : (
                      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3.5 sm:px-5">
                          <div className="flex size-9 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700">
                            <Gauge className="h-4 w-4" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-slate-900">
                              ยอดรวมหน้ามิเตอร์
                            </h3>
                            <p className="text-[11px] text-slate-500">
                              ระบุยอดสรุปของกะย้อนหลัง
                            </p>
                          </div>
                        </div>
                        <div className="grid gap-4 p-4 sm:grid-cols-3 sm:p-5">
                          <HistoryMetricInput
                            field="totalLiters"
                            label="ปริมาณรวม"
                            unit="liters"
                            value={historyForm.totalLiters}
                            onChange={value =>
                              setHistoryForm({
                                ...historyForm,
                                totalLiters: value,
                              })
                            }
                          />
                          <HistoryMetricInput
                            field="totalAmount"
                            label="ยอดจากลิตร"
                            value={historyForm.totalAmount}
                            onChange={value =>
                              setHistoryForm({
                                ...historyForm,
                                totalAmount: value,
                              })
                            }
                          />
                          <HistoryMetricInput
                            field="totalMoneyMeter"
                            label="ยอดจาก P"
                            value={historyForm.totalMoneyMeter}
                            onChange={value =>
                              setHistoryForm({
                                ...historyForm,
                                totalMoneyMeter: value,
                              })
                            }
                          />
                        </div>
                      </section>
                    )}

                    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                      <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3.5 sm:px-5">
                        <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                          <WalletCards className="h-4 w-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">
                            สรุปการเงิน
                          </h3>
                          <p className="text-[11px] text-slate-500">
                            ยอดขาย เงินสด และยอดโอนของกะ
                          </p>
                        </div>
                      </div>
                      <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
                        <HistoryMetricInput
                          field="posAmount"
                          label="ยอดขาย POS"
                          value={historyForm.posAmount}
                          onChange={value =>
                            setHistoryForm({
                              ...historyForm,
                              posAmount: value,
                            })
                          }
                        />
                        <HistoryMetricInput
                          field="openingFloat"
                          label="เงินทอนเริ่มกะ"
                          value={historyForm.openingFloat}
                          onChange={value =>
                            setHistoryForm({
                              ...historyForm,
                              openingFloat: value,
                            })
                          }
                        />
                        <HistoryMetricInput
                          field="expectedCash"
                          label="เงินสดควรมี"
                          optional
                          value={historyForm.expectedCash}
                          onChange={value =>
                            setHistoryForm({
                              ...historyForm,
                              expectedCash: value,
                            })
                          }
                        />
                        <HistoryMetricInput
                          field="countedCash"
                          label="เงินสดนับได้"
                          optional
                          value={historyForm.countedCash}
                          onChange={value =>
                            setHistoryForm({
                              ...historyForm,
                              countedCash: value,
                            })
                          }
                        />
                        <HistoryMetricInput
                          field="transferAmount"
                          label="ยอดเงินโอน"
                          optional
                          value={historyForm.transferAmount}
                          onChange={value =>
                            setHistoryForm({
                              ...historyForm,
                              transferAmount: value,
                            })
                          }
                        />
                      </div>
                    </section>
                  </>
                )}

                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                  <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3.5 sm:px-5">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                      <ReceiptText className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        หมายเหตุ
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        รายละเอียดเพิ่มเติมสำหรับตรวจสอบย้อนหลัง
                      </p>
                    </div>
                  </div>
                  <div className="p-4 sm:p-5">
                    <Label htmlFor="history-note" className="sr-only">
                      หมายเหตุ
                    </Label>
                    <Textarea
                      id="history-note"
                      maxLength={1000}
                      rows={3}
                      className="min-h-24 resize-y rounded-xl bg-white"
                      placeholder="ระบุเหตุผลหรือรายละเอียดเพิ่มเติม (ถ้ามี)"
                      value={historyForm.note}
                      onChange={event =>
                        setHistoryForm({
                          ...historyForm,
                          note: event.target.value,
                        })
                      }
                    />
                    <p className="mt-2 text-right text-[10px] text-slate-400">
                      {historyForm.note.length.toLocaleString("th-TH")} / 1,000
                    </p>
                  </div>
                </section>

                {err && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{err}</span>
                  </div>
                )}

                <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-relaxed text-amber-800">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    ระบบจะคำนวณยอดรวมในประวัติใหม่จากเลข P/L ปิดกะ
                    แต่จะไม่ย้อนปรับสต๊อกน้ำมัน มิเตอร์ปัจจุบัน
                    หรือเอกสารการเงินเดิม
                  </span>
                </div>
              </div>

              <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 sm:items-center sm:justify-between sm:px-6">
                <div className="mr-auto hidden items-center gap-2 text-xs text-slate-400 sm:flex">
                  <Info className="h-3.5 w-3.5" />
                  ตรวจสอบข้อมูลให้ครบก่อนบันทึก
                </div>
                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl px-5"
                    onClick={() => setHistoryForm(null)}
                  >
                    ยกเลิก
                  </Button>
                  <Button
                    type="submit"
                    className="rounded-xl bg-blue-600 px-6 shadow-md shadow-blue-200 hover:bg-blue-700"
                    disabled={
                      !historyForm.staffName.trim() ||
                      !historyForm.openedAt ||
                      !historyForm.closedAt ||
                      historyTiming.invalid ||
                      !historyReadings?.length ||
                      historyReadingPreview?.valid === false ||
                      createShiftHistory.isPending ||
                      updateShiftHistory.isPending
                    }
                  >
                    {createShiftHistory.isPending ||
                    updateShiftHistory.isPending ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    {createShiftHistory.isPending ||
                    updateShiftHistory.isPending
                      ? "กำลังบันทึก..."
                      : "บันทึกประวัติ"}
                  </Button>
                </div>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* รายละเอียดกะ */}
      <Dialog
        open={detailId != null}
        onOpenChange={o => !o && setDetailId(null)}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="font-heading">
              รายละเอียดกะ #{detailId}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm min-w-0">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  พนักงาน: <b>{detail.staffName}</b>
                </div>
                <div>เปิด: {fmtDateTime(detail.openedAt)}</div>
                <div>
                  ปิด: {detail.closedAt ? fmtDateTime(detail.closedAt) : "-"}
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>หัวจ่าย</TableHead>
                      <TableHead className="text-right">
                        L ตั้งต้น → ปิด
                      </TableHead>
                      <TableHead className="text-right">ลิตร</TableHead>
                      <TableHead className="text-right">
                        P ตั้งต้น → ปิด
                      </TableHead>
                      <TableHead className="text-right">ยอดจากลิตร</TableHead>
                      <TableHead className="text-right">ยอดจาก P</TableHead>
                      <TableHead>เทียบ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.readings.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap">
                          {r.nozzle?.label}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap text-xs">
                          {fmtNum(r.openMeter)} →{" "}
                          {r.closeMeter != null ? fmtNum(r.closeMeter) : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          {r.liters != null ? fmtNum(r.liters) : "-"}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap text-xs">
                          {fmtNum(r.openMoney)} →{" "}
                          {r.closeMoney != null ? fmtNum(r.closeMoney) : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          {r.amount != null ? `฿${fmtMoney(r.amount)}` : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          {r.money != null ? `฿${fmtMoney(r.money)}` : "-"}
                        </TableCell>
                        <TableCell>
                          <MeterDiffBadge
                            diff={r.diff}
                            priceChangedDuringShift={
                              r.priceChangedDuringShift
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-wrap items-center gap-4 bg-blue-50 rounded-xl p-3">
                <div>
                  ยอดจาก P: <b>฿{fmtMoney(detail.totalMoneyMeter)}</b>
                </div>
                <div>
                  ยอดจากลิตร: <b>฿{fmtMoney(detail.totalAmount)}</b>
                </div>
                <div>
                  รวมลิตร: <b>{fmtNum(detail.totalLiters)}</b>
                </div>
                <div>
                  ยอด POS: <b>฿{fmtMoney(detail.posAmount)}</b>
                </div>
                {detail.status === "closed" && (
                  <MeterDiffBadge
                    diff={r2(detail.totalMoneyMeter - detail.totalAmount)}
                    priceChangedDuringShift={detailHasPriceChange}
                  />
                )}
              </div>

              {/* กระทบยอดเงินสด */}
              <div className="border rounded-xl p-3 space-y-2">
                <div className="font-medium">กระทบยอดเงินสด</div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                  <span>
                    เงินทอนเริ่มกะ: <b>฿{fmtMoney(detail.openingFloat)}</b>
                  </span>
                  <span>
                    ขายเงินสด: <b>฿{fmtMoney(detail.cash.cashSales)}</b>
                  </span>
                  <span>
                    ชำระหนี้เงินสด:{" "}
                    <b>฿{fmtMoney(detail.cash.cashDebtPayments)}</b>
                  </span>
                  <span>
                    ค่าใช้จ่าย: <b>฿{fmtMoney(detail.cash.expensesTotal)}</b>
                  </span>
                  <span>
                    เงินสดควรมี:{" "}
                    <b>
                      ฿
                      {fmtMoney(
                        detail.expectedCash ?? detail.cash.expectedCash
                      )}
                    </b>
                    {detail.expectedCash == null && (
                      <span className="text-xs text-amber-600">
                        {" "}
                        (คำนวณย้อนหลัง)
                      </span>
                    )}
                  </span>
                  {detail.countedCash != null && (
                    <span className="flex items-center gap-2">
                      นับได้: <b>฿{fmtMoney(detail.countedCash)}</b>
                      <DiffBadge
                        diff={r2(
                          detail.countedCash -
                            (detail.expectedCash ?? detail.cash.expectedCash)
                        )}
                      />
                    </span>
                  )}
                  {detail.transferAmount != null && (
                    <span>
                      ยอดเงินโอน: <b>฿{fmtMoney(detail.transferAmount)}</b>
                    </span>
                  )}
                </div>
                {detail.cashCounts &&
                  Object.keys(detail.cashCounts).length > 0 && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground border-t pt-2">
                      {CASH_DENOMINATIONS.filter(
                        d => (detail.cashCounts?.[String(d)] ?? 0) > 0
                      ).map(d => {
                        const n = detail.cashCounts?.[String(d)] ?? 0;
                        return (
                          <span key={d}>
                            {cashDenomLabel(d)} × {n} = ฿{fmtMoney(d * n)}
                          </span>
                        );
                      })}
                    </div>
                  )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
