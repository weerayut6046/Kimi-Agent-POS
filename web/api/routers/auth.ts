import { z } from "zod";
import { createHash } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  anonymousQuery,
  authenticatedStaffAction,
  createRouter,
  publicQuery,
} from "../middleware";
import { adminQuery, staffIdFromHeader } from "../guard";
import { getDb } from "../queries/connection";
import {
  branches,
  fuelTanks,
  nozzles,
  products,
  pumps,
  rewards,
  settings,
  staffAccessGroups,
  staffBranches,
  staffUsers,
  workShiftTemplates,
} from "@db/schema";
import { actorFromReq, logAudit } from "../lib/audit";
import {
  createSupabaseStaffIdentity,
  deleteSupabaseStaffIdentity,
  updateSupabaseStaffIdentity,
} from "../lib/supabaseAuth";
import { isValidStaffUsername, normalizeStaffUsername } from "@contracts/auth";
import {
  MENU_PERMISSION_KEYS,
  normalizeMenuPermissions,
  type StaffRole,
} from "@contracts/menuPermissions";
import { DEFAULT_SETTINGS } from "@contracts/settings";
import {
  accessibleBranchesForStaff,
  type AccessibleBranch,
} from "../lib/branches";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const menuPermissionsInput = z.array(z.enum(MENU_PERMISSION_KEYS)).min(1);
const staffPasswordInput = z
  .string()
  .min(10, "รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร")
  .max(128, "รหัสผ่านต้องไม่เกิน 128 ตัวอักษร")
  .refine(
    value => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value),
    "รหัสผ่านต้องมีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ และตัวเลข"
  );

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

function accessGroupSummary(
  group: { id: number; name: string } | null | undefined
) {
  return group ? { id: group.id, name: group.name } : null;
}

function branchSummary(branch: AccessibleBranch) {
  return {
    id: branch.id,
    code: branch.code,
    name: branch.name,
    address: branch.address,
    phone: branch.phone,
    taxId: branch.taxId,
    active: branch.active,
  };
}

async function staffSessionResponse(
  user: typeof staffUsers.$inferSelect,
  requestedBranchId?: number
) {
  const [availableBranches, accessGroup] = await Promise.all([
    accessibleBranchesForStaff(user),
    accessGroupForUser(user.accessGroupId),
  ]);
  const branch = requestedBranchId
    ? (availableBranches.find(
        candidate => candidate.id === requestedBranchId
      ) ?? null)
    : (availableBranches[0] ?? null);
  if (!branch) {
    throw new Error("บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าใช้งานสาขา");
  }
  const staff = {
    id: user.id,
    name: user.name,
    role: user.role,
    username: user.username,
    branchId: branch.id,
    branchCode: branch.code,
    branchName: branch.name,
  };
  return {
    ...staff,
    branch: branchSummary(branch),
    branches: availableBranches.map(branchSummary),
    menuPermissions: effectiveMenuPermissions(
      user.role,
      user.menuPermissions,
      accessGroup
    ),
    accessGroup: accessGroupSummary(accessGroup),
  };
}

