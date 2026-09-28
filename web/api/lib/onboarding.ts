import { TRPCError } from "@trpc/server";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  branches,
  employeeFaceProfiles,
  fuelTanks,
  nozzles,
  passkeyCredentials,
  paymentSettings,
  products,
  pumps,
  settings,
  shifts,
  staffBranches,
  staffUsers,
} from "@db/schema";
import {
  BUSINESS_SETUP_KEY,
  readSetupProgress,
  setupSystemInput,
  type BusinessSetupProgress,
  type BusinessSetupState,
  type BusinessSetupStep,
} from "@contracts/onboarding";
import { DEFAULT_SETTINGS } from "@contracts/settings";
import { getDb } from "../queries/connection";
import { env, isDevelopmentRuntime } from "./env";
import { FACE_MODEL } from "./faceBiometrics";
import { buildPromptPayPayload, extractMerchantBillInfo } from "./promptpay";

export type SetupDb = Pick<
  ReturnType<typeof getDb>,
  "select" | "insert" | "update" | "execute"
>;

export async function lockSetupBranch(db: SetupDb, branchId: number) {
  const [branch] = await db
    .select()
    .from(branches)
    .where(eq(branches.id, branchId))
    .for("update");
  if (!branch?.active) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "สาขานี้ยังไม่เปิดใช้งาน",
    });
  }
  return branch;
}

export async function writeSetupSettings(
  db: SetupDb,
  branchId: number,
  entries: Array<{ key: string; value: string }>
) {
  if (!entries.length) return;
  await db
    .insert(settings)
    .values(entries.map(entry => ({ ...entry, branchId })))
    .onConflictDoUpdate({
      target: [settings.branchId, settings.key],
      set: { value: sql`excluded.value` },
    });
}

export async function readProgress(
  db: SetupDb,
  branchId: number
): Promise<BusinessSetupProgress> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(
      and(eq(settings.branchId, branchId), eq(settings.key, BUSINESS_SETUP_KEY))
    );
  return readSetupProgress(row?.value);
}

export async function confirmProgress(
  db: SetupDb,
  branchId: number,
  step: BusinessSetupStep
) {
  const progress = await readProgress(db, branchId);
  progress.confirmed[step] = true;
  await writeSetupSettings(db, branchId, [
    { key: BUSINESS_SETUP_KEY, value: JSON.stringify(progress) },
  ]);
}

export function paymentReceiverReady(
  config:
    | { qrMode: string; promptpayId: string; merchantPayload: string | null }
    | undefined
): boolean {
  if (!config) return false;
  try {
    if (config.qrMode === "merchant") {
      if (!config.merchantPayload) return false;
      extractMerchantBillInfo(config.merchantPayload);
    } else {
      if (!config.promptpayId.trim()) return false;
      buildPromptPayPayload({ promptPayId: config.promptpayId, amount: 1 });
    }
    return true;
  } catch {
    return false;
  }
}

export function setupPasskeysAvailable(
  request: Request,
  configuration = { rpId: env.passkeyRpId, origin: env.passkeyOrigin }
): boolean {
  const rpId = configuration.rpId.toLowerCase();
  const originText = configuration.origin.replace(/\/+$/, "");
  if (
    !rpId ||
    !originText ||
    rpId.length > 253 ||
    !rpId
      .split(".")
      .every(
        label =>
          label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
      )
  )
    return false;
  try {
    const origin = new URL(originText);
    const requestOrigin = request.headers.get("origin");
    if (requestOrigin && requestOrigin !== origin.origin) return false;
    const referer = request.headers.get("referer");
    if (referer && new URL(referer).origin !== origin.origin) return false;
    return (
      originText === origin.origin &&
      (origin.hostname === rpId || origin.hostname.endsWith(`.${rpId}`)) &&
      (origin.protocol === "https:" ||
        (origin.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(origin.hostname)))
    );
  } catch {
    return false;
  }
}

