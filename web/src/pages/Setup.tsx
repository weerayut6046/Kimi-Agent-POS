import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft, ArrowRight, Check, LoaderCircle } from "lucide-react";
import {
  BUSINESS_SETUP_STEPS,
  setupPaymentsInput,
  setupProfileInput,
  type BusinessSetupProfile,
  type BusinessSetupState,
  type BusinessSetupStep,
} from "@contracts/onboarding";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import SetupStaffStep from "@/components/SetupStaffStep";
import SetupProductsStep from "./SetupProductsStep";
import SetupSystemStep from "./SetupSystemStep";
import { setupSystemDraft, setupSystemSaveInput } from "./setupSystemForm";
import { setupErrorMessage } from "./setupForm";
import { fmtDateTime } from "@/lib/format";

type WizardStep = BusinessSetupStep | "review";
const steps: Array<{ key: WizardStep; label: string }> = [
  { key: "profile", label: "กิจการและสาขา" },
  { key: "products", label: "สินค้าและหัวจ่าย" },
  { key: "staff", label: "ผู้ใช้งาน" },
  { key: "payments", label: "รับเงิน" },
  { key: "system", label: "ใบเสร็จและการใช้งาน" },
  { key: "review", label: "ตรวจและเริ่มงาน" },
];
const methods = [
  {
    key: "cashEnabled",
    label: "เงินสด",
    help: "เริ่มได้ด้วยเงินสด พร้อมนับเงินเปิดและปิดกะ",
  },
  {
    key: "qrEnabled",
    label: "โอนจ่าย / QR",
    help: "ตรวจบัญชีรับเงินและวิธียืนยันยอดให้พร้อม",
  },
  {
    key: "cardEnabled",
    label: "บัตร",
    help: "ใช้เมื่อมีเครื่องรับบัตรพร้อมแล้ว",
  },
  {
    key: "creditEnabled",
    label: "เครดิต",
    help: "ใช้เมื่อขายเชื่อและติดตามลูกหนี้",
  },
] as const;

export default function Setup() {
  const query = trpc.onboarding.state.useQuery(undefined, {
    staleTime: 15_000,
  });
  const { refetch } = query;
  const refresh = useCallback(async () => {
    const result = await refetch();
    if (result.error) throw result.error;
  }, [refetch]);

  if (!query.data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="font-heading text-2xl font-semibold">
          เตรียมกิจการก่อนเริ่มขาย
        </h1>
        {query.isPending ? (
          <p
            role="status"
            className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"
          >
            <LoaderCircle className="size-4 animate-spin" />{" "}
            กำลังโหลดข้อมูลสาขา…
          </p>
        ) : (
          <div role="alert" className="mt-5 space-y-3">
            <p className="text-sm text-destructive">
              {setupErrorMessage(query.error)}
            </p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              ลองโหลดใหม่
            </Button>
          </div>
        )}
      </div>
    );
  }
  return (
    <SetupWizard
      key={query.data.branch.id}
      state={query.data}
      onChanged={refresh}
      refreshError={query.error ? setupErrorMessage(query.error) : null}
    />
  );
}

