import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
  ArrowLeftRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Pencil,
  Plus,
  RotateCcw,
  Settings2,
  Trash2,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useStaff } from "@/hooks/useStaff";
import {
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtNum,
  roleLabel,
} from "@/lib/format";
import { trpc } from "@/providers/trpc";

type ScheduleStatus = "scheduled" | "completed" | "leave" | "absent";
type SalaryType = "monthly" | "daily" | "hourly";

type ScheduleForm = {
  id?: number;
  workDate: string;
  shiftTemplateId: string;
  staffId: string;
  status: ScheduleStatus;
  note: string;
};

type TemplateForm = {
  id?: number;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: string;
  active: boolean;
};

type ProfileForm = {
  staffId: number;
  name: string;
  position: string;
  salaryType: SalaryType;
  baseRate: string;
  overtimeRate: string;
  hireDate: string;
  note: string;
};

type PayrollForm = {
  id: number;
  staffName: string;
  overtimeHours: string;
  bonus: string;
  deduction: string;
  note: string;
};

type StaffForm = {
  username: string;
  password: string;
  name: string;
  role: "admin" | "manager" | "cashier";
};

const scheduleStatusLabel: Record<ScheduleStatus, string> = {
  scheduled: "จัดกะแล้ว",
  completed: "ทำงานแล้ว",
  leave: "ลา",
  absent: "ขาดงาน",
};

const salaryTypeLabel: Record<SalaryType, string> = {
  monthly: "รายเดือน",
  daily: "รายวัน",
  hourly: "รายชั่วโมง",
};

