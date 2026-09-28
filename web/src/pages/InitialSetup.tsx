import { lazy, Suspense, useState, type FormEvent } from "react";
import { CheckCircle2, Droplet, LoaderCircle, ScanFace } from "lucide-react";
import type { InitialSetupState } from "@contracts/initialSetup";
import type { FaceCaptureResult } from "@/components/FaceCapture";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStaff } from "@/hooks/useStaff";
import { useDesktopSync } from "@/hooks/useDesktopSync";
import { trpc } from "@/providers/trpc";
import { isLocalAuthEnabled } from "@/lib/localAuth";
import { clearSupabaseSession, installSupabaseSession } from "@/lib/supabase";
import {
  initialOwnerInput,
  initialSetupErrorMessage,
  type InitialOwnerForm,
} from "@/lib/initialSetupEntry";

const FaceCapture = lazy(() =>
  import("@/components/FaceCapture").then(module => ({
    default: module.FaceCapture,
  }))
);

export default function InitialSetup({
  state,
  installationCode,
  onRefresh,
  onCompleted,
}: {
  state: InitialSetupState;
  installationCode: string;
  onRefresh: () => void;
  onCompleted: () => void;
}) {
  const { login } = useStaff();
  const { status } = useDesktopSync();
  const [requestId] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState<InitialOwnerForm>(() => ({
    name: "",
    username: "",
    pin: "",
    pinConfirmation: "",
    installationCode,
    consentConfirmed: false,
  }));
  const [working, setWorking] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState("");
  const createOwner = trpc.initialSetup.createOwner.useMutation({ gcTime: 0 });
  const offline = status?.online === false;
  const busy = working || capturing;
  const changeField = (
    key: "name" | "username" | "pin" | "pinConfirmation" | "installationCode",
    value: string
  ) => setForm(current => ({ ...current, [key]: value }));
  const finishCapture = (result: FaceCaptureResult) => {
    setCapturing(false);
    setForm(current =>
      current.consentConfirmed
        ? { ...current, embeddings: result.embeddings }
        : current
    );
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || offline) return;
    setError("");
    setWorking(true);
    let ownerCreated = false;
    let sessionInstalled = false;
    try {
      const input = initialOwnerInput(form, state, requestId);
      const result = await createOwner.mutateAsync(input);
      createOwner.reset();
      ownerCreated = true;
      if (result.authSession) {
        sessionInstalled = await installSupabaseSession(result.authSession);
        if (!sessionInstalled) throw new Error("เปิดเซสชันเจ้าของไม่สำเร็จ");
      } else if (!isLocalAuthEnabled || !result.sessionToken) {
        throw new Error("ยังไม่ได้รับเซสชันเจ้าของที่ยืนยันแล้ว");
      }
      window.sessionStorage.removeItem("pos:return-to");
      window.history.replaceState(null, "", "/setup");
      await login({
        ...result.staff,
        ...(result.sessionToken ? { sessionToken: result.sessionToken } : {}),
      });
      onCompleted();
      setForm(current => ({
        ...current,
        pin: "",
        pinConfirmation: "",
        installationCode: "",
        embeddings: undefined,
        consentConfirmed: false,
      }));
    } catch (failure) {
      if (sessionInstalled) await clearSupabaseSession();
      setError(
        ownerCreated
          ? "สร้างบัญชีเจ้าของแล้ว แต่เปิดเซสชันไม่สำเร็จ กดลองใหม่เพื่อเข้าเตรียมกิจการ"
          : initialSetupErrorMessage(failure, [
              form.installationCode,
              form.pin,
              form.pinConfirmation,
            ])
      );
    } finally {
      createOwner.reset();
      setWorking(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-xl space-y-5">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-blue-600 text-white">
            <Droplet className="size-6" />
          </span>
          <div>
            <p className="font-heading text-lg font-bold text-slate-900">
              PumpPOS
            </p>
            <p className="text-sm text-slate-600">เริ่มใช้งานกิจการครั้งแรก</p>
          </div>
        </div>
        <Card className="border-slate-200 bg-white">
          <CardHeader>
            <h1 className="font-heading text-2xl font-semibold text-slate-900">
              สร้างบัญชีเจ้าของกิจการ
            </h1>
            <p className="text-sm leading-6 text-slate-600">
              ตั้งชื่อผู้ใช้และ PIN ของคุณ แล้วไปเตรียมสาขา สินค้า ผู้ใช้งาน
              และการรับเงินต่อได้ทันที
            </p>
          </CardHeader>
          <CardContent>
            {state.checks?.some(
              check => check.key === "database" && check.status === "ready"
            ) &&
              state.checks.some(
                check => check.key === "schema" && check.status === "ready"
              ) && (
                <p className="mb-5 flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-sm leading-6 text-emerald-800">
                  <CheckCircle2 className="mt-1 size-4 shrink-0" />
                  <span>
                    เชื่อมต่อฐานข้อมูล
                    {state.databaseMode === "supabase"
                      ? " Supabase"
                      : state.databaseMode === "local"
                        ? "ในเครื่อง"
                        : ""}
                    และเตรียมโครงสร้างข้อมูลพร้อมแล้ว
                  </span>
                </p>
              )}
            {!state.canCreateOwner ? (
              <div className="space-y-4">
                <p
                  role="status"
                  className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700"
                >
                  ระบบใหม่ยังไม่พร้อมสร้างบัญชีเจ้าของ
                  กรุณาให้ผู้ให้บริการเตรียมระบบ แล้วกดตรวจสอบอีกครั้ง
                </p>
                <Button variant="outline" onClick={onRefresh}>
                  ตรวจสอบอีกครั้ง
                </Button>
              </div>
            ) : capturing ? (
              <Suspense
                fallback={
                  <p
                    role="status"
                    className="flex items-center gap-2 py-5 text-sm"
                  >
                    <LoaderCircle className="size-4 animate-spin" />{" "}
                    กำลังเตรียมกล้อง…
                  </p>
                }
              >
                <FaceCapture
                  mode="enroll"
                  onComplete={finishCapture}
                  onCancel={() => setCapturing(false)}
                />
              </Suspense>
            ) : (
              <form
                noValidate
                autoComplete="off"
                onSubmit={event => void submit(event)}
                className="space-y-5"
              >
                <fieldset
                  disabled={working}
                  className="grid gap-4 sm:grid-cols-2"
                >
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="initial-owner-name">
                      ชื่อเจ้าของกิจการ
                    </Label>
                    <Input
                      id="initial-owner-name"
                      value={form.name}
                      maxLength={120}
                      autoComplete="off"
                      onChange={event =>
                        changeField("name", event.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="initial-owner-username">ชื่อผู้ใช้</Label>
                    <Input
                      id="initial-owner-username"
                      value={form.username}
                      maxLength={64}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      onChange={event =>
                        changeField("username", event.target.value)
                      }
                    />
                    <p className="text-xs leading-5 text-slate-600">
                      อักษรอังกฤษหรือตัวเลข 3–64 ตัว ใช้จุด ขีดกลาง
                      และขีดล่างได้ เช่น owner
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="initial-owner-pin">PIN 4–6 หลัก</Label>
                    <Input
                      id="initial-owner-pin"
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      value={form.pin}
                      maxLength={6}
                      onChange={event => changeField("pin", event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="initial-owner-pin-confirm">
                      ยืนยัน PIN
                    </Label>
                    <Input
                      id="initial-owner-pin-confirm"
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      value={form.pinConfirmation}
                      maxLength={6}
                      onChange={event =>
                        changeField("pinConfirmation", event.target.value)
                      }
                    />
                  </div>
                  {state.requiresInstallationCode && (
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="initial-installation-code">
                        รหัสติดตั้งจากผู้ให้บริการ
                      </Label>
                      <Input
                        id="initial-installation-code"
                        type="password"
                        autoComplete="off"
                        value={form.installationCode}
                        maxLength={256}
                        onChange={event =>
                          changeField("installationCode", event.target.value)
                        }
                      />
                      <p className="text-xs leading-5 text-slate-600">
                        หากเปิดจากลิงก์ติดตั้ง ระบบกรอกรหัสนี้ให้แล้ว
                      </p>
                    </div>
                  )}
                </fieldset>
                {state.requiresFace && (
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <h2 className="font-semibold text-slate-900">
                      ลงทะเบียนใบหน้าของเจ้าของ
                    </h2>
                    <p className="text-sm leading-6 text-slate-600">
                      ใช้ใบหน้าร่วมกับ PIN เมื่อเข้าสู่ระบบครั้งถัดไป
                      ให้เจ้าของอยู่ต่อหน้ากล้องด้วยตนเอง
                    </p>
                    <label className="flex items-start gap-3 text-sm leading-6 text-slate-700">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0 accent-blue-600"
                        checked={form.consentConfirmed}
                        disabled={working}
                        onChange={event =>
                          setForm(current => ({
                            ...current,
                            consentConfirmed: event.target.checked,
                            embeddings: undefined,
                          }))
                        }
                      />
                      <span>
                        รับทราบและยินยอมให้เก็บข้อมูลใบหน้าที่เข้ารหัสเพื่อเข้าสู่ระบบ
                        ระบบไม่เก็บรูปภาพ และสามารถขอลบหรือลงทะเบียนใหม่ได้
                      </span>
                    </label>
                    {form.embeddings ? (
                      <p
                        role="status"
                        className="flex items-center gap-2 text-sm text-emerald-700"
                      >
                        <CheckCircle2 className="size-4" /> ตรวจใบหน้าแล้ว
                        พร้อมสร้างบัญชี
                      </p>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={working || !form.consentConfirmed}
                      onClick={() => {
                        setError("");
                        setCapturing(true);
                      }}
                    >
                      <ScanFace className="size-4" />
                      {form.embeddings
                        ? "ลงทะเบียนใบหน้าใหม่"
                        : "เปิดกล้องลงทะเบียน"}
                    </Button>
                  </div>
                )}
                {offline && (
                  <p
                    role="alert"
                    className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"
                  >
                    ยังเชื่อมต่อระบบไม่ได้ ต้องเชื่อมต่อก่อนสร้างบัญชีเจ้าของ
                    ข้อมูลในฟอร์มยังอยู่ในหน้านี้
                  </p>
                )}
                {error && (
                  <p
                    role="alert"
                    className="break-words rounded-xl bg-red-50 p-3 text-sm text-red-700"
                  >
                    {error}
                  </p>
                )}
                <p className="text-xs leading-5 text-slate-600">
                  จำชื่อผู้ใช้และ PIN ที่คุณตั้งไว้ เพื่อเข้าสู่ระบบภายหลัง
                </p>
                <Button
                  className="h-auto min-h-11 w-full whitespace-normal"
                  type="submit"
                  disabled={working || offline}
                >
                  {working && <LoaderCircle className="size-4 animate-spin" />}
                  {working
                    ? "กำลังสร้างบัญชีและเปิดระบบ…"
                    : "สร้างเจ้าของและตั้งค่ากิจการ"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
