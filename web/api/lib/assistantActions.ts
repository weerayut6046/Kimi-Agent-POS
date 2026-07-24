import { createHash, timingSafeEqual } from "crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import {
  assistantActionProposals,
  customers,
  debtPayments,
  expenses,
  fuelTanks,
  members,
  products,
  rewards,
  sales,
  staffUsers,
} from "@db/schema";
import type {
  MenuPermissionKey,
  StaffRole,
} from "@contracts/menuPermissions";
import type { AssistantAction } from "@contracts/assistant";
import type { TrpcContext } from "../context";
import { getDb } from "../queries/connection";
import { catalogRouter } from "../routers/catalog";
import { creditRouter } from "../routers/credit";
import { customersRouter } from "../routers/customers";
import { expensesRouter } from "../routers/expenses";
import { membershipRouter } from "../routers/membership";
import { posRouter } from "../routers/pos";
import { actorFromReq, logAudit } from "./audit";

export const ASSISTANT_WRITE_ACTIONS = [
  "create_member",
  "create_customer",
  "create_expense",
  "create_product",
  "update_product_price",
  "adjust_stock",
  "refill_tank",
  "adjust_member_points",
  "receive_debt_payment",
  "redeem_reward",
  "void_sale",
  "delete_product",
  "delete_member",
  "remove_customer",
  "remove_expense",
  "remove_debt_payment",
] as const;

export type AssistantWriteAction = (typeof ASSISTANT_WRITE_ACTIONS)[number];
type ActionRisk = "standard" | "sensitive";

const actionRules: Record<
  AssistantWriteAction,
  {
    menu: MenuPermissionKey;
    minimumRole: StaffRole;
    risk: ActionRisk;
  }
> = {
  create_member: { menu: "members", minimumRole: "cashier", risk: "standard" },
  create_customer: {
    menu: "customers",
    minimumRole: "manager",
    risk: "standard",
  },
  create_expense: {
    menu: "expenses",
    minimumRole: "cashier",
    risk: "sensitive",
  },
  create_product: { menu: "stock", minimumRole: "admin", risk: "sensitive" },
  update_product_price: {
    menu: "stock",
    minimumRole: "admin",
    risk: "sensitive",
  },
  adjust_stock: { menu: "stock", minimumRole: "admin", risk: "sensitive" },
  refill_tank: { menu: "stock", minimumRole: "cashier", risk: "sensitive" },
  adjust_member_points: {
    menu: "members",
    minimumRole: "admin",
    risk: "sensitive",
  },
  receive_debt_payment: {
    menu: "debts",
    minimumRole: "manager",
    risk: "sensitive",
  },
  redeem_reward: {
    menu: "members",
    minimumRole: "cashier",
    risk: "sensitive",
  },
  void_sale: { menu: "sales", minimumRole: "admin", risk: "sensitive" },
  delete_product: { menu: "stock", minimumRole: "admin", risk: "sensitive" },
  delete_member: { menu: "members", minimumRole: "admin", risk: "sensitive" },
  remove_customer: {
    menu: "customers",
    minimumRole: "manager",
    risk: "sensitive",
  },
  remove_expense: {
    menu: "expenses",
    minimumRole: "manager",
    risk: "sensitive",
  },
  remove_debt_payment: {
    menu: "debts",
    minimumRole: "manager",
    risk: "sensitive",
  },
};

const roleLevel: Record<StaffRole, number> = {
  cashier: 1,
  manager: 2,
  admin: 3,
};

export function canUseAssistantAction(
  action: AssistantWriteAction,
  role: StaffRole,
  permissions: readonly MenuPermissionKey[],
) {
  const rule = actionRules[action];
  return (
    permissions.includes(rule.menu) &&
    roleLevel[role] >= roleLevel[rule.minimumRole]
  );
}

export function availableAssistantActions(
  role: StaffRole,
  permissions: readonly MenuPermissionKey[],
) {
  return ASSISTANT_WRITE_ACTIONS.filter((action) =>
    canUseAssistantAction(action, role, permissions),
  );
}

