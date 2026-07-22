import { z } from "zod";
import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import {
  anonymousQuery,
  authenticatedStaffAction,
  createRouter,
  publicQuery,
} from "../middleware";
import { adminQuery, staffIdFromHeader } from "../guard";
import { getDb } from "../queries/connection";
import { staffAccessGroups, staffUsers } from "@db/schema";
import { actorFromReq, logAudit } from "../lib/audit";
import { issueStaffSession, staffSessionFromHeader } from "../lib/session";
import {
  issueSupabaseStaffSession,
  staffAuthBridgeFailureCode,
} from "../lib/supabaseAuth";
import {
  MENU_PERMISSION_KEYS,
  normalizeMenuPermissions,
  type StaffRole,
} from "@contracts/menuPermissions";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const menuPermissionsInput = z.array(z.enum(MENU_PERMISSION_KEYS)).min(1);

function effectiveMenuPermissions(
  role: StaffRole,
  menuPermissions: readonly string[] | null | undefined,
  accessGroup?: {
    role: "manager" | "cashier";
    menuPermissions: readonly string[];
  } | null
) {
  const inheritedPermissions =
    role !== "admin" && accessGroup?.role === role
      ? accessGroup.menuPermissions
      : menuPermissions;
  return normalizeMenuPermissions(role, inheritedPermissions);
}

async function accessGroupForUser(accessGroupId: number | null) {
  if (!accessGroupId) return null;
  return (
    (await getDb().query.staffAccessGroups.findFirst({
      where: eq(staffAccessGroups.id, accessGroupId),
    })) ?? null
  );
}

async function optionalSupabaseSession(user: {
  id: number;
  supabaseAuthUserId: string | null;
}) {
  try {
    return await issueSupabaseStaffSession(user);
  } catch (error) {
    // The signed PumpPOS session remains available during the staged bridge.
    // Never log Auth responses, passwords, user emails, or returned tokens.
    console.warn(
      `Supabase Auth bridge skipped (${staffAuthBridgeFailureCode(error)}).`
    );
    return null;
  }
}

function accessGroupSummary(
  group: { id: number; name: string } | null | undefined
) {
  return group ? { id: group.id, name: group.name } : null;
}