export function setupStaffReadiness(
  input: {
    pin: string;
    active: boolean;
    currentOwner: boolean;
    hasAuthIdentity: boolean;
    hasCurrentFace: boolean;
    hasPasskey: boolean;
  },
  policy: {
    localSession: boolean;
    development: boolean;
    passkeysAvailable: boolean;
  }
) {
  const pinReady =
    /^staff-pin-hmac-v1:[A-Za-z0-9_-]{43}$/.test(input.pin) ||
    /^[a-f0-9]{64}$/i.test(input.pin) ||
    (policy.localSession &&
      /^local-scrypt-v1:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{43}$/.test(input.pin));
  const authReady = policy.localSession || input.hasAuthIdentity;
  const faceReady = input.hasCurrentFace;
  const loginReady =
    input.active &&
    (input.currentOwner ||
      (authReady &&
        ((pinReady && (faceReady || policy.development)) ||
          (input.hasPasskey && policy.passkeysAvailable))));
  return { pinReady, authReady, faceReady, loginReady };
}

export async function readBusinessSetupState(
  db: SetupDb,
  branchId: number,
  currentStaffId: number,
  request: Request
): Promise<BusinessSetupState> {
  const [
    [branch],
    settingRows,
    productRows,
    pumpRows,
    nozzleRows,
    tankRows,
    staffRows,
    [payment],
    [openShift],
  ] = await Promise.all([
    db.select().from(branches).where(eq(branches.id, branchId)),
    db.select().from(settings).where(eq(settings.branchId, branchId)),
    db
      .select()
      .from(products)
      .where(eq(products.branchId, branchId))
      .orderBy(products.id),
    db.select().from(pumps).where(eq(pumps.branchId, branchId)),
    db
      .select()
      .from(nozzles)
      .where(eq(nozzles.branchId, branchId))
      .orderBy(nozzles.id),
    db.select().from(fuelTanks).where(eq(fuelTanks.branchId, branchId)),
    db
      .select({
        id: staffUsers.id,
        name: staffUsers.name,
        username: staffUsers.username,
        role: staffUsers.role,
        active: staffUsers.active,
        pin: staffUsers.pin,
        authIdentity: staffUsers.supabaseAuthUserId,
        passkeyHandle: staffUsers.passkeyUserHandle,
      })
      .from(staffUsers)
      .leftJoin(staffBranches, eq(staffBranches.staffId, staffUsers.id))
      .where(
        or(
          eq(staffBranches.branchId, branchId),
          eq(staffUsers.id, currentStaffId)
        )
      ),
    db
      .select({
        qrMode: paymentSettings.qrMode,
        promptpayId: paymentSettings.promptpayId,
        merchantPayload: paymentSettings.merchantPayload,
        thungngernEnabled: paymentSettings.thungngernEnabled,
      })
      .from(paymentSettings)
      .where(eq(paymentSettings.branchId, branchId)),
    db
      .select({ id: shifts.id })
      .from(shifts)
      .where(and(eq(shifts.branchId, branchId), eq(shifts.status, "open")))
      .limit(1),
  ]);
  if (!branch)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "ไม่พบสาขาที่กำลังตั้งค่า",
    });
  const rawSettings = Object.fromEntries(
    settingRows.map(row => [row.key, row.value])
  );
  const currentSettings = { ...DEFAULT_SETTINGS, ...rawSettings };
  const progress = readSetupProgress(rawSettings[BUSINESS_SETUP_KEY]);
  const systemCandidate = {
    expectedBranchId: branchId,
    receiptPaperSize: currentSettings.receipt_paper_size,
    taxInvoicePaperSize: currentSettings.tax_invoice_paper_size,
    silentPrint: currentSettings.receipt_silent_print === "1",
    vatRate: Number(currentSettings.vat_rate),
    pointEarnPerBaht: Number(currentSettings.point_earn_per_baht),
    pointRedeemValue: Number(currentSettings.point_redeem_value),
  };
  const systemValidation = setupSystemInput.safeParse(systemCandidate);
  const positive = (value: number, fallback: string) =>
    Number.isFinite(value) && value > 0 && value <= 1_000_000
      ? value
      : Number(fallback);
  const systemSettings: BusinessSetupState["systemSettings"] = {
    receiptPaperSize: systemCandidate.receiptPaperSize === "58" ? "58" : "80",
    taxInvoicePaperSize:
      systemCandidate.taxInvoicePaperSize === "a5" ? "a5" : "a4",
    silentPrint: systemCandidate.silentPrint,
    vatRate:
      Number.isFinite(systemCandidate.vatRate) &&
      systemCandidate.vatRate >= 0 &&
      systemCandidate.vatRate <= 100
        ? systemCandidate.vatRate
        : Number(DEFAULT_SETTINGS.vat_rate),
    pointEarnPerBaht: positive(
      systemCandidate.pointEarnPerBaht,
      DEFAULT_SETTINGS.point_earn_per_baht
    ),
    pointRedeemValue: positive(
      systemCandidate.pointRedeemValue,
      DEFAULT_SETTINGS.point_redeem_value
    ),
  };
  const profile = {
    shopName: rawSettings.shop_name ?? "",
    branchName: rawSettings.shop_branch ?? branch.name,
    address: rawSettings.shop_address ?? branch.address,
    phone: rawSettings.shop_phone ?? branch.phone,
    taxId: rawSettings.tax_id ?? branch.taxId,
  };
  const uniqueStaff = [
    ...new Map(staffRows.map(row => [row.id, row])).values(),
  ];
  const staffIds = uniqueStaff.map(row => row.id);
  const [faces, passkeys] = staffIds.length
    ? await Promise.all([
        db
          .select({
            staffId: employeeFaceProfiles.staffId,
            model: employeeFaceProfiles.model,
          })
          .from(employeeFaceProfiles)
          .where(inArray(employeeFaceProfiles.staffId, staffIds)),
        db
          .select({ staffId: passkeyCredentials.staffId })
          .from(passkeyCredentials)
          .where(inArray(passkeyCredentials.staffId, staffIds)),
      ])
    : [[], []];
  const policy = {
    localSession: env.localAuthEnabled || env.isTest || isDevelopmentRuntime(),
    development: isDevelopmentRuntime(),
    passkeysAvailable: setupPasskeysAvailable(request),
  };
  const staff = uniqueStaff.map(row => ({
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    active: row.active,
    ...setupStaffReadiness(
      {
        pin: row.pin,
        active: row.active,
        currentOwner: row.id === currentStaffId && row.role === "admin",
        hasAuthIdentity: Boolean(row.authIdentity),
        hasCurrentFace: faces.some(
          face => face.staffId === row.id && face.model === FACE_MODEL
        ),
        hasPasskey:
          Boolean(row.passkeyHandle) &&
          passkeys.some(passkey => passkey.staffId === row.id),
      },
      policy
    ),
    isCurrentUser: row.id === currentStaffId,
  }));
  const equipment = nozzleRows.map(nozzle => {
    const product = productRows.find(row => row.id === nozzle.productId);
    const pump = pumpRows.find(row => row.id === nozzle.pumpId);
    const tank = tankRows.find(row => row.id === nozzle.tankId);
    const issues: string[] = [];
    if (!pump?.active) issues.push("ต้องผูกตู้จ่ายที่เปิดใช้งานในสาขานี้");
    if (
      !product?.active ||
      product.category !== "fuel" ||
      !Number.isFinite(product.price) ||
      !(product.price > 0)
    )
      issues.push("ต้องผูกสินค้าน้ำมันที่เปิดขายและมีราคามากกว่า 0");
    if (!tank || tank.productId !== nozzle.productId)
      issues.push("ต้องผูกถังชนิดน้ำมันเดียวกันในสาขานี้");
    if (
      tank &&
      (!Number.isFinite(tank.capacityLiters) ||
        !Number.isFinite(tank.currentLiters) ||
        !Number.isFinite(tank.lowAlertAt) ||
        !(tank.capacityLiters > 0) ||
        tank.currentLiters < 0 ||
        tank.currentLiters > tank.capacityLiters ||
        tank.lowAlertAt < 0 ||
        tank.lowAlertAt > tank.capacityLiters)
    )
      issues.push("ระดับน้ำมันหรือความจุถังไม่ถูกต้อง");
    if (
      !Number.isFinite(nozzle.currentMeter) ||
      !Number.isFinite(nozzle.currentMoney) ||
      nozzle.currentMeter < 0 ||
      nozzle.currentMoney < 0
    )
      issues.push("เลขมิเตอร์ L/P ต้องเป็นตัวเลขไม่ติดลบ");
    return {
      id: nozzle.id,
      label: nozzle.label,
      productId: nozzle.productId,
      productName: product?.name ?? "",
      pumpName: pump?.name ?? "",
      tankName: tank?.name ?? "",
      meter: nozzle.currentMeter,
      money: nozzle.currentMoney,
      currentLiters: tank?.currentLiters ?? 0,
      capacityLiters: tank?.capacityLiters ?? 0,
      lowAlertAt: tank?.lowAlertAt ?? 0,
      active: nozzle.active,
      valid: issues.length === 0,
      issues,
    };
  });
  const qrReady = paymentReceiverReady(payment);
  const payments: BusinessSetupState["payments"] = {
    cashEnabled: currentSettings.pay_cash_enabled !== "0",
    qrEnabled: currentSettings.pay_qr_enabled !== "0",
    cardEnabled: currentSettings.pay_card_enabled !== "0",
    creditEnabled: currentSettings.pay_credit_enabled !== "0",
    promptpayId: payment?.promptpayId ?? "",
    qrMode: payment?.qrMode === "merchant" ? "merchant" : "promptpay",
    hasMerchantQr: payment?.qrMode === "merchant" && qrReady,
    thungngernEnabled: payment?.thungngernEnabled ?? false,
    qrReady,
  };
  const profileIssues: string[] = [];
  if (!branch.active) profileIssues.push("สาขายังไม่เปิดใช้งาน");
  if (!profile.shopName.trim()) profileIssues.push("กรุณาระบุชื่อกิจการ");
  if (!profile.branchName.trim()) profileIssues.push("กรุณาระบุชื่อสาขา");
  const productIssues: string[] = [];
  if (
    !productRows.some(
      product =>
        product.active && Number.isFinite(product.price) && product.price > 0
    )
  )
    productIssues.push(
      "ต้องมีสินค้าที่เปิดขายและราคามากกว่า 0 อย่างน้อยหนึ่งรายการ"
    );
  const activeEquipment = equipment.filter(row => row.active);
  if (!activeEquipment.length)
    productIssues.push(
      "ต้องมีหัวจ่ายน้ำมันที่เปิดใช้งานอย่างน้อยหนึ่งหัวก่อนเปิดกะ"
    );
  for (const row of activeEquipment.filter(row => !row.valid))
    productIssues.push(`${row.label}: ${row.issues.join(" / ")}`);
  const staffIssues = staff.some(row => row.active && row.loginReady)
    ? []
    : ["ต้องมีผู้ใช้ที่พร้อมเข้าสู่ระบบอย่างน้อยหนึ่งคน"];
  const paymentIssues: string[] = [];
  if (!(
    payments.cashEnabled ||
    payments.qrEnabled ||
    payments.cardEnabled ||
    payments.creditEnabled
  ))
    paymentIssues.push("กรุณาเปิดช่องทางรับเงินอย่างน้อยหนึ่งช่องทาง");
  if (payments.qrEnabled && !payments.qrReady)
    paymentIssues.push("QR เปิดใช้งานอยู่ แต่ข้อมูลผู้รับเงินยังไม่พร้อม");
  const warnings = [
    ...staff
      .filter(row => row.active && !row.loginReady)
      .map(
        row =>
          `${row.name}: บัญชีนี้ยังไม่พร้อมเข้าสู่ระบบ กรุณาตรวจบัญชีและ PIN ในหน้าตั้งค่า แล้วลงทะเบียนใบหน้าหรือกุญแจผ่าน`
      ),
    ...tankRows
      .filter(row => row.currentLiters === 0)
      .map(row => `${row.name}: ถังไม่มีน้ำมันคงเหลือ กรุณาตรวจสต๊อกก่อนขาย`),
  ];
  return {
    branch: {
      id: branch.id,
      code: branch.code,
      name: branch.name,
      active: branch.active,
    },
    profile,
    products: productRows.map(
      ({ id, code, name, category, unit, price, cost, stockQty, active }) => ({
        id,
        code,
        name,
        category,
        unit,
        price,
        cost,
        stockQty,
        active,
      })
    ),
    equipment,
    staff,
    payments,
    progress,
    systemSettings,
    readiness: {
      profile: { ready: profileIssues.length === 0, issues: profileIssues },
      products: { ready: productIssues.length === 0, issues: productIssues },
      staff: { ready: staffIssues.length === 0, issues: staffIssues },
      payments: { ready: paymentIssues.length === 0, issues: paymentIssues },
      system: {
        ready: systemValidation.success,
        issues: systemValidation.success
          ? []
          : ["กรุณาตรวจค่าการพิมพ์ ภาษี และแต้มสมาชิก"],
      },
    },
    warnings,
    hasOpenShift: Boolean(openShift),
  };
}