export const assistantProposalArgumentsSchema = z
  .object({
    action: z.enum(ASSISTANT_WRITE_ACTIONS),
    name: z.string().trim().min(1).max(200).optional(),
    phone: z.string().trim().min(3).max(40).optional(),
    taxId: z.string().trim().max(40).optional(),
    branch: z.string().trim().max(100).optional(),
    address: z.string().trim().max(500).optional(),
    vehiclePlate: z.string().trim().max(40).optional(),
    creditLimit: z.number().nonnegative().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    category: z.string().trim().max(100).optional(),
    amount: z.number().positive().optional(),
    note: z.string().trim().max(500).optional(),
    code: z.string().trim().min(1).max(80).optional(),
    productCategory: z.enum(["fuel", "lubricant", "other"]).optional(),
    unit: z.string().trim().min(1).max(30).optional(),
    price: z.number().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
    stockQty: z.number().nonnegative().optional(),
    lowStockAt: z.number().nonnegative().optional(),
    qty: z.number().optional(),
    mode: z.enum(["set", "add"]).optional(),
    tankName: z.string().trim().min(1).max(120).optional(),
    liters: z.number().positive().optional(),
    costPerLiter: z.number().nonnegative().optional(),
    memberCode: z.string().trim().min(1).max(80).optional(),
    points: z.number().int().optional(),
    customerName: z.string().trim().min(1).max(200).optional(),
    method: z.enum(["cash", "qr", "transfer"]).optional(),
    rewardName: z.string().trim().min(1).max(200).optional(),
    receiptNo: z.string().trim().min(1).max(100).optional(),
    expenseId: z.number().int().positive().optional(),
    paymentNo: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export type AssistantProposalArguments = z.infer<
  typeof assistantProposalArgumentsSchema
>;

type PreparedProposal = {
  action: AssistantWriteAction;
  payload: Record<string, unknown>;
  title: string;
  summary: string;
  risk: ActionRisk;
};

function required<T>(
  value: T | null | undefined,
  message: string,
): NonNullable<T> {
  if (value === undefined || value === null || value === "") {
    throw new TRPCError({ code: "BAD_REQUEST", message });
  }
  return value as NonNullable<T>;
}

function baht(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function exactProduct(branchId: number, code: string) {
  const row = await getDb().query.products.findFirst({
    where: and(
      eq(products.branchId, branchId),
      ilike(products.code, code.trim()),
    ),
  });
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `ไม่พบสินค้ารหัส ${code}`,
    });
  }
  return row;
}

async function exactTank(branchId: number, name: string) {
  const rows = await getDb()
    .select()
    .from(fuelTanks)
    .where(
      and(
        eq(fuelTanks.branchId, branchId),
        ilike(fuelTanks.name, name.trim()),
      ),
    )
    .limit(2);
  if (rows.length !== 1) {
    throw new TRPCError({
      code: rows.length ? "CONFLICT" : "NOT_FOUND",
      message: rows.length
        ? `ชื่อถัง "${name}" ซ้ำกัน กรุณาระบุชื่อให้ชัดเจน`
        : `ไม่พบถัง "${name}"`,
    });
  }
  return rows[0];
}

async function exactMember(code: string) {
  const row = await getDb().query.members.findFirst({
    where: ilike(members.memberCode, code.trim()),
  });
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `ไม่พบสมาชิกรหัส ${code}`,
    });
  }
  return row;
}

async function exactCustomer(name: string) {
  const rows = await getDb()
    .select()
    .from(customers)
    .where(ilike(customers.name, name.trim()))
    .limit(2);
  if (rows.length !== 1) {
    throw new TRPCError({
      code: rows.length ? "CONFLICT" : "NOT_FOUND",
      message: rows.length
        ? `พบลูกค้าชื่อ "${name}" มากกว่า 1 ราย กรุณาทำรายการจากหน้าลูกค้า`
        : `ไม่พบลูกค้า "${name}"`,
    });
  }
  return rows[0];
}

