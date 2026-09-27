import { TRPCError } from "@trpc/server";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { saasBusinesses } from "@db/schema";
import { createRouter } from "../middleware";
import { adminQuery } from "../guard";
import { getDb } from "../queries/connection";
import { requirePlatformDeployment } from "../lib/deployment";
import { env } from "../lib/env";
import {
  isRegistryUniqueViolation,
  normalizeBusinessAppUrl,
} from "../lib/platformRegistry";
import { actorFromReq, logAudit } from "../lib/audit";

const businessFields = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,40}$/),
  name: z.string().trim().min(1).max(160),
  contactEmail: z
    .string()
    .trim()
    .max(254)
    .pipe(z.union([z.literal(""), z.email()])),
  contactPhone: z.string().trim().max(40),
  status: z.enum(["active", "paused"]),
  appUrl: z.string().trim().min(1).max(2048),
  supabaseProjectRef: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]{20}$/),
  notes: z.string().trim().max(2000),
};
const createBusinessInput = z
  .object({
    ...businessFields,
    contactEmail: businessFields.contactEmail.default(""),
    contactPhone: businessFields.contactPhone.default(""),
    status: businessFields.status.default("active"),
    notes: businessFields.notes.default(""),
  })
  .strict();
// Defaults belong only to create: a partial update must preserve omitted fields.
const updateBusinessInput = z
  .object(businessFields)
  .partial()
  .extend({ id: z.uuid() })
  .strict()
  .refine(
    input => Object.keys(input).length > 1,
    "กรุณาระบุข้อมูลที่ต้องการแก้ไข"
  );

function validateProjectRef(ref: string): void {
  if (ref === env.supabaseProjectRef.toLowerCase()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "กิจการต้องใช้ Supabase project แยกจากระบบส่วนกลาง",
    });
  }
}

function canonicalAppUrl(value: string): string {
  try {
    return normalizeBusinessAppUrl(value, !env.isProduction);
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "URL ของแอปไม่ถูกต้อง",
    });
  }
}

function rethrowRegistryError(error: unknown): never {
  if (isRegistryUniqueViolation(error)) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "รหัสกิจการ URL ของแอป หรือ Supabase project นี้ถูกลงทะเบียนแล้ว",
    });
  }
  throw error;
}

export const platformRouter = createRouter({
  overview: adminQuery.query(async () => {
    requirePlatformDeployment();
    const [summary] = await getDb()
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${saasBusinesses.status} = 'active')::int`,
        paused: sql<number>`count(*) filter (where ${saasBusinesses.status} = 'paused')::int`,
      })
      .from(saasBusinesses);
    return { ...summary, isolationModel: "dedicated-project" as const };
  }),
  listBusinesses: adminQuery
    .input(
      z
        .object({
          q: z.string().trim().max(160).optional(),
          status: z.enum(["active", "paused"]).optional(),
        })
        .strict()
        .optional()
    )
    .query(async ({ input }) => {
      requirePlatformDeployment();
      const query = input?.q?.replace(/[\\%_]/g, "\\$&");
      return getDb()
        .select()
        .from(saasBusinesses)
        .where(
          and(
            input?.status ? eq(saasBusinesses.status, input.status) : undefined,
            query
              ? or(
                  ilike(saasBusinesses.code, `%${query}%`),
                  ilike(saasBusinesses.name, `%${query}%`),
                  ilike(saasBusinesses.contactEmail, `%${query}%`)
                )
              : undefined
          )
        )
        .orderBy(asc(saasBusinesses.name), asc(saasBusinesses.code));
    }),
  createBusiness: adminQuery
    .input(createBusinessInput)
    .mutation(async ({ input, ctx }) => {
      requirePlatformDeployment();
      validateProjectRef(input.supabaseProjectRef);
      const appUrl = canonicalAppUrl(input.appUrl);
      try {
        // This is a directory entry, not provisioning or remote database access.
        const [business] = await getDb()
          .insert(saasBusinesses)
          .values({ ...input, appUrl })
          .returning();
        logAudit({
          action: "register_saas_business",
          ...actorFromReq(ctx.req),
          detail: `ลงทะเบียนกิจการ ${business.code} (${business.id})`,
          refType: "saas_business",
        });
        return business;
      } catch (error) {
        rethrowRegistryError(error);
      }
    }),
  updateBusiness: adminQuery
    .input(updateBusinessInput)
    .mutation(async ({ input, ctx }) => {
      requirePlatformDeployment();
      const { id, ...fields } = input;
      if (fields.supabaseProjectRef)
        validateProjectRef(fields.supabaseProjectRef);
      const appUrl = fields.appUrl ? canonicalAppUrl(fields.appUrl) : undefined;
      try {
        const [business] = await getDb()
          .update(saasBusinesses)
          .set({ ...fields, appUrl, updatedAt: new Date() })
          .where(eq(saasBusinesses.id, id))
          .returning();
        if (!business) {
          throw new TRPCError({ code: "NOT_FOUND", message: "ไม่พบกิจการนี้" });
        }
        logAudit({
          action: "update_saas_business",
          ...actorFromReq(ctx.req),
          detail: `แก้ไขทะเบียนกิจการ ${business.code} (${business.id})`,
          refType: "saas_business",
        });
        return business;
      } catch (error) {
        rethrowRegistryError(error);
      }
    }),
});