function localDateText(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function monthText(date = new Date()) {
  return localDateText(date).slice(0, 7);
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateText(date);
}

function statusBadge(status: ScheduleStatus) {
  const className =
    status === "completed"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "leave"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : status === "absent"
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-blue-200 bg-blue-50 text-blue-700";
  return (
    <Badge variant="outline" className={className}>
      {scheduleStatusLabel[status]}
    </Badge>
  );
}

export default function Workforce() {
  const { staff } = useStaff();
  const isAdmin = staff?.role === "admin";
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab =
    requestedTab === "employees" || requestedTab === "payroll"
      ? requestedTab
      : "schedule";
  const utils = trpc.useUtils();
  const [startDate, setStartDate] = useState(localDateText());
  const endDate = addDays(startDate, 6);
  const [payrollMonth, setPayrollMonth] = useState(monthText());
  const [selectedScheduleIds, setSelectedScheduleIds] = useState<number[]>([]);
  const [scheduleForm, setScheduleForm] = useState<ScheduleForm | null>(null);
  const [templateDialog, setTemplateDialog] = useState(false);
  const [templateForm, setTemplateForm] = useState<TemplateForm | null>(null);
  const [profileForm, setProfileForm] = useState<ProfileForm | null>(null);
  const [payrollForm, setPayrollForm] = useState<PayrollForm | null>(null);
  const [staffForm, setStaffForm] = useState<StaffForm | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const { data: templates = [] } = trpc.workforce.listTemplates.useQuery();
  const { data: directory = [] } = trpc.workforce.directory.useQuery();
  const { data: schedules = [], isLoading: scheduleLoading } =
    trpc.workforce.scheduleList.useQuery({ startDate, endDate });
  const { data: allProfiles = [] } = trpc.workforce.employeeProfiles.useQuery(
    undefined,
    { enabled: isAdmin }
  );
  const { data: myProfile } = trpc.workforce.myProfile.useQuery(undefined, {
    enabled: !isAdmin,
  });
  const { data: payrollRows = [], isLoading: payrollLoading } =
    trpc.workforce.payrollList.useQuery(
      { month: payrollMonth },
      { enabled: isAdmin }
    );
  const { data: myPayroll } = trpc.workforce.myPayroll.useQuery(
    { month: payrollMonth },
    { enabled: !isAdmin }
  );

  const showSuccess = (text: string) => {
    setMessage(text);
    setError("");
    window.setTimeout(() => setMessage(""), 3500);
  };
  const showError = (text: string) => {
    setError(text);
    setMessage("");
  };
  const refreshSchedule = () => {
    setSelectedScheduleIds([]);
    void utils.workforce.scheduleList.invalidate();
  };
  const refreshProfiles = () => {
    void utils.workforce.employeeProfiles.invalidate();
    void utils.workforce.myProfile.invalidate();
    void utils.workforce.directory.invalidate();
  };
  const refreshPayroll = () => {
    void utils.workforce.payrollList.invalidate();
    void utils.workforce.myPayroll.invalidate();
  };

  const createSchedule = trpc.workforce.createSchedule.useMutation({
    onSuccess: () => {
      refreshSchedule();
      setScheduleForm(null);
      showSuccess("เพิ่มตารางงานแล้ว");
    },
    onError: err => showError(err.message),
  });
  const updateSchedule = trpc.workforce.updateSchedule.useMutation({
    onSuccess: () => {
      refreshSchedule();
      setScheduleForm(null);
      showSuccess("แก้ไขตารางงานแล้ว");
    },
    onError: err => showError(err.message),
  });
  const deleteSchedule = trpc.workforce.deleteSchedule.useMutation({
    onSuccess: () => {
      refreshSchedule();
      showSuccess("ลบตารางงานแล้ว");
    },
    onError: err => showError(err.message),
  });
  const swapSchedules = trpc.workforce.swapSchedules.useMutation({
    onSuccess: () => {
      refreshSchedule();
      showSuccess("สลับกะพนักงานเรียบร้อยแล้ว");
    },
    onError: err => showError(err.message),
  });
  const upsertTemplate = trpc.workforce.upsertTemplate.useMutation({
    onSuccess: () => {
      void utils.workforce.listTemplates.invalidate();
      setTemplateForm(null);
      showSuccess("บันทึกรูปแบบกะแล้ว");
    },
    onError: err => showError(err.message),
  });
  const deleteTemplate = trpc.workforce.deleteTemplate.useMutation({
    onSuccess: () => {
      void utils.workforce.listTemplates.invalidate();
      showSuccess("ลบรูปแบบกะแล้ว");
    },
    onError: err => showError(err.message),
  });
  const upsertProfile = trpc.workforce.upsertEmployeeProfile.useMutation({
    onSuccess: () => {
      refreshProfiles();
      setProfileForm(null);
      showSuccess("บันทึกข้อมูลพนักงานและค่าจ้างแล้ว");
    },
    onError: err => showError(err.message),
  });
  const createStaff = trpc.auth.createStaff.useMutation({
    onSuccess: () => {
      void utils.auth.listStaff.invalidate();
      refreshProfiles();
      setStaffForm(null);
      showSuccess(
        "เพิ่มพนักงานแล้ว กรุณาตั้งค่าตำแหน่งและอัตราค่าจ้างต่อได้เลย"
      );
    },
    onError: err => showError(err.message),
  });
  const generatePayroll = trpc.workforce.generatePayroll.useMutation({
    onSuccess: result => {
      refreshPayroll();
      showSuccess(
        `คำนวณเงินเดือน ${result.generated} คน${result.skippedPaid ? ` (ข้ามรายการจ่ายแล้ว ${result.skippedPaid} คน)` : ""}`
      );
    },
    onError: err => showError(err.message),
  });
  const updatePayroll = trpc.workforce.updatePayroll.useMutation({
    onSuccess: () => {
      refreshPayroll();
      setPayrollForm(null);
      showSuccess("บันทึกรายการเงินเดือนแล้ว");
    },
    onError: err => showError(err.message),
  });
  const setPayrollStatus = trpc.workforce.setPayrollStatus.useMutation({
    onSuccess: (_, variables) => {
      refreshPayroll();
      showSuccess(
        variables.status === "paid"
          ? "บันทึกจ่ายเงินเดือนแล้ว"
          : "เปิดรายการให้แก้ไขแล้ว"
      );
    },
    onError: err => showError(err.message),
  });

  const activeTemplates = templates.filter(template => template.active);
  const scheduleSummary = useMemo(() => {
    const workDates = new Set(schedules.map(schedule => schedule.workDate))
      .size;
    const staffCount = new Set(schedules.map(schedule => schedule.staffId))
      .size;
    return { workDates, staffCount };
  }, [schedules]);

  const openNewSchedule = () => {
    setError("");
    setScheduleForm({
      workDate: startDate,
      shiftTemplateId: activeTemplates[0] ? String(activeTemplates[0].id) : "",
      staffId: directory[0] ? String(directory[0].id) : "",
      status: "scheduled",
      note: "",
    });
  };

  const submitSchedule = () => {
    if (!scheduleForm) return;
    const values = {
      workDate: scheduleForm.workDate,
      shiftTemplateId: Number(scheduleForm.shiftTemplateId),
      staffId: Number(scheduleForm.staffId),
      status: scheduleForm.status,
      note: scheduleForm.note.trim() || undefined,
    };
    if (!values.workDate || !values.shiftTemplateId || !values.staffId) {
      showError("กรุณากรอกข้อมูลตารางงานให้ครบ");
      return;
    }
    if (scheduleForm.id) {
      updateSchedule.mutate({ id: scheduleForm.id, ...values });
    } else {
      createSchedule.mutate(values);
    }
  };

  const toggleScheduleSelection = (id: number) => {
    setSelectedScheduleIds(current => {
      if (current.includes(id)) return current.filter(value => value !== id);
      if (current.length >= 2) return [current[1], id];
      return [...current, id];
    });
  };

  const submitTemplate = () => {
    if (!templateForm) return;
    upsertTemplate.mutate({
      id: templateForm.id,
      name: templateForm.name.trim(),
      startTime: templateForm.startTime,
      endTime: templateForm.endTime,
      breakMinutes: Number(templateForm.breakMinutes) || 0,
      active: templateForm.active,
    });
  };

  const submitProfile = () => {
    if (!profileForm) return;
    upsertProfile.mutate({
      staffId: profileForm.staffId,
      position: profileForm.position.trim(),
      salaryType: profileForm.salaryType,
      baseRate: Number(profileForm.baseRate) || 0,
      overtimeRate: Number(profileForm.overtimeRate) || 0,
      hireDate: profileForm.hireDate || null,
      note: profileForm.note.trim() || null,
    });
  };

  const submitPayroll = () => {
    if (!payrollForm) return;
    updatePayroll.mutate({
      id: payrollForm.id,
      overtimeHours: Number(payrollForm.overtimeHours) || 0,
      bonus: Number(payrollForm.bonus) || 0,
      deduction: Number(payrollForm.deduction) || 0,
      note: payrollForm.note.trim() || null,
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-heading flex items-center gap-2">
          <UserRound className="size-6 text-primary" /> พนักงานและตารางงาน
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ตารางกะพนักงาน การสลับกะ และเงินเดือน แยกจากกะมิเตอร์ขายหน้าลาน
        </p>
      </div>
      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <Tabs defaultValue={initialTab} className="gap-4">
        <TabsList>
          <TabsTrigger value="schedule">
            <CalendarDays /> ตารางงาน
          </TabsTrigger>
          <TabsTrigger value="employees">
            <UserRound /> พนักงาน
          </TabsTrigger>
          <TabsTrigger value="payroll">
            <CircleDollarSign /> เงินเดือน
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schedule" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <Button
                size="icon"
                variant="outline"
                title="สัปดาห์ก่อน"
                onClick={() => setStartDate(addDays(startDate, -7))}
              >
                <ChevronLeft />
              </Button>
              <div className="space-y-1">
                <Label htmlFor="schedule-start">เริ่มช่วงตาราง 7 วัน</Label>
                <Input
                  id="schedule-start"
                  type="date"
                  className="w-44"
                  value={startDate}
                  onChange={event => setStartDate(event.target.value)}
                />
              </div>
              <Button
                size="icon"
                variant="outline"
                title="สัปดาห์ถัดไป"
                onClick={() => setStartDate(addDays(startDate, 7))}
              >
                <ChevronRight />
              </Button>
              <span className="pb-2 text-sm text-muted-foreground">
                ถึง {fmtDate(endDate)} · {scheduleSummary.staffCount} คน ·{" "}
                {schedules.length} กะ
              </span>
            </div>
            {isAdmin && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => setTemplateDialog(true)}
                >
                  <Settings2 /> รูปแบบกะ
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    selectedScheduleIds.length !== 2 || swapSchedules.isPending
                  }
                  onClick={() =>
                    swapSchedules.mutate({
                      firstId: selectedScheduleIds[0],
                      secondId: selectedScheduleIds[1],
                    })
                  }
                >
                  <ArrowLeftRight /> สลับกะ ({selectedScheduleIds.length}/2)
                </Button>
                <Button onClick={openNewSchedule}>
                  <Plus /> เพิ่มตารางงาน
                </Button>
              </div>
            )}
          </div>

          <Card>
            <CardContent className="overflow-x-auto pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    {isAdmin && <TableHead className="w-12">เลือก</TableHead>}
                    <TableHead>วันที่</TableHead>
                    <TableHead>กะงาน</TableHead>
                    <TableHead>พนักงาน</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead>หมายเหตุ</TableHead>
                    {isAdmin && <TableHead className="w-24" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.map(schedule => (
                    <TableRow key={schedule.id}>
                      {isAdmin && (
                        <TableCell>
                          <input
                            aria-label={`เลือกกะของ ${schedule.staffName}`}
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={selectedScheduleIds.includes(schedule.id)}
                            onChange={() =>
                              toggleScheduleSelection(schedule.id)
                            }
                          />
                        </TableCell>
                      )}
                      <TableCell className="whitespace-nowrap font-medium">
                        {fmtDate(schedule.workDate)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="font-medium">{schedule.shiftName}</div>
                        <div className="text-xs text-muted-foreground">
                          {schedule.startTime}-{schedule.endTime}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{schedule.staffName}</div>
                        <div className="text-xs text-muted-foreground">
                          {roleLabel[schedule.staffRole]}
                        </div>
                      </TableCell>
                      <TableCell>{statusBadge(schedule.status)}</TableCell>
                      <TableCell className="max-w-56 text-sm text-muted-foreground">
                        {schedule.note || "-"}
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              title="แก้ไข"
                              onClick={() =>
                                setScheduleForm({
                                  id: schedule.id,
                                  workDate: schedule.workDate,
                                  shiftTemplateId: String(
                                    schedule.shiftTemplateId
                                  ),
                                  staffId: String(schedule.staffId),
                                  status: schedule.status,
                                  note: schedule.note ?? "",
                                })
                              }
                            >
                              <Pencil />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive"
                              title="ลบ"
                              onClick={() => {
                                if (
                                  confirm(
                                    `ลบกะ ${schedule.shiftName} ของ ${schedule.staffName}?`
                                  )
                                ) {
                                  deleteSchedule.mutate({ id: schedule.id });
                                }
                              }}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {!scheduleLoading && schedules.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={isAdmin ? 7 : 5}
                        className="py-10 text-center text-muted-foreground"
                      >
                        ยังไม่มีตารางงานในช่วงนี้
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {!isAdmin && (
            <p className="text-xs text-muted-foreground">
              คุณกำลังดูเฉพาะตารางงานของตนเอง หากต้องการสลับกะให้แจ้งผู้ดูแลระบบ
            </p>
          )}
        </TabsContent>

        <TabsContent value="employees" className="space-y-4">
          {isAdmin ? (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button
                  onClick={() =>
                    setStaffForm({
                      username: "",
                      password: "",
                      name: "",
                      role: "cashier",
                    })
                  }
                >
                  <Plus /> เพิ่มพนักงาน
                </Button>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>ข้อมูลพนักงานและอัตราค่าจ้าง</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>พนักงาน</TableHead>
                        <TableHead>ตำแหน่ง</TableHead>
                        <TableHead>รูปแบบค่าจ้าง</TableHead>
                        <TableHead className="text-right">อัตราหลัก</TableHead>
                        <TableHead className="text-right">
                          OT / ชั่วโมง
                        </TableHead>
                        <TableHead>เริ่มงาน</TableHead>
                        <TableHead className="w-16" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allProfiles.map(profile => (
                        <TableRow key={profile.staffId}>
                          <TableCell>
                            <div className="font-medium">{profile.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {profile.username} · {roleLabel[profile.role]}
                            </div>
                          </TableCell>
                          <TableCell>
                            {profile.position || "ยังไม่ระบุ"}
                          </TableCell>
                          <TableCell>
                            {profile.salaryType
                              ? salaryTypeLabel[profile.salaryType]
                              : "ยังไม่ตั้งค่า"}
                          </TableCell>
                          <TableCell className="text-right">
                            {profile.baseRate == null
                              ? "-"
                              : `฿${fmtMoney(profile.baseRate)}`}
                          </TableCell>
                          <TableCell className="text-right">
                            {profile.overtimeRate == null
                              ? "-"
                              : `฿${fmtMoney(profile.overtimeRate)}`}
                          </TableCell>
                          <TableCell>
                            {profile.hireDate ? fmtDate(profile.hireDate) : "-"}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="icon"
                              variant="ghost"
                              title="แก้ข้อมูลพนักงาน"
                              onClick={() =>
                                setProfileForm({
                                  staffId: profile.staffId,
                                  name: profile.name,
                                  position: profile.position ?? "",
                                  salaryType: profile.salaryType ?? "monthly",
                                  baseRate: String(profile.baseRate ?? 0),
                                  overtimeRate: String(
                                    profile.overtimeRate ?? 0
                                  ),
                                  hireDate: profile.hireDate ?? "",
                                  note: profile.note ?? "",
                                })
                              }
                            >
                              <Pencil />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <p className="mt-4 text-xs text-muted-foreground">
                    การแก้ชื่อผู้ใช้ PIN สิทธิ์ และสถานะบัญชีเดิม
                    จัดการได้ที่หน้า “ตั้งค่าระบบ”
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>ข้อมูลของฉัน</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">ชื่อ</span>
                    <span className="font-medium">
                      {myProfile?.name ?? staff?.name}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">ตำแหน่ง</span>
                    <span>{myProfile?.position || "ยังไม่ระบุ"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">เริ่มงาน</span>
                    <span>
                      {myProfile?.hireDate ? fmtDate(myProfile.hireDate) : "-"}
                    </span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>ข้อมูลค่าจ้าง</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {myProfile?.salaryType ? (
                    <>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">รูปแบบ</span>
                        <span>{salaryTypeLabel[myProfile.salaryType]}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">อัตราหลัก</span>
                        <span className="font-semibold">
                          ฿{fmtMoney(myProfile.baseRate ?? 0)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">
                          OT / ชั่วโมง
                        </span>
                        <span>฿{fmtMoney(myProfile.overtimeRate ?? 0)}</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-muted-foreground">
                      ผู้ดูแลระบบยังไม่ได้ตั้งค่าค่าจ้าง
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="payroll" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <Label htmlFor="payroll-month">เดือนเงินเดือน</Label>
              <Input
                id="payroll-month"
                type="month"
                className="w-44"
                value={payrollMonth}
                onChange={event => setPayrollMonth(event.target.value)}
              />
            </div>
            {isAdmin && (
              <Button
                onClick={() => generatePayroll.mutate({ month: payrollMonth })}
                disabled={!payrollMonth || generatePayroll.isPending}
              >
                <CircleDollarSign /> คำนวณเงินเดือนจากตารางงาน
              </Button>
            )}
          </div>

          {isAdmin ? (
            <Card>
              <CardContent className="overflow-x-auto pt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>พนักงาน</TableHead>
                      <TableHead className="text-right">
                        วัน / ชั่วโมง
                      </TableHead>
                      <TableHead className="text-right">ค่าจ้างหลัก</TableHead>
                      <TableHead className="text-right">OT</TableHead>
                      <TableHead className="text-right">เพิ่ม / หัก</TableHead>
                      <TableHead className="text-right">รับสุทธิ</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead className="w-28" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payrollRows.map(row => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className="font-medium">{row.staffName}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.position || "ยังไม่ระบุตำแหน่ง"}
                          </div>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {fmtNum(row.workDays)} วัน / {fmtNum(row.workHours)}{" "}
                          ชม.
                        </TableCell>
                        <TableCell className="text-right">
                          ฿{fmtMoney(row.baseAmount)}
                        </TableCell>
                        <TableCell className="text-right">
                          ฿{fmtMoney(row.overtimeAmount)}
                          <div className="text-xs text-muted-foreground">
                            {fmtNum(row.overtimeHours)} ชม.
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          <span className="text-emerald-700">
                            +฿{fmtMoney(row.bonus)}
                          </span>
                          <br />
                          <span className="text-red-700">
                            -฿{fmtMoney(row.deduction)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-base font-bold">
                          ฿{fmtMoney(row.netAmount)}
                        </TableCell>
                        <TableCell>
                          {row.status === "paid" ? (
                            <Badge className="bg-emerald-600">
                              <CheckCircle2 /> จ่ายแล้ว
                            </Badge>
                          ) : (
                            <Badge variant="secondary">รอตรวจสอบ</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              title="แก้ OT โบนัส และรายการหัก"
                              disabled={row.status === "paid"}
                              onClick={() =>
                                setPayrollForm({
                                  id: row.id,
                                  staffName: row.staffName,
                                  overtimeHours: String(row.overtimeHours),
                                  bonus: String(row.bonus),
                                  deduction: String(row.deduction),
                                  note: row.note ?? "",
                                })
                              }
                            >
                              <Pencil />
                            </Button>
                            {row.status === "paid" ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                title="เปิดให้แก้ไขอีกครั้ง"
                                onClick={() =>
                                  setPayrollStatus.mutate({
                                    id: row.id,
                                    status: "draft",
                                  })
                                }
                              >
                                <RotateCcw />
                              </Button>
                            ) : (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-emerald-700"
                                title="ยืนยันว่าจ่ายแล้ว"
                                onClick={() => {
                                  if (
                                    confirm(
                                      `ยืนยันจ่ายเงินเดือน ${row.staffName} ฿${fmtMoney(row.netAmount)}?`
                                    )
                                  ) {
                                    setPayrollStatus.mutate({
                                      id: row.id,
                                      status: "paid",
                                    });
                                  }
                                }}
                              >
                                <CheckCircle2 />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!payrollLoading && payrollRows.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="py-10 text-center text-muted-foreground"
                        >
                          ยังไม่มีรายการเงินเดือนเดือนนี้
                          กรุณาตั้งค่าค่าจ้างแล้วกดคำนวณเงินเดือน
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle>สรุปเงินเดือนของฉัน</CardTitle>
              </CardHeader>
              <CardContent>
                {myPayroll ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl bg-muted p-3">
                        <div className="text-xs text-muted-foreground">
                          ค่าจ้างหลัก
                        </div>
                        <div className="mt-1 font-semibold">
                          ฿{fmtMoney(myPayroll.baseAmount)}
                        </div>
                      </div>
                      <div className="rounded-xl bg-muted p-3">
                        <div className="text-xs text-muted-foreground">
                          OT / โบนัส / หัก
                        </div>
                        <div className="mt-1 font-semibold">
                          +฿
                          {fmtMoney(
                            myPayroll.overtimeAmount + myPayroll.bonus
                          )}{" "}
                          / -฿
                          {fmtMoney(myPayroll.deduction)}
                        </div>
                      </div>
                      <div className="rounded-xl bg-blue-50 p-3 text-blue-800">
                        <div className="text-xs">รับสุทธิ</div>
                        <div className="mt-1 text-xl font-bold">
                          ฿{fmtMoney(myPayroll.netAmount)}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">
                        ทำงาน {fmtNum(myPayroll.workDays)} วัน ·{" "}
                        {fmtNum(myPayroll.workHours)} ชั่วโมง
                      </span>
                      {myPayroll.status === "paid" ? (
                        <Badge className="bg-emerald-600">
                          จ่ายแล้ว{" "}
                          {myPayroll.paidAt
                            ? fmtDateTime(myPayroll.paidAt)
                            : ""}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">รอตรวจสอบ</Badge>
                      )}
                    </div>
                    {myPayroll.note && (
                      <p className="rounded-lg border p-3 text-sm">
                        หมายเหตุ: {myPayroll.note}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="py-8 text-center text-muted-foreground">
                    ยังไม่มีรายการเงินเดือนของเดือนนี้
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog
        open={scheduleForm != null}
        onOpenChange={open => !open && setScheduleForm(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {scheduleForm?.id ? "แก้ไขตารางงาน" : "เพิ่มตารางงาน"}
            </DialogTitle>
          </DialogHeader>
          {scheduleForm && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>วันที่</Label>
                <Input
                  type="date"
                  value={scheduleForm.workDate}
                  onChange={event =>
                    setScheduleForm({
                      ...scheduleForm,
                      workDate: event.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>กะงาน</Label>
                <Select
                  value={scheduleForm.shiftTemplateId}
                  onValueChange={value =>
                    setScheduleForm({ ...scheduleForm, shiftTemplateId: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกกะ" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map(template => (
                      <SelectItem
                        key={template.id}
                        value={String(template.id)}
                        disabled={!template.active}
                      >
                        {template.name} ({template.startTime}-{template.endTime}
                        )
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>พนักงาน</Label>
                <Select
                  value={scheduleForm.staffId}
                  onValueChange={value =>
                    setScheduleForm({ ...scheduleForm, staffId: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกพนักงาน" />
                  </SelectTrigger>
                  <SelectContent>
                    {directory.map(person => (
                      <SelectItem key={person.id} value={String(person.id)}>
                        {person.name}
                        {person.position ? ` · ${person.position}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>สถานะ</Label>
                <Select
                  value={scheduleForm.status}
                  onValueChange={(value: ScheduleStatus) =>
                    setScheduleForm({ ...scheduleForm, status: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(scheduleStatusLabel).map(
                      ([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>หมายเหตุ</Label>
                <Textarea
                  value={scheduleForm.note}
                  onChange={event =>
                    setScheduleForm({
                      ...scheduleForm,
                      note: event.target.value,
                    })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleForm(null)}>
              ยกเลิก
            </Button>
            <Button
              onClick={submitSchedule}
              disabled={createSchedule.isPending || updateSchedule.isPending}
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={templateDialog} onOpenChange={setTemplateDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>รูปแบบกะการทำงาน</DialogTitle>
          </DialogHeader>
          <div className="max-h-72 overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ชื่อกะ</TableHead>
                  <TableHead>เวลา</TableHead>
                  <TableHead>พัก</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map(template => (
                  <TableRow key={template.id}>
                    <TableCell className="font-medium">
                      {template.name}
                    </TableCell>
                    <TableCell>
                      {template.startTime}-{template.endTime}
                    </TableCell>
                    <TableCell>{template.breakMinutes} นาที</TableCell>
                    <TableCell>
                      {template.active ? "ใช้งาน" : "ปิดใช้งาน"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() =>
                            setTemplateForm({
                              id: template.id,
                              name: template.name,
                              startTime: template.startTime,
                              endTime: template.endTime,
                              breakMinutes: String(template.breakMinutes),
                              active: template.active,
                            })
                          }
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => {
                            if (confirm(`ลบรูปแบบกะ “${template.name}”?`)) {
                              deleteTemplate.mutate({ id: template.id });
                            }
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {templateForm ? (
            <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="space-y-1 sm:col-span-2">
                  <Label>ชื่อกะ</Label>
                  <Input
                    value={templateForm.name}
                    onChange={event =>
                      setTemplateForm({
                        ...templateForm,
                        name: event.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>เริ่ม</Label>
                  <Input
                    type="time"
                    value={templateForm.startTime}
                    onChange={event =>
                      setTemplateForm({
                        ...templateForm,
                        startTime: event.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>เลิก</Label>
                  <Input
                    type="time"
                    value={templateForm.endTime}
                    onChange={event =>
                      setTemplateForm({
                        ...templateForm,
                        endTime: event.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>พัก (นาที)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={templateForm.breakMinutes}
                    onChange={event =>
                      setTemplateForm({
                        ...templateForm,
                        breakMinutes: event.target.value,
                      })
                    }
                  />
                </div>
                <label className="flex items-center gap-2 pt-6 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={templateForm.active}
                    onChange={event =>
                      setTemplateForm({
                        ...templateForm,
                        active: event.target.checked,
                      })
                    }
                  />
                  เปิดใช้งาน
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setTemplateForm(null)}>
                  ยกเลิก
                </Button>
                <Button
                  onClick={submitTemplate}
                  disabled={upsertTemplate.isPending}
                >
                  บันทึกรูปแบบกะ
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={() =>
                setTemplateForm({
                  name: "",
                  startTime: "08:00",
                  endTime: "17:00",
                  breakMinutes: "60",
                  active: true,
                })
              }
            >
              <Plus /> เพิ่มรูปแบบกะ
            </Button>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={staffForm != null}
        onOpenChange={open => !open && setStaffForm(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>เพิ่มพนักงาน</DialogTitle>
          </DialogHeader>
          {staffForm && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>ชื่อพนักงาน</Label>
                <Input
                  autoFocus
                  value={staffForm.name}
                  onChange={event =>
                    setStaffForm({ ...staffForm, name: event.target.value })
                  }
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>ชื่อผู้ใช้</Label>
                  <Input
                    value={staffForm.username}
                    onChange={event =>
                      setStaffForm({
                        ...staffForm,
                        username: event.target.value,
                      })
                    }
                    placeholder="อย่างน้อย 3 ตัวอักษร"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>PIN</Label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    value={staffForm.password}
                    onChange={event =>
                      setStaffForm({
                        ...staffForm,
                        password: event.target.value,
                      })
                    }
                    placeholder="อย่างน้อย 4 หลัก"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>สิทธิ์ใช้งาน</Label>
                <Select
                  value={staffForm.role}
                  onValueChange={(value: StaffForm["role"]) =>
                    setStaffForm({ ...staffForm, role: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cashier">พนักงานขาย</SelectItem>
                    <SelectItem value="manager">ผู้จัดการสาขา</SelectItem>
                    <SelectItem value="admin">ผู้ดูแลระบบ</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStaffForm(null)}>
              ยกเลิก
            </Button>
            <Button
              disabled={
                !staffForm?.name.trim() ||
                (staffForm?.username.length ?? 0) < 3 ||
                (staffForm?.password.length ?? 0) < 10 ||
                createStaff.isPending
              }
              onClick={() => staffForm && createStaff.mutate(staffForm)}
            >
              เพิ่มพนักงาน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={profileForm != null}
        onOpenChange={open => !open && setProfileForm(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>ข้อมูลพนักงาน · {profileForm?.name}</DialogTitle>
          </DialogHeader>
          {profileForm && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>ตำแหน่ง</Label>
                <Input
                  value={profileForm.position}
                  onChange={event =>
                    setProfileForm({
                      ...profileForm,
                      position: event.target.value,
                    })
                  }
                  placeholder="เช่น พนักงานหน้าลาน"
                />
              </div>
              <div className="space-y-1.5">
                <Label>รูปแบบค่าจ้าง</Label>
                <Select
                  value={profileForm.salaryType}
                  onValueChange={(value: SalaryType) =>
                    setProfileForm({ ...profileForm, salaryType: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(salaryTypeLabel).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>วันที่เริ่มงาน</Label>
                <Input
                  type="date"
                  value={profileForm.hireDate}
                  onChange={event =>
                    setProfileForm({
                      ...profileForm,
                      hireDate: event.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>อัตราหลัก (บาท)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={profileForm.baseRate}
                  onChange={event =>
                    setProfileForm({
                      ...profileForm,
                      baseRate: event.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>OT ต่อชั่วโมง (บาท)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={profileForm.overtimeRate}
                  onChange={event =>
                    setProfileForm({
                      ...profileForm,
                      overtimeRate: event.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>หมายเหตุ</Label>
                <Textarea
                  value={profileForm.note}
                  onChange={event =>
                    setProfileForm({ ...profileForm, note: event.target.value })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileForm(null)}>
              ยกเลิก
            </Button>
            <Button onClick={submitProfile} disabled={upsertProfile.isPending}>
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={payrollForm != null}
        onOpenChange={open => !open && setPayrollForm(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              แก้รายการเงินเดือน · {payrollForm?.staffName}
            </DialogTitle>
          </DialogHeader>
          {payrollForm && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>OT (ชั่วโมง)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={payrollForm.overtimeHours}
                  onChange={event =>
                    setPayrollForm({
                      ...payrollForm,
                      overtimeHours: event.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>โบนัส / เงินเพิ่ม</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={payrollForm.bonus}
                  onChange={event =>
                    setPayrollForm({
                      ...payrollForm,
                      bonus: event.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>รายการหัก</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={payrollForm.deduction}
                  onChange={event =>
                    setPayrollForm({
                      ...payrollForm,
                      deduction: event.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <Label>หมายเหตุ</Label>
                <Textarea
                  value={payrollForm.note}
                  onChange={event =>
                    setPayrollForm({ ...payrollForm, note: event.target.value })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayrollForm(null)}>
              ยกเลิก
            </Button>
            <Button onClick={submitPayroll} disabled={updatePayroll.isPending}>
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
