import { z } from "zod";
import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { adminQuery, staffIdFromHeader } from "../guard";
import { getDb } from "../queries/connection";
import { staffUsers } from "@db/schema";
import { actorFromReq, logAudit } from "../lib/audit";
import { issueStaffSession } from "../lib/session";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const authRouter = createRouter({
  login: publicQuery
    .input(z.object({ username: z.string().min(1), pin: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const user = await db.query.staffUsers.findFirst({
        where: eq(staffUsers.username, input.username),
      });
      if (!user || user.pin !== sha256(input.pin) || !user.active) {
        throw new Error("ชื่อผู้ใช้หรือรหัส PIN ไม่ถูกต้อง");
      }
      const staff = {
        id: user.id,
        name: user.name,
        role: user.role,
        username: user.username,
      };
      return { ...staff, token: issueStaffSession(staff) };
    }),

  listStaff: publicQuery.query(async () => {
    const rows = await getDb().query.staffUsers.findMany();
    return rows.map(({ pin: _pin, ...rest }) => rest);
  }),

  createStaff: adminQuery
    .input(
      z.object({
        username: z.string().min(3),
        pin: z.string().min(4),
        name: z.string().min(1),
        role: z.enum(["admin", "manager", "cashier"]).default("cashier"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const dup = await getDb().query.staffUsers.findFirst({
        where: eq(staffUsers.username, input.username),
      });
      if (dup) throw new Error("ชื่อผู้ใช้นี้ถูกใช้แล้ว");
      const [{ id }] = await getDb()
        .insert(staffUsers)
        .values({ ...input, pin: sha256(input.pin) })
        .returning({ id: staffUsers.id });
      logAudit({
        action: "create_staff",
        ...actorFromReq(ctx.req),
        detail: `เพิ่มพนักงาน ${input.username} (${input.role}) ชื่อ ${input.name}`,
        refType: "staff",
        refId: id,
      });
      return { ok: true };
    }),

  updateStaff: adminQuery
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        username: z.string().min(3).optional(),
        pin: z.string().min(4).optional(),
        role: z.enum(["admin", "manager", "cashier"]).optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, pin, ...rest } = input;
      const db = getDb();
      const target = await db.query.staffUsers.findFirst({ where: eq(staffUsers.id, id) });
      if (!target) throw new Error("ไม่พบพนักงาน");
      const patch: Record<string, unknown> = { ...rest };
      if (pin) patch.pin = sha256(pin);
      await db.update(staffUsers).set(patch).where(eq(staffUsers.id, id));
      // อธิบายสิ่งที่แก้ — ห้ามใส่ PIN ลง log
      const changes: string[] = [];
      if (rest.name !== undefined && rest.name !== target.name) changes.push(`ชื่อ ${target.name}→${rest.name}`);
      if (rest.username !== undefined && rest.username !== target.username) {
        changes.push(`username ${target.username}→${rest.username}`);
      }
      if (rest.role !== undefined && rest.role !== target.role) changes.push(`role ${target.role}→${rest.role}`);
      if (rest.active !== undefined && rest.active !== target.active) {
        changes.push(rest.active ? "เปิดใช้งาน" : "ปิดใช้งาน");
      }
      if (pin) changes.push("รีเซ็ต PIN");
      logAudit({
        action: "update_staff",
        ...actorFromReq(ctx.req),
        detail: `แก้ไขพนักงาน ${target.username}${changes.length > 0 ? `: ${changes.join(", ")}` : ""}`,
        refType: "staff",
        refId: id,
      });
      return { ok: true };
    }),

  deleteStaff: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const me = staffIdFromHeader(ctx.req);
      if (me === input.id) throw new Error("ลบบัญชีตัวเองไม่ได้");
      const db = getDb();
      const admins = (await db.query.staffUsers.findMany()).filter((u) => u.role === "admin" && u.active);
      const target = await db.query.staffUsers.findFirst({ where: eq(staffUsers.id, input.id) });
      if (!target) throw new Error("ไม่พบพนักงาน");
      if (target.role === "admin" && admins.length <= 1) {
        throw new Error("ต้องเหลือผู้ดูแลระบบอย่างน้อย 1 คน");
      }
      await db.delete(staffUsers).where(eq(staffUsers.id, input.id));
      logAudit({
        action: "delete_staff",
        ...actorFromReq(ctx.req),
        detail: `ลบพนักงาน ${target.username} (${target.role}) ชื่อ ${target.name}`,
        refType: "staff",
        refId: target.id,
      });
      return { ok: true };
    }),
});