async function prepareProposal(
  input: AssistantProposalArguments,
  branchId: number,
): Promise<PreparedProposal> {
  const risk = actionRules[input.action].risk;
  switch (input.action) {
    case "create_member": {
      const name = required(input.name, "กรุณาระบุชื่อสมาชิก");
      const phone = required(input.phone, "กรุณาระบุเบอร์โทรสมาชิก");
      return {
        action: input.action,
        payload: { name, phone },
        title: "สมัครสมาชิกใหม่",
        summary: `ชื่อ ${name} · โทร ${phone}`,
        risk,
      };
    }
    case "create_customer": {
      const name = required(input.name, "กรุณาระบุชื่อลูกค้า");
      const payload = {
        name,
        taxId: input.taxId ?? "",
        branch: input.branch ?? "",
        address: input.address ?? "",
        phone: input.phone ?? "",
        vehiclePlate: input.vehiclePlate ?? "",
        creditLimit: input.creditLimit ?? 0,
      };
      return {
        action: input.action,
        payload,
        title: "เพิ่มลูกค้าธุรกิจ",
        summary: `${name} · วงเงินเครดิต ${baht(payload.creditLimit)} บาท`,
        risk,
      };
    }
    case "create_expense": {
      const title = required(input.title, "กรุณาระบุรายการค่าใช้จ่าย");
      const amount = required(input.amount, "กรุณาระบุจำนวนเงิน");
      return {
        action: input.action,
        payload: {
          title,
          category: input.category ?? "",
          amount,
          note: input.note,
        },
        title: "บันทึกค่าใช้จ่าย",
        summary: `${title} · ${baht(amount)} บาท`,
        risk,
      };
    }
    case "create_product": {
      const code = required(input.code, "กรุณาระบุรหัสสินค้า");
      const name = required(input.name, "กรุณาระบุชื่อสินค้า");
      const productCategory = required(
        input.productCategory,
        "กรุณาระบุประเภทสินค้า",
      );
      const price = required(input.price, "กรุณาระบุราคาขาย");
      return {
        action: input.action,
        payload: {
          code,
          name,
          category: productCategory,
          unit: input.unit ?? "ชิ้น",
          price,
          cost: input.cost ?? 0,
          stockQty: input.stockQty ?? 0,
          lowStockAt: input.lowStockAt ?? 0,
        },
        title: "เพิ่มสินค้า",
        summary: `${code} · ${name} · ราคา ${baht(price)} บาท`,
        risk,
      };
    }
    case "update_product_price": {
      const code = required(input.code, "กรุณาระบุรหัสสินค้า");
      const price = required(input.price, "กรุณาระบุราคาใหม่");
      const product = await exactProduct(branchId, code);
      return {
        action: input.action,
        payload: { id: product.id, price },
        title: "เปลี่ยนราคาสินค้า",
        summary: `${product.code} ${product.name}: ${baht(product.price)} → ${baht(price)} บาท`,
        risk,
      };
    }
    case "adjust_stock": {
      const code = required(input.code, "กรุณาระบุรหัสสินค้า");
      const qty = required(input.qty, "กรุณาระบุจำนวนสต๊อก");
      const mode = input.mode ?? "add";
      const product = await exactProduct(branchId, code);
      const next = mode === "set" ? qty : product.stockQty + qty;
      if (next < 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "สต๊อกหลังปรับติดลบไม่ได้",
        });
      }
      return {
        action: input.action,
        payload: { productId: product.id, qty, mode },
        title: "ปรับสต๊อกสินค้า",
        summary: `${product.code} ${product.name}: ${product.stockQty} → ${next} ${product.unit}`,
        risk,
      };
    }
    case "refill_tank": {
      const tankName = required(input.tankName, "กรุณาระบุชื่อถัง");
      const liters = required(input.liters, "กรุณาระบุจำนวนลิตร");
      const tank = await exactTank(branchId, tankName);
      if (tank.currentLiters + liters > tank.capacityLiters) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "ปริมาณหลังเติมเกินความจุถัง",
        });
      }
      return {
        action: input.action,
        payload: {
          tankId: tank.id,
          liters,
          costPerLiter: input.costPerLiter ?? 0,
          note: input.note,
        },
        title: "บันทึกเติมน้ำมันเข้าถัง",
        summary: `${tank.name} · เติม ${liters.toLocaleString("th-TH")} ลิตร · หลังเติม ${(tank.currentLiters + liters).toLocaleString("th-TH")} ลิตร`,
        risk,
      };
    }
    case "adjust_member_points": {
      const memberCode = required(
        input.memberCode,
        "กรุณาระบุรหัสสมาชิก",
      );
      const points = required(input.points, "กรุณาระบุจำนวนแต้ม");
      const note = required(input.note, "กรุณาระบุเหตุผล");
      const member = await exactMember(memberCode);
      if (member.points + points < 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "แต้มหลังปรับติดลบไม่ได้",
        });
      }
      return {
        action: input.action,
        payload: { memberId: member.id, points, note },
        title: "ปรับแต้มสมาชิก",
        summary: `${member.memberCode} ${member.name}: ${points > 0 ? "+" : ""}${points} แต้ม · ${note}`,
        risk,
      };
    }
    case "receive_debt_payment": {
      const customerName = required(
        input.customerName,
        "กรุณาระบุชื่อลูกค้า",
      );
      const amount = required(input.amount, "กรุณาระบุยอดชำระ");
      const customer = await exactCustomer(customerName);
      return {
        action: input.action,
        payload: {
          customerId: customer.id,
          amount,
          method: input.method ?? "cash",
          note: input.note,
        },
        title: "รับชำระหนี้",
        summary: `${customer.name} · ${baht(amount)} บาท · ${input.method ?? "cash"}`,
        risk,
      };
    }
    case "redeem_reward": {
      const memberCode = required(
        input.memberCode,
        "กรุณาระบุรหัสสมาชิก",
      );
      const rewardName = required(input.rewardName, "กรุณาระบุชื่อของรางวัล");
      const member = await exactMember(memberCode);
      const rewardRows = await getDb()
        .select()
        .from(rewards)
        .where(
          and(
            eq(rewards.branchId, branchId),
            ilike(rewards.name, rewardName),
            eq(rewards.active, true),
          ),
        )
        .limit(2);
      if (rewardRows.length !== 1) {
        throw new TRPCError({
          code: rewardRows.length ? "CONFLICT" : "NOT_FOUND",
          message: rewardRows.length
            ? `ชื่อรางวัล "${rewardName}" ซ้ำกัน`
            : `ไม่พบรางวัล "${rewardName}"`,
        });
      }
      const reward = rewardRows[0];
      return {
        action: input.action,
        payload: { memberId: member.id, rewardId: reward.id },
        title: "แลกของรางวัล",
        summary: `${member.memberCode} ${member.name} · ${reward.name} · ใช้ ${reward.pointsRequired} แต้ม`,
        risk,
      };
    }
    case "void_sale": {
      const receiptNo = required(input.receiptNo, "กรุณาระบุเลขที่ใบเสร็จ");
      const sale = await getDb().query.sales.findFirst({
        where: and(
          eq(sales.branchId, branchId),
          ilike(sales.receiptNo, receiptNo),
        ),
      });
      if (!sale || sale.status === "voided") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "ไม่พบบิลที่ยกเลิกได้",
        });
      }
      return {
        action: input.action,
        payload: { id: sale.id },
        title: "ยกเลิกบิลขาย",
        summary: `${sale.receiptNo} · ยอด ${baht(sale.total)} บาท · ระบบจะคืนสต๊อกและแต้ม`,
        risk,
      };
    }
    case "delete_product": {
      const code = required(input.code, "กรุณาระบุรหัสสินค้า");
      const product = await exactProduct(branchId, code);
      return {
        action: input.action,
        payload: { id: product.id },
        title: "ลบสินค้า",
        summary: `${product.code} · ${product.name}`,
        risk,
      };
    }
    case "delete_member": {
      const memberCode = required(
        input.memberCode,
        "กรุณาระบุรหัสสมาชิก",
      );
      const member = await exactMember(memberCode);
      return {
        action: input.action,
        payload: { id: member.id },
        title: "ลบสมาชิก",
        summary: `${member.memberCode} · ${member.name}`,
        risk,
      };
    }
    case "remove_customer": {
      const customerName = required(
        input.customerName,
        "กรุณาระบุชื่อลูกค้า",
      );
      const customer = await exactCustomer(customerName);
      return {
        action: input.action,
        payload: { id: customer.id },
        title: "ลบลูกค้าธุรกิจ",
        summary: customer.name,
        risk,
      };
    }
    case "remove_expense": {
      const expenseId = required(
        input.expenseId,
        "กรุณาระบุเลข ID ค่าใช้จ่าย",
      );
      const expense = await getDb().query.expenses.findFirst({
        where: and(
          eq(expenses.id, expenseId),
          eq(expenses.branchId, branchId),
        ),
      });
      if (!expense) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "ไม่พบรายการค่าใช้จ่าย",
        });
      }
      return {
        action: input.action,
        payload: { id: expense.id },
        title: "ลบค่าใช้จ่าย",
        summary: `${expense.title} · ${baht(expense.amount)} บาท`,
        risk,
      };
    }
    case "remove_debt_payment": {
      const paymentNo = required(
        input.paymentNo,
        "กรุณาระบุเลขที่รับชำระ",
      );
      const payment = await getDb().query.debtPayments.findFirst({
        where: and(
          eq(debtPayments.branchId, branchId),
          ilike(debtPayments.paymentNo, paymentNo),
        ),
      });
      if (!payment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "ไม่พบรายการรับชำระ",
        });
      }
      return {
        action: input.action,
        payload: { id: payment.id },
        title: "ลบรายการรับชำระหนี้",
        summary: `${payment.paymentNo} · ${baht(payment.amount)} บาท`,
        risk,
      };
    }
  }
}

