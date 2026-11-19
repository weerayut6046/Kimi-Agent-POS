import { useState, type FormEvent } from "react";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Settings2,
} from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api/router";
import {
  leaveCalendarDays,
  WORK_LEAVE_STATUSES,
  WORK_LEAVE_TYPES,
  workLeaveStatusLabel,
  workLeaveTypeLabel,
  type WorkLeaveStatus,
  type WorkLeaveType,
} from "@contracts/workLeave";
import { bangkokDateKey } from "@contracts/promotion";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { useAppConfirm } from "@/components/AppConfirmDialog";
import { fmtDateTime } from "@/lib/format";
import { trpc } from "@/providers/trpc";

type LeaveData = inferRouterOutputs<AppRouter>["workforce"]["leave"]["list"];
type LeaveRow = LeaveData["requests"][number];
type ReviewDecision = Exclude<WorkLeaveStatus, "pending">;
type Review = { row: LeaveRow; decision: ReviewDecision };

const selectClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const statusClass: Record<WorkLeaveStatus, string> = {
  pending:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  approved:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  rejected:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
  cancelled: "border-border bg-muted text-muted-foreground",
};
const dateFormat = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function leaveDateRange(row: LeaveRow) {
  const start = dateFormat.format(new Date(row.startOn));
  return row.startOn === row.endOn
    ? start
    : `${start} ถึง ${dateFormat.format(new Date(row.endOn))}`;
}

function leaveBalance(
  data: LeaveData | undefined,
  staffId: number,
  type: WorkLeaveType
) {
  const quota = data?.quotas.find(
    row => row.staffId === staffId && row.type === type
  )?.days;
  const used =
    data?.requests.reduce(
      (total, row) =>
        row.staffId === staffId &&
        row.type === type &&
        row.status === "approved"
          ? total + (row.chargedDays ?? 0)
          : total,
      0
    ) ?? 0;
  return { quota, used, remaining: quota === undefined ? null : quota - used };
}

function balanceLabel(remaining: number | null) {
  if (remaining === null) return "ยังไม่ได้ตั้งสิทธิ์";
  return remaining < 0
    ? `เกินยอดที่ตั้ง ${-remaining} วัน`
    : `คงเหลือ ${remaining} วัน`;
}