function SetupWizard({
  state,
  onChanged,
  refreshError,
}: {
  state: BusinessSetupState;
  onChanged: () => Promise<void>;
  refreshError: string | null;
}) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [step, setStep] = useState<WizardStep>(
    () =>
      BUSINESS_SETUP_STEPS.find(key => !state.progress.confirmed[key]) ??
      "review"
  );
  const [profile, setProfile] = useState<BusinessSetupProfile>(() => ({
    ...state.profile,
  }));
  const [payments, setPayments] = useState(() => ({
    cashEnabled: state.payments.cashEnabled,
    qrEnabled: state.payments.qrEnabled,
    cardEnabled: state.payments.cardEnabled,
    creditEnabled: state.payments.creditEnabled,
    promptpayId: state.payments.promptpayId,
  }));
  const [initialPromptpayId] = useState(state.payments.promptpayId);
  const [system, setSystem] = useState(() =>
    setupSystemDraft(state.systemSettings)
  );
  const [reviewed, setReviewed] = useState({
    profile: false,
    products: false,
    payments: false,
    system: false,
  });
  const [working, setWorking] = useState(false);
  const [childBusy, setChildBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const saveProfile = trpc.onboarding.saveProfile.useMutation();
  const savePayments = trpc.onboarding.savePayments.useMutation();
  const saveSystem = trpc.onboarding.saveSystemSettings.useMutation();
  const confirmStep = trpc.onboarding.confirmStep.useMutation();
  const complete = trpc.onboarding.complete.useMutation();
  const busy = working || childBusy;
  const index = steps.findIndex(item => item.key === step);
  const confirmedCount = BUSINESS_SETUP_STEPS.filter(
    key => state.progress.confirmed[key]
  ).length;
  const readyToComplete =
    state.branch.active &&
    BUSINESS_SETUP_STEPS.every(
      key => state.progress.confirmed[key] && state.readiness[key].ready
    );
  const updateProfile = (field: keyof BusinessSetupProfile, value: string) => {
    setProfile(current => ({ ...current, [field]: value }));
    setReviewed(current => ({ ...current, profile: false }));
  };
  const switchStep = (next: WizardStep) => {
    if (busy) return;
    setError("");
    setNotice("");
    setStep(next);
  };
  const reload = async () => {
    if (busy) return;
    setWorking(true);
    try {
      await onChanged();
      setError("");
    } catch (failure) {
      setError(setupErrorMessage(failure));
    } finally {
      setWorking(false);
    }
  };
  const saveAndContinue = async () => {
    if (busy || step === "review" || !state.branch.active) return;
    setError("");
    setNotice("");
    setWorking(true);
    let saved = false;
    try {
      if (step === "profile") {
        if (!reviewed.profile)
          throw new Error("กรุณาตรวจข้อมูลกิจการและเลือกยืนยันด้านล่าง");
        const input = setupProfileInput.safeParse({
          ...profile,
          expectedBranchId: state.branch.id,
        });
        if (!input.success)
          throw new Error(
            input.error.issues[0]?.message ?? "ตรวจข้อมูลกิจการอีกครั้ง"
          );
        await saveProfile.mutateAsync(input.data);
        saved = true;
        await Promise.all([
          utils.auth.currentStaff.invalidate(),
          utils.catalog.getSettings.invalidate(),
        ]);
      } else if (step === "payments") {
        if (!reviewed.payments)
          throw new Error("กรุณาตรวจช่องทางรับเงินและเลือกยืนยันด้านล่าง");
        const input = setupPaymentsInput.safeParse({
          expectedBranchId: state.branch.id,
          cashEnabled: payments.cashEnabled,
          qrEnabled: payments.qrEnabled,
          cardEnabled: payments.cardEnabled,
          creditEnabled: payments.creditEnabled,
          ...(state.payments.qrMode === "promptpay" &&
          payments.promptpayId !== initialPromptpayId
            ? { promptpayId: payments.promptpayId }
            : {}),
        });
        if (!input.success)
          throw new Error(
            input.error.issues[0]?.message ?? "ตรวจช่องทางรับเงินอีกครั้ง"
          );
        await savePayments.mutateAsync(input.data);
        saved = true;
      } else if (step === "system") {
        if (!reviewed.system)
          throw new Error("กรุณาตรวจใบเสร็จ ภาษี และแต้มสมาชิกก่อนยืนยัน");
        const input = setupSystemSaveInput(system, state.branch.id);
        await saveSystem.mutateAsync(input);
        saved = true;
        await utils.catalog.getSettings.invalidate();
      } else {
        if (step === "products" && !reviewed.products)
          throw new Error("กรุณาตรวจสินค้า ถัง และเลข L/P จริงก่อนยืนยัน");
        await confirmStep.mutateAsync({
          step,
          expectedBranchId: state.branch.id,
        });
        saved = true;
      }
      setNotice("บันทึกและยืนยันขั้นตอนแล้ว");
      await onChanged();
      setStep(steps[index + 1].key);
    } catch (failure) {
      setError(
        saved
          ? "บันทึกแล้ว แต่โหลดสถานะล่าสุดไม่สำเร็จ กรุณากดโหลดสถานะใหม่ก่อนทำต่อ"
          : setupErrorMessage(failure)
      );
    } finally {
      setWorking(false);
    }
  };
  const finish = async () => {
    if (busy || !readyToComplete) return;
    setWorking(true);
    setError("");
    let saved = false;
    try {
      await complete.mutateAsync({ expectedBranchId: state.branch.id });
      saved = true;
      await onChanged();
      navigate("/shifts");
    } catch (failure) {
      setError(
        saved
          ? "บันทึกการเตรียมกิจการแล้ว แต่โหลดสถานะล่าสุดไม่สำเร็จ กดโหลดสถานะใหม่แล้วไปหน้าเปิดกะได้"
          : setupErrorMessage(failure)
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <div
      className="mx-auto max-w-5xl space-y-5 px-3 py-5 sm:px-6 sm:py-8"
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">
            เตรียมกิจการก่อนเริ่มขาย
          </h1>
          <p className="mt-2 break-words text-sm text-muted-foreground">
            สาขา {state.branch.name} · ตรวจทีละขั้น บันทึกแล้วกลับมาทำต่อได้
          </p>
        </div>
        <Badge variant="secondary">
          ยืนยันแล้ว {confirmedCount} / {BUSINESS_SETUP_STEPS.length} ขั้น
        </Badge>
      </div>
      {!state.branch.active && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          สาขานี้พักใช้งานอยู่ ต้องเปิดใช้งานสาขาก่อนบันทึกและเริ่มงาน
        </p>
      )}
      {(refreshError || error) && (
        <div
          role="alert"
          className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
        >
          <p className="break-words text-sm text-destructive">
            {error || `โหลดสถานะล่าสุดไม่สำเร็จ: ${refreshError}`}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void reload()}
          >
            โหลดสถานะใหม่
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm text-primary">
          {notice}
        </p>
      )}
      <nav
        aria-label="ขั้นตอนเตรียมกิจการ"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
      >
        {steps.map((item, position) => (
          <button
            key={item.key}
            type="button"
            aria-current={step === item.key ? "step" : undefined}
            disabled={busy}
            onClick={() => switchStep(item.key)}
            className={`flex min-h-14 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors disabled:opacity-60 ${step === item.key ? "border-primary bg-primary/10 text-primary" : "bg-card hover:bg-muted"}`}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs">
              {item.key !== "review" && state.progress.confirmed[item.key] ? (
                <Check className="size-3.5" />
              ) : (
                position + 1
              )}
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <Card>
        <CardContent className="space-y-5 p-4 sm:p-6">
          {step === "profile" && (
            <div className="space-y-5">
              <div>
                <h2 className="font-heading text-lg font-semibold">
                  ชื่อกิจการและข้อมูลสาขา
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  ข้อมูลที่มีอยู่เป็นค่าเริ่มต้น
                  กรุณาตรวจและแก้เป็นข้อมูลจริงของคุณก่อนยืนยัน
                </p>
              </div>
              <fieldset
                disabled={busy || !state.branch.active}
                className="grid gap-4 sm:grid-cols-2"
              >
                <div className="space-y-2">
                  <Label htmlFor="setup-shop-name">ชื่อกิจการ *</Label>
                  <Input
                    id="setup-shop-name"
                    value={profile.shopName}
                    maxLength={160}
                    onChange={event =>
                      updateProfile("shopName", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setup-branch-name">ชื่อสาขา *</Label>
                  <Input
                    id="setup-branch-name"
                    value={profile.branchName}
                    maxLength={120}
                    onChange={event =>
                      updateProfile("branchName", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="setup-address">ที่อยู่กิจการ</Label>
                  <Textarea
                    id="setup-address"
                    value={profile.address}
                    maxLength={500}
                    onChange={event =>
                      updateProfile("address", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setup-phone">เบอร์โทรศัพท์</Label>
                  <Input
                    id="setup-phone"
                    type="tel"
                    value={profile.phone}
                    maxLength={40}
                    onChange={event =>
                      updateProfile("phone", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setup-tax-id">
                    เลขประจำตัวผู้เสียภาษี (ถ้ามี)
                  </Label>
                  <Input
                    id="setup-tax-id"
                    inputMode="numeric"
                    value={profile.taxId}
                    maxLength={30}
                    onChange={event =>
                      updateProfile("taxId", event.target.value)
                    }
                  />
                </div>
              </fieldset>
              <label className="flex min-h-11 items-start gap-3 rounded-xl bg-muted/50 p-3 text-sm leading-6">
                <Checkbox
                  className="mt-1"
                  checked={reviewed.profile}
                  disabled={busy || !state.branch.active}
                  onCheckedChange={value =>
                    setReviewed(current => ({
                      ...current,
                      profile: value === true,
                    }))
                  }
                />
                <span>ตรวจแล้วว่าเป็นชื่อและข้อมูลจริงของกิจการ</span>
              </label>
            </div>
          )}
          {step === "products" && (
            <div className="space-y-5">
              <p className="rounded-xl bg-muted/50 p-4 text-sm leading-6">
                สินค้าหรือเลขมิเตอร์ที่ระบบเตรียมไว้ยังต้องตรวจจากหน้างาน
                ตรวจราคาจริง ระดับน้ำมัน และเลขสะสม L/P ทุกหัวจ่ายก่อนยืนยัน
              </p>
              <SetupProductsStep
                state={state}
                onChanged={async () => {
                  setReviewed(current => ({ ...current, products: false }));
                  await onChanged();
                }}
                onBusyChange={setChildBusy}
              />
              <label className="flex min-h-11 items-start gap-3 rounded-xl bg-muted/50 p-3 text-sm leading-6">
                <Checkbox
                  className="mt-1"
                  checked={reviewed.products}
                  disabled={busy || !state.branch.active}
                  onCheckedChange={value =>
                    setReviewed(current => ({
                      ...current,
                      products: value === true,
                    }))
                  }
                />
                <span>ตรวจสินค้า ถัง และเลขมิเตอร์ L/P จริงแล้ว</span>
              </label>
            </div>
          )}
          {step === "staff" && (
            <SetupStaffStep
              state={state}
              onChanged={onChanged}
              onBusyChange={setChildBusy}
            />
          )}
          {step === "payments" && (
            <div className="space-y-5">
              <div>
                <h2 className="font-heading text-lg font-semibold">
                  เลือกรับเงินที่ใช้งานจริง
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  เริ่มด้วยเงินสดได้ ช่องทางอื่นเปิดเมื่อพร้อมใช้งาน
                  ตรวจตัวเลือกเดิมก่อนยืนยัน
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {methods.map(method => (
                  <label
                    key={method.key}
                    className="flex items-start gap-3 rounded-xl border p-4"
                  >
                    <Checkbox
                      className="mt-1"
                      checked={payments[method.key]}
                      disabled={busy || !state.branch.active}
                      onCheckedChange={value => {
                        setPayments(current => ({
                          ...current,
                          [method.key]: value === true,
                        }));
                        setReviewed(current => ({
                          ...current,
                          payments: false,
                        }));
                      }}
                    />
                    <span>
                      <span className="font-medium">{method.label}</span>
                      <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                        {method.help}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {state.payments.qrMode === "promptpay" ? (
                <div className="space-y-2">
                  <Label htmlFor="setup-promptpay">
                    เบอร์โทร / เลขผู้เสียภาษีที่ผูกพร้อมเพย์
                  </Label>
                  <Input
                    id="setup-promptpay"
                    inputMode="numeric"
                    value={payments.promptpayId}
                    maxLength={20}
                    disabled={
                      busy || !payments.qrEnabled || !state.branch.active
                    }
                    onChange={event => {
                      setPayments(current => ({
                        ...current,
                        promptpayId: event.target.value,
                      }));
                      setReviewed(current => ({ ...current, payments: false }));
                    }}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    ใช้บัญชีที่ผูกพร้อมเพย์จริง
                    ตรวจผู้รับและทดสอบรับเงินก่อนใช้งาน
                  </p>
                </div>
              ) : (
                <p className="rounded-xl bg-muted/50 p-4 text-sm leading-6">
                  สาขานี้ใช้ QR ร้านค้า
                  การตั้งค่าผู้ให้บริการอยู่ในหน้าตั้งค่าขั้นสูง
                </p>
              )}
              {payments.qrEnabled &&
                !state.payments.qrReady &&
                payments.promptpayId === initialPromptpayId && (
                  <p className="text-sm text-destructive">
                    QR เดิมยังไม่พร้อม ตรวจบัญชีรับเงิน หรือเลือกปิด QR
                    ด้วยตนเองก่อนยืนยัน
                  </p>
                )}
              {state.payments.thungngernEnabled && (
                <p className="text-sm text-muted-foreground">
                  QR ถุงเงินมีการตั้งค่าอยู่แล้ว ตรวจรายละเอียดได้ในหน้าตั้งค่า
                </p>
              )}
              <Link
                to="/settings"
                className="inline-block text-sm text-primary underline underline-offset-4"
              >
                ตั้งค่าการรับเงินขั้นสูง
              </Link>
              <label className="flex min-h-11 items-start gap-3 rounded-xl bg-muted/50 p-3 text-sm leading-6">
                <Checkbox
                  className="mt-1"
                  checked={reviewed.payments}
                  disabled={busy || !state.branch.active}
                  onCheckedChange={value =>
                    setReviewed(current => ({
                      ...current,
                      payments: value === true,
                    }))
                  }
                />
                <span>ตรวจช่องทางรับเงินและบัญชีผู้รับแล้ว</span>
              </label>
            </div>
          )}
          {step === "system" && (
            <div className="space-y-5">
              <SetupSystemStep
                value={system}
                disabled={busy || !state.branch.active}
                onChange={value => {
                  setSystem(value);
                  setReviewed(current => ({ ...current, system: false }));
                }}
              />
              <label className="flex min-h-11 items-start gap-3 rounded-xl bg-muted/50 p-3 text-sm leading-6">
                <Checkbox
                  className="mt-1"
                  checked={reviewed.system}
                  disabled={busy || !state.branch.active}
                  onCheckedChange={value =>
                    setReviewed(current => ({
                      ...current,
                      system: value === true,
                    }))
                  }
                />
                <span>ตรวจใบเสร็จ ภาษี และแต้มสมาชิกแล้ว</span>
              </label>
            </div>
          )}
          {step === "review" && (
            <div className="space-y-5">
              <div>
                <h2 className="font-heading text-lg font-semibold">
                  ตรวจความพร้อมก่อนเปิดกะ
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  ยืนยันครบทุกขั้นและแก้รายการที่ยังไม่พร้อม
                  แล้วไปเปิดกะด้วยข้อมูลจริง
                </p>
              </div>
              {state.progress.completedAt && (
                <p className="rounded-xl bg-muted/50 p-3 text-sm">
                  เคยเตรียมกิจการเสร็จเมื่อ{" "}
                  {fmtDateTime(state.progress.completedAt)} ·
                  รายการด้านล่างตรวจจากสถานะปัจจุบัน
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {BUSINESS_SETUP_STEPS.map(key => (
                  <div key={key} className="space-y-3 rounded-xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="font-medium">
                        {steps.find(item => item.key === key)?.label}
                      </h3>
                      <Badge
                        variant={
                          state.readiness[key].ready &&
                          state.progress.confirmed[key]
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {!state.readiness[key].ready
                          ? "ต้องตรวจแก้"
                          : state.progress.confirmed[key]
                            ? "ยืนยันแล้ว"
                            : "รอยืนยัน"}
                      </Badge>
                    </div>
                    <p className="break-words text-sm text-muted-foreground">
                      {key === "profile"
                        ? `${state.profile.shopName} · ${state.branch.name}`
                        : key === "products"
                          ? `${state.products.filter(item => item.active).length} สินค้าขายอยู่ · ${state.equipment.filter(item => item.active).length} หัวจ่าย`
                          : key === "staff"
                            ? `${state.staff.filter(item => item.active && item.loginReady).length} บัญชีพร้อมเข้าสู่ระบบ`
                            : key === "system"
                              ? `ใบเสร็จ ${state.systemSettings.receiptPaperSize} มม. · ใบกำกับ ${state.systemSettings.taxInvoicePaperSize.toUpperCase()} · พิมพ์ทันที ${state.systemSettings.silentPrint ? "เปิด" : "ปิด"} · VAT ${state.systemSettings.vatRate}% · ${state.systemSettings.pointEarnPerBaht} บาท / 1 แต้ม · ใช้แต้มละ ${state.systemSettings.pointRedeemValue} บาท`
                              : methods
                                  .filter(item => state.payments[item.key])
                                  .map(item => item.label)
                                  .join(" · ")}
                    </p>
                    {!!state.readiness[key].issues.length && (
                      <ul className="list-inside list-disc text-sm text-destructive">
                        {state.readiness[key].issues.map(issue => (
                          <li key={issue}>{issue}</li>
                        ))}
                      </ul>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => switchStep(key)}
                    >
                      กลับไปตรวจ
                    </Button>
                  </div>
                ))}
              </div>
              {!!state.warnings.length && (
                <div className="rounded-xl bg-muted/50 p-4">
                  <p className="font-medium">รายการที่ควรตรวจเพิ่มเติม</p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted-foreground">
                    {state.warnings.map(warning => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-sm leading-6 text-muted-foreground">
                เมื่อจบการเตรียมกิจการ ระบบจะพาไปหน้าเปิดกะ ให้กรอกเลข L/P
                และเงินทอนจริงก่อนเริ่มขาย
              </p>
              {!readyToComplete && (
                <p className="text-sm text-destructive">
                  ยังเริ่มงานไม่ได้ ตรวจและยืนยันทั้ง{" "}
                  {BUSINESS_SETUP_STEPS.length} ขั้นให้ครบก่อน
                </p>
              )}
            </div>
          )}
          {step !== "review" && !!state.readiness[step].issues.length && (
            <div className="rounded-xl border border-destructive/20 p-4">
              <p className="text-sm font-medium">
                รายการที่ต้องพร้อมก่อนยืนยัน
              </p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-destructive">
                {state.readiness[step].issues.map(issue => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
            <Button
              variant="outline"
              disabled={busy || index === 0}
              onClick={() => switchStep(steps[index - 1].key)}
            >
              <ArrowLeft className="size-4" /> ย้อนกลับ
            </Button>
            {step === "review" ? (
              <Button
                disabled={busy || !readyToComplete}
                onClick={() => void finish()}
              >
                {working ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                {working ? "กำลังบันทึก…" : "เตรียมเสร็จ ไปเปิดกะ"}
              </Button>
            ) : (
              <Button
                disabled={busy || !state.branch.active}
                onClick={() => void saveAndContinue()}
              >
                {working ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ArrowRight className="size-4" />
                )}
                {working
                  ? "กำลังบันทึก…"
                  : step === "staff"
                    ? "ยืนยันผู้ใช้งานและถัดไป"
                    : "บันทึกและยืนยัน ถัดไป"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <p>ข้อมูลที่บันทึกสำเร็จแล้วจะอยู่ในระบบ แม้ออกจากหน้านี้</p>
        <Button asChild variant="ghost" disabled={busy}>
          <Link
            to="/"
            onClick={event => {
              if (busy) event.preventDefault();
            }}
          >
            กลับหลังบ้าน
          </Link>
        </Button>
      </div>
    </div>
  );
}