export async function createAssistantActionProposal(options: {
  argumentsValue: unknown;
  branchId: number;
  staffId: number;
  requestId: string;
  role: StaffRole;
  permissions: readonly MenuPermissionKey[];
}) {
  const input = assistantProposalArgumentsSchema.parse(options.argumentsValue);
  if (
    !canUseAssistantAction(input.action, options.role, options.permissions)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "สิทธิ์ของคุณไม่อนุญาตให้ทำรายการนี้",
    });
  }
  const prepared = await prepareProposal(input, options.branchId);
  const idempotencyKey = createHash("sha256")
    .update(
      JSON.stringify({
        requestId: options.requestId,
        staffId: options.staffId,
        action: prepared.action,
        payload: prepared.payload,
      }),
    )
    .digest("hex");
  const db = getDb();
  const [created] = await db
    .insert(assistantActionProposals)
    .values({
      branchId: options.branchId,
      staffId: options.staffId,
      idempotencyKey,
      action: prepared.action,
      payload: prepared.payload,
      title: prepared.title,
      summary: prepared.summary,
      risk: prepared.risk,
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000),
    })
    .onConflictDoNothing({
      target: assistantActionProposals.idempotencyKey,
    })
    .returning({
      id: assistantActionProposals.id,
      title: assistantActionProposals.title,
      summary: assistantActionProposals.summary,
      risk: assistantActionProposals.risk,
    });
  const proposal =
    created ??
    (await db.query.assistantActionProposals.findFirst({
      columns: {
        id: true,
        title: true,
        summary: true,
        risk: true,
      },
      where: eq(assistantActionProposals.idempotencyKey, idempotencyKey),
    }));
  if (!proposal) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "ไม่สามารถสร้างรายการยืนยันได้ กรุณาลองใหม่",
    });
  }
  return proposal;
}