function LeaveQuotaForm({
  data,
  year,
  initialStaffId,
  pending,
  onSave,
}: {
  data: LeaveData;
  year: number;
  initialStaffId?: number;
  pending: boolean;
  onSave: (input: {
    staffId: number;
    year: number;
    type: WorkLeaveType;
    days: number | null;
  }) => void;
}) {
  const [staffId, setStaffId] = useState(
    initialStaffId ?? data.employees[0]?.id
  );
  const [type, setType] = useState<WorkLeaveType>("vacation");
  const quota = data.quotas.find(
    row => row.staffId === staffId && row.type === type
  )?.days;

  return (
    <form
      className="space-y-4"
      onSubmit={event => {
        event.preventDefault();
        if (!staffId) return;
        const raw = String(new FormData(event.currentTarget).get("days") ?? "");
        onSave({ staffId, year, type, days: raw === "" ? null : Number(raw) });
      }}
    >
      <label className="block space-y-1.5 text-sm font-medium">
        พนักงาน
        <select
          className={selectClass}
          value={staffId}
          onChange={event => setStaffId(Number(event.target.value))}
          required
        >
          {data.employees.map(employee => (
            <option key={employee.id} value={employee.id}>
              {employee.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1.5 text-sm font-medium">
        ประเภทการลา
        <select
          className={selectClass}
          value={type}
          onChange={event => setType(event.target.value as WorkLeaveType)}
        >
          {WORK_LEAVE_TYPES.map(kind => (
            <option key={kind} value={kind}>
              {workLeaveTypeLabel[kind]}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1.5 text-sm font-medium">
        จำนวนวันต่อปี
        <Input
          className="h-11"
          key={`${staffId}-${type}`}
          name="days"
          type="number"
          min={0}
          max={366}
          defaultValue={quota}
        />
        <span className="block text-xs font-normal text-muted-foreground">
          เว้นว่างเพื่อล้างยอดสิทธิ์ที่ตั้งไว้
        </span>
      </label>
      <DialogFooter>
        <Button
          className="min-h-11"
          type="submit"
          disabled={pending || !staffId}
        >
          {pending ? "กำลังบันทึก" : "บันทึกสิทธิ์วันลา"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function WorkLeavePanel({
  branchId,
  staffId,
  canReview,
  canSetQuota,
}: {
  branchId: number;
  staffId: number;
  canReview: boolean;
  canSetQuota: boolean;
}) {
  const today = bangkokDateKey(new Date());
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [scope, setScope] = useState<"mine" | "branch">("mine");
  const [staffFilter, setStaffFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<WorkLeaveStatus | "all">(
    "all"
  );
  const [requestOpen, setRequestOpen] = useState(false);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const confirmAction = useAppConfirm();
  const utils = trpc.useUtils();
  const list = trpc.workforce.leave.list.useQuery({ branchId, year, scope });

  function clearFeedback() {
    setMessage("");
    setError("");
  }

  function onSuccess(text: string) {
    setError("");
    setMessage(text);
    void utils.workforce.leave.list.invalidate();
    void utils.workforce.scheduleList.invalidate();
    void utils.workforce.myScheduleList.invalidate();
  }

  function onError(err: { message: string }) {
    setMessage("");
    setError(err.message);
  }

  const submit = trpc.workforce.leave.submit.useMutation({
    onSuccess: (_, input) => {
      setRequestOpen(false);
      setYear(Number(input.startOn.slice(0, 4)));
      setScope("mine");
      setStatusFilter("all");
      onSuccess("ส่งใบลาแล้ว");
    },
    onError,
  });
  const cancel = trpc.workforce.leave.cancelMine.useMutation({
    onSuccess: () => onSuccess("ยกเลิกใบลาแล้ว"),
    onError,
  });
  const decide = trpc.workforce.leave.review.useMutation({
    onSuccess: (_, input) => {
      setReview(null);
      onSuccess(workLeaveStatusLabel[input.decision]);
    },
    onError,
  });
  const setQuota = trpc.workforce.leave.setQuota.useMutation({
    onSuccess: () => {
      setQuotaOpen(false);
      onSuccess("บันทึกสิทธิ์วันลาแล้ว");
    },
    onError,
  });
  const team = scope === "branch";
  const balanceStaff = team ? Number(staffFilter) : staffId;
  const staffRows =
    list.data?.requests.filter(
      row => !team || !staffFilter || row.staffId === balanceStaff
    ) ?? [];
  const visibleRows = staffRows.filter(
    row => statusFilter === "all" || row.status === statusFilter
  );
  const inDialog = requestOpen || quotaOpen || review !== null;
  const dialogError = error && (
    <p className="text-sm text-destructive" role="alert">
      {error}
    </p>
  );

  function sendRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    const form = new FormData(event.currentTarget);
    const startOn = String(form.get("startOn"));
    const endOn = String(form.get("endOn"));
    if (endOn < startOn || startOn.slice(0, 4) !== endOn.slice(0, 4)) {
      setError(
        endOn < startOn
          ? "วันสิ้นสุดต้องตรงกับหรืออยู่หลังวันเริ่มลา"
          : "กรุณายื่นใบลาแยกตามปีปฏิทิน"
      );
      return;
    }
    submit.mutate({
      type: String(form.get("type")) as WorkLeaveType,
      startOn,
      endOn,
      note: String(form.get("note")),
    });
  }

  function sendReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!review) return;
    clearFeedback();
    const form = new FormData(event.currentTarget);
    const note = String(form.get("note")).trim();
    const { decision, row } = review;
    decide.mutate(
      decision === "approved"
        ? { id: row.id, decision, days: Number(form.get("days")), note }
        : { id: row.id, decision, note }
    );
  }

  async function withdraw(row: LeaveRow) {
    if (
      !(await confirmAction({
        title: "ยกเลิกใบลาที่รออนุมัติ",
        description: `${workLeaveTypeLabel[row.type]} · ${leaveDateRange(row)}`,
        confirmLabel: "ยืนยันยกเลิกใบลา",
      }))
    )
      return;
    clearFeedback();
    cancel.mutate({ id: row.id });
  }

  function openReview(row: LeaveRow, decision: ReviewDecision) {
    clearFeedback();
    setReview({ row, decision });
  }

  return (
    <section className="min-w-0 space-y-4" aria-label="การลา">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">ใบลาพนักงาน</h2>
          <p className="text-sm text-muted-foreground">
            ยื่นลา ติดตามผล และตรวจวันลาคงเหลือในสาขาปัจจุบัน
          </p>
        </div>
        <Button
          className="min-h-11"
          onClick={() => {
            clearFeedback();
            setRequestOpen(true);
          }}
        >
          <CalendarPlus /> ยื่นใบลา
        </Button>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={team ? "outline" : "secondary"}
            className="min-h-11"
            aria-pressed={!team}
            onClick={() => {
              setScope("mine");
              setStatusFilter("all");
            }}
          >
            ใบลาของฉัน
          </Button>
          {canReview && (
            <Button
              variant={team ? "secondary" : "outline"}
              className="min-h-11"
              aria-pressed={team}
              onClick={() => {
                setScope("branch");
                setStatusFilter("pending");
              }}
            >
              ใบลาทีม
            </Button>
          )}
          {canSetQuota && team && (
            <Button
              variant="outline"
              className="min-h-11"
              disabled={!list.data?.employees.length}
              onClick={() => {
                clearFeedback();
                setQuotaOpen(true);
              }}
            >
              <Settings2 /> ตั้งสิทธิ์วันลา
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-11"
            aria-label="ปีก่อน"
            disabled={year <= 2000}
            onClick={() => setYear(year - 1)}
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-20 text-center text-sm font-medium">
            ปี {year + 543}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-11"
            aria-label="ปีถัดไป"
            disabled={year >= 2100}
            onClick={() => setYear(year + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      {message && (
        <p
          className="text-sm text-emerald-700 dark:text-emerald-300"
          role="status"
        >
          {message}
        </p>
      )}
      {!inDialog && dialogError}
      {list.isPending && (
        <p className="text-sm text-muted-foreground" role="status">
          กำลังโหลดใบลา
        </p>
      )}
      {list.isError && (
        <p className="text-sm text-destructive" role="alert">
          {list.error.message}
        </p>
      )}

      {list.data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {WORK_LEAVE_STATUSES.map(status => (
              <div key={status} className="rounded-xl border bg-card p-3">
                <span className="text-sm text-muted-foreground">
                  {workLeaveStatusLabel[status]}
                </span>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {staffRows.filter(row => row.status === status).length}
                </p>
              </div>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {team && (
              <label className="block space-y-1.5 text-sm font-medium">
                พนักงาน
                <select
                  className={selectClass}
                  value={staffFilter}
                  onChange={event => setStaffFilter(event.target.value)}
                >
                  <option value="">พนักงานทุกคน</option>
                  {list.data.employees.map(employee => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block space-y-1.5 text-sm font-medium">
              สถานะใบลา
              <select
                className={selectClass}
                value={statusFilter}
                onChange={event =>
                  setStatusFilter(event.target.value as typeof statusFilter)
                }
              >
                <option value="all">ทุกสถานะ</option>
                {WORK_LEAVE_STATUSES.map(status => (
                  <option key={status} value={status}>
                    {workLeaveStatusLabel[status]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {balanceStaff > 0 && (
            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              aria-label="สิทธิ์วันลาตามประเภท"
            >
              {WORK_LEAVE_TYPES.map(type => {
                const balance = leaveBalance(list.data, balanceStaff, type);
                return (
                  <div
                    key={type}
                    className="rounded-xl border bg-muted/35 p-3 text-sm"
                  >
                    <p className="font-semibold">{workLeaveTypeLabel[type]}</p>
                    <p>
                      ใช้แล้ว {balance.used}
                      {balance.quota === undefined
                        ? ""
                        : ` / ${balance.quota}`}{" "}
                      วัน
                    </p>
                    <p className="text-muted-foreground">
                      {balanceLabel(balance.remaining)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
          {visibleRows.length === 0 && (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              ไม่มีใบลาในตัวกรองนี้
            </p>
          )}
          <ul className="space-y-2" aria-label="รายการใบลา">
            {visibleRows.map(row => (
              <li
                key={row.id}
                className="space-y-2 rounded-xl border bg-card p-3 sm:p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 break-words font-semibold">
                    {team ? `${row.staffName} · ` : ""}
                    {workLeaveTypeLabel[row.type]}
                  </p>
                  <Badge variant="outline" className={statusClass[row.status]}>
                    {workLeaveStatusLabel[row.status]}
                  </Badge>
                </div>
                <p className="text-sm">
                  {leaveDateRange(row)}
                  {row.status === "approved" &&
                    ` · ใช้สิทธิ์ ${row.chargedDays} วัน`}
                </p>
                {row.note && (
                  <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    {row.note}
                  </p>
                )}
                {row.reviewedAt && (
                  <div className="text-sm text-muted-foreground">
                    <p>
                      {row.reviewerName
                        ? `${row.reviewerName} · `
                        : "ยกเลิกเมื่อ "}
                      {fmtDateTime(row.reviewedAt)}
                    </p>
                    {row.reviewNote && (
                      <p className="whitespace-pre-wrap break-words">
                        {row.reviewNote}
                      </p>
                    )}
                  </div>
                )}
                {row.status === "pending" && row.staffId === staffId && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11"
                    disabled={cancel.isPending}
                    onClick={() => void withdraw(row)}
                  >
                    ยกเลิกใบลา
                  </Button>
                )}
                {team &&
                  canReview &&
                  row.staffId !== staffId &&
                  row.status === "pending" && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="min-h-11"
                        onClick={() => openReview(row, "approved")}
                      >
                        อนุมัติ
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-11"
                        onClick={() => openReview(row, "rejected")}
                      >
                        ปฏิเสธ
                      </Button>
                    </div>
                  )}
                {team &&
                  canReview &&
                  row.staffId !== staffId &&
                  row.status === "approved" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-11"
                      onClick={() => openReview(row, "cancelled")}
                    >
                      ยกเลิกการอนุมัติ
                    </Button>
                  )}
              </li>
            ))}
          </ul>
        </>
      )}

      <Dialog
        open={requestOpen}
        onOpenChange={open => {
          clearFeedback();
          setRequestOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยื่นใบลา</DialogTitle>
            <DialogDescription>
              เลือกช่วงวันลาของคุณ หากลาข้ามปีให้แยกเป็นสองใบ
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={sendRequest}>
            <label className="block space-y-1.5 text-sm font-medium">
              ประเภทการลา
              <select
                name="type"
                className={selectClass}
                defaultValue="vacation"
              >
                {WORK_LEAVE_TYPES.map(type => (
                  <option key={type} value={type}>
                    {workLeaveTypeLabel[type]}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm font-medium">
                วันเริ่มลา
                <Input
                  className="h-11 min-w-0"
                  name="startOn"
                  type="date"
                  defaultValue={today}
                  required
                />
              </label>
              <label className="block space-y-1.5 text-sm font-medium">
                วันสิ้นสุด
                <Input
                  className="h-11 min-w-0"
                  name="endOn"
                  type="date"
                  defaultValue={today}
                  required
                />
              </label>
            </div>
            <label className="block space-y-1.5 text-sm font-medium">
              หมายเหตุ (ถ้ามี)
              <Textarea name="note" maxLength={500} />
            </label>
            {dialogError}
            <DialogFooter>
              <Button
                className="min-h-11"
                type="submit"
                disabled={submit.isPending}
              >
                {submit.isPending ? "กำลังส่งใบลา" : "ส่งใบลา"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={review !== null}
        onOpenChange={open => {
          if (!open) {
            clearFeedback();
            setReview(null);
          }
        }}
      >
        {review && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {review.decision === "cancelled"
                  ? "ยกเลิกการอนุมัติ"
                  : review.decision === "approved"
                    ? "อนุมัติใบลา"
                    : "ปฏิเสธใบลา"}
              </DialogTitle>
              <DialogDescription>
                {review.row.staffName} · {workLeaveTypeLabel[review.row.type]} ·{" "}
                {leaveDateRange(review.row)}
              </DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={sendReview}>
              {review.decision === "approved" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    {balanceLabel(
                      leaveBalance(
                        list.data,
                        review.row.staffId,
                        review.row.type
                      ).remaining
                    )}{" "}
                    ก่อนอนุมัติ
                  </p>
                  <label className="block space-y-1.5 text-sm font-medium">
                    จำนวนวันใช้สิทธิ์
                    <Input
                      className="h-11"
                      type="number"
                      name="days"
                      min={0}
                      max={leaveCalendarDays(
                        review.row.startOn,
                        review.row.endOn
                      )}
                      defaultValue={review.row.plannedDays}
                      required
                    />
                    <span className="block text-xs font-normal text-muted-foreground">
                      แนะนำจากวันในตารางงาน โดยหลายกะในวันเดียวกันนับเป็น 1 วัน
                      ตรวจวันหยุดและระบุเหตุผลหากเกินยอดสิทธิ์
                    </span>
                  </label>
                </>
              )}
              <label className="block space-y-1.5 text-sm font-medium">
                {review.decision === "approved" ? "หมายเหตุประกอบ" : "เหตุผล"}
                <Textarea
                  name="note"
                  maxLength={500}
                  minLength={review.decision === "approved" ? undefined : 3}
                  required={review.decision !== "approved"}
                />
              </label>
              {dialogError}
              <DialogFooter>
                <Button
                  className="min-h-11"
                  type="submit"
                  disabled={decide.isPending}
                >
                  {decide.isPending ? "กำลังบันทึก" : "ยืนยันผล"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>

      <Dialog
        open={quotaOpen}
        onOpenChange={open => {
          clearFeedback();
          setQuotaOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ตั้งสิทธิ์วันลา ปี {year + 543}</DialogTitle>
            <DialogDescription>
              กำหนดจำนวนวันตามประเภทและพนักงานของสาขานี้
              เพื่อใช้ตรวจยอดตอนอนุมัติ
            </DialogDescription>
          </DialogHeader>
          {dialogError}
          {list.data && (
            <LeaveQuotaForm
              data={list.data}
              year={year}
              initialStaffId={staffFilter ? balanceStaff : undefined}
              pending={setQuota.isPending}
              onSave={input => {
                clearFeedback();
                setQuota.mutate(input);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
