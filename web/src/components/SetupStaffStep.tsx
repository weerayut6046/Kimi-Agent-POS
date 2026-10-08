import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, UserPlus, UserRoundCheck } from "lucide-react";
import type { BusinessSetupState } from "@contracts/onboarding";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  staffMutationErrorMessage,
  staffPinValidationMessage,
} from "@/pages/settingsForm";
import { trpc } from "@/providers/trpc";
import {
  emptySetupStaffForm,
  setupStaffCreateInput,
  setupStaffLoginStatus,
  type SetupStaffForm,
} from "./SetupStaffStep.form";

type Props = {
  state: BusinessSetupState;
  onChanged: () => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
};
const roleLabels = {
  admin: "ผู้ดูแลระบบ",
  manager: "ผู้จัดการ",
  cashier: "พนักงานขาย",
};

export default function SetupStaffStep({
  state,
  onChanged,
  onBusyChange,
}: Props) {
  // Replacing the branch unmounts PIN fields.
  return (
    <SetupStaffStepContent
      key={state.branch.id}
      state={state}
      onChanged={onChanged}
      onBusyChange={onBusyChange}
    />
  );
}

function SetupStaffStepContent({ state, onChanged, onBusyChange }: Props) {
  const [form, setForm] = useState(() => emptySetupStaffForm(state.branch.id));
  const [adding, setAdding] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [createdAccount, setCreatedAccount] = useState<{
    branchId: number;
    username: string;
  } | null>(null);
  // Remove completed mutation variables promptly: they contain a PIN.
  const createStaff = trpc.auth.createStaff.useMutation({ gcTime: 0 });

  useEffect(() => {
    onBusyChange?.(working);
    return () => onBusyChange?.(false);
  }, [onBusyChange, working]);

  const currentStaff = state.staff.find(staff => staff.isCurrentUser);
  const createdUsername =
    createdAccount?.branchId === state.branch.id
      ? createdAccount.username
      : null;
  const createdStaff = state.staff.find(
    staff => staff.username === createdUsername
  );
  const pinError = form.pin ? staffPinValidationMessage(form.pin) : null;

  function changeField<K extends keyof SetupStaffForm>(
    field: K,
    value: SetupStaffForm[K]
  ) {
    setForm(current => ({ ...current, [field]: value }));
    setError("");
  }

  function closeForm() {
    setForm(emptySetupStaffForm(state.branch.id));
    setAdding(false);
    setError("");
  }

  async function addStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    let input: ReturnType<typeof setupStaffCreateInput>;
    try {
      input = setupStaffCreateInput(form, state.branch);
    } catch (cause) {
      setError(staffMutationErrorMessage(cause));
      return;
    }
    setWorking(true);
    setError("");
    let created = false;
    try {
      await createStaff.mutateAsync(input);
      createStaff.reset();
      created = true;
      setCreatedAccount({
        branchId: state.branch.id,
        username: input.username,
      });
      closeForm();
      await onChanged();
    } catch (cause) {
      setError(
        created
          ? "สร้างบัญชีแล้ว แต่โหลดสถานะล่าสุดไม่สำเร็จ กรุณากดโหลดสถานะอีกครั้งก่อนเพิ่มบัญชีใหม่"
          : staffMutationErrorMessage(cause)
      );
    } finally {
      createStaff.reset();
      setWorking(false);
    }
  }

  async function refreshState() {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      await onChanged();
    } catch {
      setError("โหลดสถานะพนักงานไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setWorking(false);
    }
  }

  function staffRow(staff: BusinessSetupState["staff"][number]) {
    const status = setupStaffLoginStatus(staff);
    return (
      <div
        key={staff.id}
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4"
      >
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">
            {staff.name}
            {staff.isCurrentUser && " · บัญชีของคุณ"}
          </p>
          <p className="mt-1 break-all text-sm text-slate-600">
            {staff.username} · {roleLabels[staff.role]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={
              status.ready
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }
          >
            {status.label}
          </Badge>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5" aria-busy={working}>
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="flex items-center gap-2 font-semibold text-emerald-900">
          <UserRoundCheck className="size-5" /> ใช้บัญชีเจ้าของขายเองได้
        </p>
        <p className="mt-2 text-sm leading-6 text-emerald-900/80">
          {currentStaff?.active && currentStaff.loginReady
            ? "หากคุณขายเอง ใช้บัญชีที่กำลังเข้าสู่ระบบและไปขั้นถัดไปได้ การเพิ่มพนักงานเป็นทางเลือก"
            : "ตรวจสอบสถานะบัญชีที่ใช้อยู่ด้านล่าง ก่อนเริ่มขาย สามารถเพิ่มพนักงานภายหลังได้"}
        </p>
      </div>

      <div className="space-y-3">
        {currentStaff && staffRow(currentStaff)}
        {state.staff.filter(staff => !staff.isCurrentUser).map(staffRow)}
      </div>

      {createdUsername && (
        <div
          role="status"
          className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-900"
        >
          <p className="font-semibold">สร้างบัญชี {createdUsername} แล้ว</p>
          <p>
            {createdStaff
              ? `${createdStaff.name} · ${setupStaffLoginStatus(createdStaff).label}`
              : "กดโหลดสถานะล่าสุดเพื่อตรวจสอบว่าบัญชีพร้อมเข้าสู่ระบบหรือยัง"}
          </p>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      {!adding ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={working || !state.branch.active}
            onClick={() => {
              setForm(emptySetupStaffForm(state.branch.id));
              setAdding(true);
              setError("");
            }}
          >
            <UserPlus /> เพิ่มพนักงาน (ไม่บังคับ)
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={working}
            onClick={() => void refreshState()}
          >
            {working && <LoaderCircle className="animate-spin" />}{" "}
            โหลดสถานะล่าสุด
          </Button>
        </div>
      ) : (
        <form
          onSubmit={event => void addStaff(event)}
          noValidate
          className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5"
        >
          <div>
            <h3 className="font-semibold text-slate-900">
              เพิ่มพนักงานที่ {state.branch.name}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              สร้างบัญชีส่วนตัวเพื่อให้รู้ว่าใครเป็นผู้ทำรายการ
              แจ้งชื่อผู้ใช้และ PIN ให้พนักงานโดยตรง
            </p>
          </div>
          <fieldset disabled={working} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="setup-staff-name">ชื่อพนักงาน</Label>
              <Input
                id="setup-staff-name"
                value={form.name}
                maxLength={120}
                autoComplete="off"
                onChange={event => changeField("name", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-staff-username">ชื่อผู้ใช้</Label>
              <Input
                id="setup-staff-username"
                value={form.username}
                maxLength={64}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby="setup-staff-username-help"
                onChange={event => changeField("username", event.target.value)}
              />
              <p
                id="setup-staff-username-help"
                className="text-xs leading-5 text-slate-600"
              >
                อักษรอังกฤษหรือตัวเลข 3–64 ตัว ใช้จุด ขีดกลาง และขีดล่างได้
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-staff-pin">PIN 4–6 หลัก</Label>
              <Input
                id="setup-staff-pin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={form.pin}
                maxLength={6}
                aria-invalid={Boolean(pinError)}
                aria-describedby={
                  pinError ? "setup-staff-pin-error" : undefined
                }
                onChange={event => changeField("pin", event.target.value)}
              />
              {pinError && (
                <p id="setup-staff-pin-error" className="text-xs text-red-700">
                  {pinError}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-staff-pin-confirm">ยืนยัน PIN</Label>
              <Input
                id="setup-staff-pin-confirm"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={form.pinConfirmation}
                maxLength={6}
                aria-invalid={Boolean(
                  form.pinConfirmation && form.pin !== form.pinConfirmation
                )}
                onChange={event =>
                  changeField("pinConfirmation", event.target.value)
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="setup-staff-role">หน้าที่</Label>
              <select
                id="setup-staff-role"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                value={form.role}
                onChange={event =>
                  changeField(
                    "role",
                    event.target.value as SetupStaffForm["role"]
                  )
                }
              >
                <option value="cashier">พนักงานขาย</option>
                <option value="manager">ผู้จัดการ</option>
              </select>
              <p className="text-xs leading-5 text-slate-600">
                ใช้สิทธิ์เริ่มต้นตามหน้าที่
                สามารถปรับสิทธิ์เพิ่มเติมในตั้งค่าพนักงานได้ภายหลัง
              </p>
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={working || !state.branch.active}>
              {working ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <UserPlus />
              )}{" "}
              {working ? "กำลังสร้างบัญชี…" : "สร้างบัญชีพนักงาน"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={working}
              onClick={closeForm}
            >
              ยกเลิก
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