export const authRouter = createRouter({
  login: anonymousQuery
    .input(z.object({ username: z.string().min(1), pin: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const user = await db.query.staffUsers.findFirst({
        where: eq(staffUsers.username, input.username),
      });
      if (!user || user.pin !== sha256(input.pin) || !user.active) {
        throw new Error("ชื่อผู้ใช้หรือรหัส PIN ไม่ถูกต้อง");
      }
      const accessGroup = await accessGroupForUser(user.accessGroupId);
      const staff = {
        id: user.id,
        name: user.name,
        role: user.role,
        username: user.username,
      };
      return {
        ...staff,
        menuPermissions: effectiveMenuPermissions(
          user.role,
          user.menuPermissions,
          accessGroup
        ),
        accessGroup: accessGroupSummary(accessGroup),
        token: issueStaffSession(staff),
        supabaseSession: await optionalSupabaseSession(user),
      };
    }),

  realtimeSession: authenticatedStaffAction.mutation(async ({ ctx }) => {
    const session = staffSessionFromHeader(ctx.req);
    if (!session) return null;
    const user = await getDb().query.staffUsers.findFirst({
      where: eq(staffUsers.id, session.id),
    });
    if (!user?.active) return null;
    return optionalSupabaseSession(user);
  }),

  currentStaff: anonymousQuery
    .input(
      z.object({
        staffId: z.number().int().positive(),
        sessionNonce: z.number().int().nonnegative().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const session = staffSessionFromHeader(ctx.req);
      if (!session || session.id !== input.staffId) {
        return { authenticated: false as const };
      }

      const user = await getDb().query.staffUsers.findFirst({
        where: eq(staffUsers.id, session.id),
      });
      if (!user?.active) return { authenticated: false as const };
      const accessGroup = await accessGroupForUser(user.accessGroupId);

      const staff = {
        id: user.id,
        name: user.name,
        role: user.role,
        username: user.username,
      };
      return {
        authenticated: true as const,
        ...staff,
        menuPermissions: effectiveMenuPermissions(
          user.role,
          user.menuPermissions,
          accessGroup
        ),
        accessGroup: accessGroupSummary(accessGroup),
        token: issueStaffSession(staff),
      };
    }),

  listStaff: publicQuery.query(async () => {
    const rows = await getDb().query.staffUsers.findMany();
    return rows.map(
      ({
        pin: _pin,
        menuPermissions: _menuPermissions,
        supabaseAuthUserId: _supabaseAuthUserId,
        ...rest
      }) => rest
    );
  }),

  listStaffAccess: adminQuery.query(async () => {
    const db = getDb();
    const [rows, groups] = await Promise.all([
      db.query.staffUsers.findMany(),
      db.query.staffAccessGroups.findMany(),
    ]);
    const groupsById = new Map(groups.map(group => [group.id, group]));
    return rows.map(
      ({ pin: _pin, supabaseAuthUserId: _supabaseAuthUserId, ...rest }) => {
        const accessGroup = rest.accessGroupId
          ? groupsById.get(rest.accessGroupId)
          : null;
        return {
          ...rest,
          menuPermissions: effectiveMenuPermissions(
            rest.role,
            rest.menuPermissions,
            accessGroup
          ),
          accessGroup: accessGroupSummary(accessGroup),
        };
      }
    );
  }),

  listAccessGroups: adminQuery.query(async () => {
    const db = getDb();
    const [groups, staff] = await Promise.all([
      db.query.staffAccessGroups.findMany(),
      db.query.staffUsers.findMany(),
    ]);
    return groups
      .map(group => ({
        ...group,
        menuPermissions: effectiveMenuPermissions(
          group.role,
          group.menuPermissions
        ),
        memberCount: staff.filter(user => user.accessGroupId === group.id)
          .length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "th"));
  }),

  createAccessGroup: adminQuery
    .input(
      z.object({
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().max(240).default(""),
        role: z.enum(["manager", "cashier"]),
        menuPermissions: menuPermissionsInput,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const duplicate = await db.query.staffAccessGroups.findFirst({
        where: eq(staffAccessGroups.name, input.name),
      });
      if (duplicate) throw new Error("ชื่อกลุ่มสิทธิ์นี้ถูกใช้แล้ว");
      const menuPermissions = effectiveMenuPermissions(
        input.role,
        input.menuPermissions
      );
      if (menuPermissions.length === 0) {
        throw new Error("ต้องเปิดสิทธิ์อย่างน้อย 1 เมนู");
      }
      const [{ id }] = await db
        .insert(staffAccessGroups)
        .values({ ...input, menuPermissions })
        .returning({ id: staffAccessGroups.id });
      logAudit({
        action: "create_staff_access_group",
        ...actorFromReq(ctx.req),
        detail: `เพิ่มกลุ่มสิทธิ์ ${input.name} (${input.role}) ${menuPermissions.length} เมนู`,
        refType: "staff_access_group",
        refId: id,
      });
      return { ok: true, id };
    }),

  updateAccessGroup: adminQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(1).max(80).optional(),
        description: z.string().trim().max(240).optional(),
        menuPermissions: menuPermissionsInput.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const target = await db.query.staffAccessGroups.findFirst({
        where: eq(staffAccessGroups.id, input.id),
      });
      if (!target) throw new Error("ไม่พบกลุ่มสิทธิ์");
      if (input.name && input.name !== target.name) {
        const duplicate = await db.query.staffAccessGroups.findFirst({
          where: eq(staffAccessGroups.name, input.name),
        });
        if (duplicate) throw new Error("ชื่อกลุ่มสิทธิ์นี้ถูกใช้แล้ว");
      }
      const { id, menuPermissions: requestedPermissions, ...rest } = input;
      const patch: Record<string, unknown> = {
        ...rest,
        updatedAt: new Date(),
      };
      if (requestedPermissions) {
        const normalized = effectiveMenuPermissions(
          target.role,
          requestedPermissions
        );
        if (normalized.length === 0) {
          throw new Error("ต้องเปิดสิทธิ์อย่างน้อย 1 เมนู");
        }
        patch.menuPermissions = normalized;
      }
      await db
        .update(staffAccessGroups)
        .set(patch)
        .where(eq(staffAccessGroups.id, id));
      logAudit({
        action: "update_staff_access_group",
        ...actorFromReq(ctx.req),
        detail: `แก้ไขกลุ่มสิทธิ์ ${target.name}`,
        refType: "staff_access_group",
        refId: id,
      });
      return { ok: true };
    }),

  deleteAccessGroup: adminQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const target = await db.query.staffAccessGroups.findFirst({
        where: eq(staffAccessGroups.id, input.id),
      });
      if (!target) throw new Error("ไม่พบกลุ่มสิทธิ์");
      await db
        .delete(staffAccessGroups)
        .where(eq(staffAccessGroups.id, input.id));
      logAudit({
        action: "delete_staff_access_group",
        ...actorFromReq(ctx.req),
        detail: `ลบกลุ่มสิทธิ์ ${target.name}`,
        refType: "staff_access_group",
        refId: target.id,
      });
      return { ok: true };
    }),

  createStaff: adminQuery
    .input(
      z.object({
        username: z.string().min(3),
        pin: z.string().min(4),
        name: z.string().min(1),
        role: z.enum(["admin", "manager", "cashier"]).default("cashier"),
        accessGroupId: z.number().int().positive().nullable().optional(),
        menuPermissions: menuPermissionsInput.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const dup = await getDb().query.staffUsers.findFirst({
        where: eq(staffUsers.username, input.username),
      });
      if (dup) throw new Error("ชื่อผู้ใช้นี้ถูกใช้แล้ว");
      const accessGroup = input.accessGroupId
        ? await accessGroupForUser(input.accessGroupId)
        : null;
      if (input.accessGroupId && !accessGroup) {
        throw new Error("ไม่พบกลุ่มสิทธิ์");
      }
      if (accessGroup && accessGroup.role !== input.role) {
        throw new Error("กลุ่มสิทธิ์ไม่ตรงกับระดับผู้ใช้");
      }
      let menuPermissions = null;
      if (input.role !== "admin") {
        menuPermissions = effectiveMenuPermissions(
          input.role,
          input.menuPermissions
        );
        if (menuPermissions.length === 0) {
          throw new Error("ต้องเปิดสิทธิ์อย่างน้อย 1 เมนู");
        }
      }
      const [{ id }] = await getDb()
        .insert(staffUsers)
        .values({
          ...input,
          accessGroupId: input.role === "admin" ? null : input.accessGroupId,
          menuPermissions,
          pin: sha256(input.pin),
        })
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
        accessGroupId: z.number().int().positive().nullable().optional(),
        menuPermissions: menuPermissionsInput.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { id, pin, ...rest } = input;
      const db = getDb();
      const target = await db.query.staffUsers.findFirst({
        where: eq(staffUsers.id, id),
      });
      if (!target) throw new Error("ไม่พบพนักงาน");
      const patch: Record<string, unknown> = { ...rest };
      const nextRole = rest.role ?? target.role;
      const requestedGroupId =
        rest.accessGroupId !== undefined
          ? rest.accessGroupId
          : target.accessGroupId;
      const accessGroup = requestedGroupId
        ? await accessGroupForUser(requestedGroupId)
        : null;
      if (requestedGroupId && !accessGroup) {
        throw new Error("ไม่พบกลุ่มสิทธิ์");
      }
      if (nextRole === "admin") {
        patch.accessGroupId = null;
      } else if (accessGroup && accessGroup.role !== nextRole) {
        if (rest.accessGroupId !== undefined) {
          throw new Error("กลุ่มสิทธิ์ไม่ตรงกับระดับผู้ใช้");
        }
        patch.accessGroupId = null;
      }
      if (rest.menuPermissions !== undefined) {
        const normalized = effectiveMenuPermissions(
          nextRole,
          rest.menuPermissions
        );
        if (nextRole !== "admin" && normalized.length === 0) {
          throw new Error("ต้องเปิดสิทธิ์อย่างน้อย 1 เมนู");
        }
        patch.menuPermissions = nextRole === "admin" ? null : normalized;
      } else if (rest.role === "admin") {
        patch.menuPermissions = null;
      }
      if (pin) patch.pin = sha256(pin);
      await db.update(staffUsers).set(patch).where(eq(staffUsers.id, id));
      // อธิบายสิ่งที่แก้ — ห้ามใส่ PIN ลง log
      const changes: string[] = [];
      if (rest.name !== undefined && rest.name !== target.name)
        changes.push(`ชื่อ ${target.name}→${rest.name}`);
      if (rest.username !== undefined && rest.username !== target.username) {
        changes.push(`username ${target.username}→${rest.username}`);
      }
      if (rest.role !== undefined && rest.role !== target.role)
        changes.push(`role ${target.role}→${rest.role}`);
      if (rest.active !== undefined && rest.active !== target.active) {
        changes.push(rest.active ? "เปิดใช้งาน" : "ปิดใช้งาน");
      }
      if (rest.accessGroupId !== undefined) {
        changes.push(
          accessGroup ? `กลุ่มสิทธิ์ ${accessGroup.name}` : "ยกเลิกกลุ่มสิทธิ์"
        );
      }
      if (rest.menuPermissions !== undefined) {
        changes.push(
          `สิทธิ์เมนู ${effectiveMenuPermissions(nextRole, rest.menuPermissions).length} เมนู`
        );
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
      const admins = (await db.query.staffUsers.findMany()).filter(
        u => u.role === "admin" && u.active
      );
      const target = await db.query.staffUsers.findFirst({
        where: eq(staffUsers.id, input.id),
      });
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