export function renderAssistantProposalAction(value: unknown): {
  answer: string;
  actions: AssistantAction[];
} {
  const proposal = value as {
    id: string;
    title: string;
    summary: string;
    risk: ActionRisk;
  };
  return {
    answer:
      "ผมเตรียมรายการให้แล้ว แต่ยังไม่ได้เปลี่ยนข้อมูล กรุณาตรวจรายละเอียดและกดยืนยันภายใน 10 นาที",
    actions: [
      {
        kind: "confirm_agent_action",
        label: "ตรวจสอบและยืนยัน",
        proposalId: proposal.id,
        title: proposal.title,
        summary: proposal.summary,
        risk: proposal.risk,
        requiresPin: proposal.risk === "sensitive",
      },
    ],
  };
}

function verifyPin(storedHash: string, suppliedPin: string) {
  const suppliedHash = createHash("sha256")
    .update(suppliedPin)
    .digest("hex");
  const stored = Buffer.from(storedHash, "utf8");
  const supplied = Buffer.from(suppliedHash, "utf8");
  return (
    stored.length === supplied.length && timingSafeEqual(stored, supplied)
  );
}

async function executePreparedAction(
  action: AssistantWriteAction,
  payload: Record<string, unknown>,
  ctx: TrpcContext & { staff: NonNullable<TrpcContext["staff"]> },
) {
  switch (action) {
    case "create_member":
      await membershipRouter
        .createCaller(ctx)
        .createMember(
          payload as { name: string; phone: string },
        );
      return;
    case "create_customer":
      await customersRouter.createCaller(ctx).create(
        payload as {
          name: string;
          taxId: string;
          branch: string;
          address: string;
          phone: string;
          vehiclePlate: string;
          creditLimit: number;
        },
      );
      return;
    case "create_expense":
      await expensesRouter.createCaller(ctx).create({
        ...(payload as {
          title: string;
          category: string;
          amount: number;
          note?: string;
        }),
        staffName: ctx.staff.name,
      });
      return;
    case "create_product":
      await catalogRouter.createCaller(ctx).createProduct(
        payload as {
          code: string;
          name: string;
          category: "fuel" | "lubricant" | "other";
          unit: string;
          price: number;
          cost: number;
          stockQty: number;
          lowStockAt: number;
        },
      );
      return;
    case "update_product_price":
      await catalogRouter
        .createCaller(ctx)
        .updateProduct(payload as { id: number; price: number });
      return;
    case "adjust_stock":
      await catalogRouter.createCaller(ctx).adjustStock(
        payload as {
          productId: number;
          qty: number;
          mode: "set" | "add";
        },
      );
      return;
    case "refill_tank":
      await catalogRouter.createCaller(ctx).refillTank(
        payload as {
          tankId: number;
          liters: number;
          costPerLiter: number;
          note?: string;
        },
      );
      return;
    case "adjust_member_points":
      await membershipRouter.createCaller(ctx).adjustPoints(
        payload as { memberId: number; points: number; note: string },
      );
      return;
    case "receive_debt_payment":
      await creditRouter.createCaller(ctx).receivePayment({
        ...(payload as {
          customerId: number;
          amount: number;
          method: "cash" | "qr" | "transfer";
          note?: string;
        }),
        staffName: ctx.staff.name,
      });
      return;
    case "redeem_reward":
      await membershipRouter
        .createCaller(ctx)
        .redeemReward(payload as { memberId: number; rewardId: number });
      return;
    case "void_sale":
      await posRouter
        .createCaller(ctx)
        .voidSale(payload as { id: number });
      return;
    case "delete_product":
      await catalogRouter
        .createCaller(ctx)
        .deleteProduct(payload as { id: number });
      return;
    case "delete_member":
      await membershipRouter
        .createCaller(ctx)
        .deleteMember(payload as { id: number });
      return;
    case "remove_customer":
      await customersRouter
        .createCaller(ctx)
        .remove(payload as { id: number });
      return;
    case "remove_expense":
      await expensesRouter
        .createCaller(ctx)
        .remove(payload as { id: number });
      return;
    case "remove_debt_payment":
      await creditRouter
        .createCaller(ctx)
        .removePayment(payload as { id: number });
      return;
  }
}