export const authRouter = createRouter({
  login: anonymousQuery
    .input(z.object({ username: z.string().min(1), pin: z.string().min(1) }))
    .mutation(async ({ input }) => {
      if (process.env.NODE_ENV !== "test") {
        throw new Error(
          "This login endpoint is disabled. Sign in with Supabase Auth."
        );
      }
      const db = getDb();
      const user = await db.query.staffUsers.findFirst({
        where: eq(staffUsers.username, input.username),
      });
      if (!user || user.pin !== sha256(input.pin) || !user.active) {
        throw new Error("ชื่อผู้ใช้หรือรหัส PIN ไม่ถูกต้อง");
      }
      return staffSessionResponse(user);
    }),

  // Compatibility no-op for older clients. Supabase Auth now owns the only
  // browser session and no secondary credentials are issued here.
  realtimeSession: authenticatedStaffAction.mutation(() => null),

  currentStaff: authenticatedStaffAction
    .input(
      z
        .object({
          sessionNonce: z.number().int().nonnegative().optional(),
        })
        .optional()
    )
    .query(async ({ ctx }) => {
      const session = ctx.staff;
      const user = await getDb().query.staffUsers.findFirst({
        where: eq(staffUsers.id, session.id),
      });
      if (!user?.active) throw new Error("Staff account is disabled");
      const staff = await staffSessionResponse(user, session.branchId);
      return {
        authenticated: true as const,
        ...staff,
      };
    }),

  switchBranch: authenticatedStaffAction
    .input(z.object({ branchId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.staff.role !== "admin") {
        throw new Error("เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถเปลี่ยนสาขาได้");
      }
      const user = await getDb().query.staffUsers.findFirst({
        where: eq(staffUsers.id, ctx.staff.id),
      });
      if (!user?.active) throw new Error("ไม่พบบัญชีพนักงาน");
      return {
        ...(await staffSessionResponse(user, input.branchId)),
      };
    }),

  listBranches: publicQuery.query(async ({ ctx }) =>
    (await accessibleBranchesForStaff(ctx.staff)).map(branchSummary)
  ),

  listAllBranches: adminQuery.query(async ({ ctx }) =>
    (await accessibleBranchesForStaff(ctx.staff, true)).map(branchSummary)
  ),

  createBranch: adminQuery
    .input(
      z.object({
        code: z
          .string()
          .trim()
          .min(2)
          .max(20)
          .regex(/^[A-Za-z0-9_-]+$/)
          .transform(value => value.toUpperCase()),
        name: z.string().trim().min(1).max(120),
        address: z.string().trim().max(500).default(""),
        phone: z.string().trim().max(40).default(""),
        taxId: z.string().trim().max(30).default(""),
        cloneCurrentSetup: z.boolean().default(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const duplicate = await db.query.branches.findFirst({
        where: eq(branches.code, input.code),
      });
      if (duplicate) throw new Error("รหัสสาขานี้ถูกใช้แล้ว");

      const created = await db.transaction(async tx => {
        const [branch] = await tx
          .insert(branches)
          .values({
            code: input.code,
            name: input.name,
            address: input.address,
            phone: input.phone,
            taxId: input.taxId,
          })
          .returning();

        const sourceBranchId = ctx.staff.branchId;
        const sourceSettings = input.cloneCurrentSetup
          ? await tx
              .select()
              .from(settings)
              .where(eq(settings.branchId, sourceBranchId))
          : [];
        const settingMap = {
          ...DEFAULT_SETTINGS,
          ...Object.fromEntries(
            sourceSettings.map(row => [row.key, row.value])
          ),
          shop_branch: input.name,
          shop_address: input.address || DEFAULT_SETTINGS.shop_address,
          shop_phone: input.phone || DEFAULT_SETTINGS.shop_phone,
          tax_id: input.taxId || DEFAULT_SETTINGS.tax_id,
          receipt_next_no: "1",
          tax_invoice_next_no: "1",
          tank_display_order: "",
        };
        await tx.insert(settings).values(
          Object.entries(settingMap).map(([key, value]) => ({
            branchId: branch.id,
            key,
            value,
          }))
        );

        if (input.cloneCurrentSetup) {
          const productMap = new Map<number, number>();
          const sourceProducts = await tx
            .select()
            .from(products)
            .where(eq(products.branchId, sourceBranchId));
          for (const source of sourceProducts) {
            const {
              id: sourceId,
              branchId: _branchId,
              createdAt: _createdAt,
              ...copy
            } = source;
            const [target] = await tx
              .insert(products)
              .values({
                ...copy,
                branchId: branch.id,
                stockQty: 0,
              })
              .returning({ id: products.id });
            productMap.set(sourceId, target.id);
          }

          const pumpMap = new Map<number, number>();
          const sourcePumps = await tx
            .select()
            .from(pumps)
            .where(eq(pumps.branchId, sourceBranchId));
          for (const source of sourcePumps) {
            const [target] = await tx
              .insert(pumps)
              .values({
                branchId: branch.id,
                name: source.name,
                active: source.active,
              })
              .returning({ id: pumps.id });
            pumpMap.set(source.id, target.id);
          }

          const tankMap = new Map<number, number>();
          const sourceTanks = await tx
            .select()
            .from(fuelTanks)
            .where(eq(fuelTanks.branchId, sourceBranchId));
          for (const source of sourceTanks) {
            const targetProductId = productMap.get(source.productId);
            if (!targetProductId) continue;
            const [target] = await tx
              .insert(fuelTanks)
              .values({
                branchId: branch.id,
                productId: targetProductId,
                name: source.name,
                capacityLiters: source.capacityLiters,
                currentLiters: 0,
                lowAlertAt: source.lowAlertAt,
              })
              .returning({ id: fuelTanks.id });
            tankMap.set(source.id, target.id);
          }

          const sourceNozzles = await tx
            .select()
            .from(nozzles)
            .where(eq(nozzles.branchId, sourceBranchId));
          for (const source of sourceNozzles) {
            const pumpId = pumpMap.get(source.pumpId);
            const productId = productMap.get(source.productId);
            if (!pumpId || !productId) continue;
            await tx.insert(nozzles).values({
              branchId: branch.id,
              pumpId,
              productId,
              tankId:
                source.tankId == null
                  ? null
                  : (tankMap.get(source.tankId) ?? null),
              label: source.label,
              currentMeter: 0,
              currentMoney: 0,
              active: source.active,
            });
          }

          const sourceRewards = await tx
            .select()
            .from(rewards)
            .where(eq(rewards.branchId, sourceBranchId));
          if (sourceRewards.length > 0) {
            await tx.insert(rewards).values(
              sourceRewards.map(source => ({
                branchId: branch.id,
                name: source.name,
                pointsRequired: source.pointsRequired,
                stock: 0,
                active: source.active,
              }))
            );
          }

          const sourceTemplates = await tx
            .select()
            .from(workShiftTemplates)
            .where(eq(workShiftTemplates.branchId, sourceBranchId));
          if (sourceTemplates.length > 0) {
            await tx.insert(workShiftTemplates).values(
              sourceTemplates.map(source => ({
                branchId: branch.id,
                name: source.name,
                startTime: source.startTime,
                endTime: source.endTime,
                breakMinutes: source.breakMinutes,
                active: source.active,
              }))
            );
          }
        }

        const admins = await tx.query.staffUsers.findMany({
          where: eq(staffUsers.role, "admin"),
          columns: { id: true },
        });
        if (admins.length > 0) {
          await tx
            .insert(staffBranches)
            .values(
              admins.map(admin => ({
                staffId: admin.id,
                branchId: branch.id,
                isDefault: false,
              }))
            )
            .onConflictDoNothing();
        }
        return branch;
      });

      logAudit({
        action: "create_branch",
        ...actorFromReq(ctx.req),
        detail: `เพิ่มสาขา ${created.code} ${created.name}`,
        refType: "branch",
        refId: created.id,
      });
      return { ok: true, branch: branchSummary(created) };
    }),

  updateBranch: adminQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(1).max(120).optional(),
        address: z.string().trim().max(500).optional(),
        phone: z.string().trim().max(40).optional(),
        taxId: z.string().trim().max(30).optional(),
        active: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const target = await db.query.branches.findFirst({
        where: eq(branches.id, input.id),
      });
      if (!target) throw new Error("ไม่พบสาขา");
      if (input.active === false && input.id === ctx.staff.branchId) {
        throw new Error("ปิดสาขาที่กำลังใช้งานอยู่ไม่ได้");
      }
      const { id, ...patch } = input;
      await db.transaction(async tx => {
        await tx
          .update(branches)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(branches.id, id));
        const settingUpdates: Array<{ key: string; value: string }> = [];
        if (input.name !== undefined)
          settingUpdates.push({ key: "shop_branch", value: input.name });
        if (input.address !== undefined)
          settingUpdates.push({ key: "shop_address", value: input.address });
        if (input.phone !== undefined)
          settingUpdates.push({ key: "shop_phone", value: input.phone });
        if (input.taxId !== undefined)
          settingUpdates.push({ key: "tax_id", value: input.taxId });
        if (settingUpdates.length > 0) {
          await tx
            .insert(settings)
            .values(
              settingUpdates.map(setting => ({
                branchId: id,
                ...setting,
              }))
            )
            .onConflictDoUpdate({
              target: [settings.branchId, settings.key],
              set: { value: input.name ?? target.name },
            });
          // Each key may have a different value; update them explicitly after
          // the conflict-safe insert.
          for (const setting of settingUpdates) {
            await tx
              .update(settings)
              .set({ value: setting.value })
              .where(
                and(eq(settings.branchId, id), eq(settings.key, setting.key))
              );
          }
        }
      });
      logAudit({
        action: "update_branch",
        ...actorFromReq(ctx.req),
        detail: `แก้ไขสาขา ${target.code} ${target.name}`,
        refType: "branch",
        refId: target.id,
      });
      return { ok: true };
    }),

  listStaff: publicQuery.query(async ({ ctx }) => {
    const db = getDb();
    const memberships = await db
      .select({ staffId: staffBranches.staffId })
      .from(staffBranches)
      .where(eq(staffBranches.branchId, ctx.staff.branchId));
    const staffIds = memberships.map(membership => membership.staffId);
    if (staffIds.length === 0) return [];
    const rows = await db.query.staffUsers.findMany({
      where: inArray(staffUsers.id, staffIds),
    });
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
    const [rows, groups, memberships] = await Promise.all([
      db.query.staffUsers.findMany(),
      db.query.staffAccessGroups.findMany(),
      db.query.staffBranches.findMany(),
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
          branchIds: memberships
            .filter(membership => membership.staffId === rest.id)
            .map(membership => membership.branchId),
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
        username: z
          .string()
          .min(3)
          .refine(
            isValidStaffUsername,
            "Username must use English letters and numbers"
          ),
        password: staffPasswordInput,
        name: z.string().min(1),
        role: z.enum(["admin", "manager", "cashier"]).default("cashier"),
        accessGroupId: z.number().int().positive().nullable().optional(),
        menuPermissions: menuPermissionsInput.optional(),
        branchIds: z.array(z.number().int().positive()).min(1).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const username = normalizeStaffUsername(input.username);
      const dup = await db.query.staffUsers.findFirst({
        where: eq(staffUsers.username, username),
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
      const branchIds = [...new Set(input.branchIds ?? [ctx.staff.branchId])];
      const validBranches = await db.query.branches.findMany({
        where: inArray(branches.id, branchIds),
        columns: { id: true, active: true },
      });
      if (
        validBranches.length !== branchIds.length ||
        validBranches.some(branch => !branch.active)
      ) {
        throw new Error("มีสาขาที่เลือกไม่ถูกต้องหรือปิดใช้งานอยู่");
      }
      const {
        branchIds: _branchIds,
        password,
        username: _username,
        ...staffInput
      } = input;
      const defaultBranchId = branchIds.includes(ctx.staff.branchId)
        ? ctx.staff.branchId
        : branchIds[0];
      const identity = await createSupabaseStaffIdentity({
        username,
        password,
        name: input.name,
        role: input.role,
      });
      let id: number;
      try {
        id = await db.transaction(async tx => {
          const [created] = await tx
            .insert(staffUsers)
            .values({
              ...staffInput,
              username,
              accessGroupId:
                input.role === "admin" ? null : input.accessGroupId,
              menuPermissions,
              pin: `supabase-auth:${identity.id}`,
              supabaseAuthUserId: identity.id,
            })
            .returning({ id: staffUsers.id });
          await tx.insert(staffBranches).values(
            branchIds.map(branchId => ({
              staffId: created.id,
              branchId,
              isDefault: branchId === defaultBranchId,
            }))
          );
          return created.id;
        });
      } catch (error) {
        await deleteSupabaseStaffIdentity(identity.id).catch(() => undefined);
        throw error;
      }
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
        username: z
          .string()
          .min(3)
          .refine(
            isValidStaffUsername,
            "Username must use English letters and numbers"
          )
          .optional(),
        password: staffPasswordInput.optional(),
        role: z.enum(["admin", "manager", "cashier"]).optional(),
        active: z.boolean().optional(),
        accessGroupId: z.number().int().positive().nullable().optional(),
        menuPermissions: menuPermissionsInput.optional(),
        branchIds: z.array(z.number().int().positive()).min(1).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { id, password, branchIds: requestedBranchIds, ...rawRest } = input;
      const rest = {
        ...rawRest,
        ...(rawRest.username !== undefined
          ? { username: normalizeStaffUsername(rawRest.username) }
          : {}),
      };
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
      if (
        requestedBranchIds &&
        id === ctx.staff.id &&
        !requestedBranchIds.includes(ctx.staff.branchId)
      ) {
        throw new Error("นำสาขาที่กำลังใช้งานออกจากบัญชีตัวเองไม่ได้");
      }
      const branchIds = requestedBranchIds
        ? [...new Set(requestedBranchIds)]
        : null;
      if (branchIds) {
        const validBranches = await db.query.branches.findMany({
          where: inArray(branches.id, branchIds),
          columns: { id: true, active: true },
        });
        if (
          validBranches.length !== branchIds.length ||
          validBranches.some(branch => !branch.active)
        ) {
          throw new Error("มีสาขาที่เลือกไม่ถูกต้องหรือปิดใช้งานอยู่");
        }
      }
      await db.transaction(async tx => {
        await tx.update(staffUsers).set(patch).where(eq(staffUsers.id, id));
        if (branchIds) {
          const previousDefault = await tx.query.staffBranches.findFirst({
            where: and(
              eq(staffBranches.staffId, id),
              eq(staffBranches.isDefault, true)
            ),
            columns: { branchId: true },
          });
          await tx.delete(staffBranches).where(eq(staffBranches.staffId, id));
          const defaultBranchId =
            previousDefault && branchIds.includes(previousDefault.branchId)
              ? previousDefault.branchId
              : branchIds[0];
          await tx.insert(staffBranches).values(
            branchIds.map(branchId => ({
              staffId: id,
              branchId,
              isDefault: branchId === defaultBranchId,
            }))
          );
        }
      });
      let authUserId = target.supabaseAuthUserId;
      if (!authUserId && password) {
        const identity = await createSupabaseStaffIdentity({
          username: rest.username ?? target.username,
          password,
          name: rest.name ?? target.name,
          role: rest.role ?? target.role,
        });
        authUserId = identity.id;
        await db
          .update(staffUsers)
          .set({
            supabaseAuthUserId: identity.id,
            pin: `supabase-auth:${identity.id}`,
          })
          .where(eq(staffUsers.id, id));
      } else if (authUserId) {
        await updateSupabaseStaffIdentity(authUserId, {
          username: rest.username,
          password,
          name: rest.name,
          role: rest.role,
          active: rest.active,
        });
      }
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
      if (branchIds) changes.push(`สิทธิ์สาขา ${branchIds.length} สาขา`);
      if (password) changes.push("รีเซ็ตรหัสผ่าน Supabase Auth");
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
      if (target.supabaseAuthUserId) {
        await deleteSupabaseStaffIdentity(target.supabaseAuthUserId);
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