export async function executeAssistantActionProposal(options: {
  proposalId: string;
  pin?: string;
  role: StaffRole;
  permissions: readonly MenuPermissionKey[];
  ctx: TrpcContext & { staff: NonNullable<TrpcContext["staff"]> };
}) {
  const db = getDb();
  const { staff } = options.ctx;
  const proposal = await db.query.assistantActionProposals.findFirst({
    where: and(
      eq(assistantActionProposals.id, options.proposalId),
      eq(assistantActionProposals.branchId, staff.branchId),
      eq(assistantActionProposals.staffId, staff.id),
    ),
  });
  if (!proposal) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "ไม่พบรายการยืนยัน หรือรายการนี้ไม่ได้เป็นของคุณ",
    });
  }
  if (proposal.status === "succeeded") {
    return {
      ok: true,
      alreadyExecuted: true,
      summary: proposal.resultSummary ?? "รายการนี้ดำเนินการแล้ว",
    };
  }
  if (proposal.status !== "pending") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "รายการนี้ไม่อยู่ในสถานะที่ยืนยันได้ กรุณาสั่งใหม่",
    });
  }
  if (proposal.expiresAt.getTime() <= Date.now()) {
    await db
      .update(assistantActionProposals)
      .set({ status: "expired" })
      .where(
        and(
          eq(assistantActionProposals.id, proposal.id),
          eq(assistantActionProposals.status, "pending"),
        ),
      );
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "รายการหมดอายุแล้ว กรุณาสั่งใหม่",
    });
  }

  if (!ASSISTANT_WRITE_ACTIONS.includes(proposal.action as AssistantWriteAction)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "คำสั่งนี้ไม่ได้รับอนุญาต",
    });
  }
  const action = proposal.action as AssistantWriteAction;
  if (!canUseAssistantAction(action, options.role, options.permissions)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "สิทธิ์ปัจจุบันของคุณไม่อนุญาตให้ทำรายการนี้",
    });
  }

  if (proposal.risk === "sensitive") {
    if (!options.pin) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "กรุณายืนยันด้วย PIN ของบัญชีที่กำลังใช้งาน",
      });
    }
    const currentUser = await db.query.staffUsers.findFirst({
      columns: { pin: true, active: true },
      where: eq(staffUsers.id, staff.id),
    });
    if (
      !currentUser?.active ||
      !verifyPin(currentUser.pin, options.pin)
    ) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "PIN ไม่ถูกต้อง",
      });
    }
  }

  const [claimed] = await db
    .update(assistantActionProposals)
    .set({ status: "processing" })
    .where(
      and(
        eq(assistantActionProposals.id, proposal.id),
        eq(assistantActionProposals.status, "pending"),
      ),
    )
    .returning({ id: assistantActionProposals.id });
  if (!claimed) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "รายการกำลังถูกดำเนินการหรือดำเนินการแล้ว",
    });
  }

  try {
    await executePreparedAction(action, proposal.payload, options.ctx);
    const summary = `สำเร็จ: ${proposal.title} — ${proposal.summary}`;
    await db
      .update(assistantActionProposals)
      .set({
        status: "succeeded",
        executedAt: new Date(),
        resultSummary: summary,
      })
      .where(eq(assistantActionProposals.id, proposal.id));
    logAudit({
      action: "assistant_action_succeeded",
      ...actorFromReq(options.ctx.req),
      detail: `AI Controlled Agent: ${proposal.action} (${proposal.id})`,
      refType: "assistant_action_proposal",
    });
    return { ok: true, alreadyExecuted: false, summary };
  } catch (error) {
    await db
      .update(assistantActionProposals)
      .set({
        status: "failed",
        executedAt: new Date(),
        resultSummary: "ดำเนินการไม่สำเร็จ",
      })
      .where(eq(assistantActionProposals.id, proposal.id));
    logAudit({
      action: "assistant_action_failed",
      ...actorFromReq(options.ctx.req),
      detail: `AI Controlled Agent: ${proposal.action} (${proposal.id})`,
      refType: "assistant_action_proposal",
    });
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        error instanceof Error
          ? error.message
          : "ดำเนินการไม่สำเร็จ กรุณาตรวจข้อมูลแล้วสั่งใหม่",
    });
  }
}
