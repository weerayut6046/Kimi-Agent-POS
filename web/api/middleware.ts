import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import {
  activeStaffSessionFromRequest,
  clearActiveStaffCache,
} from "./lib/authorization";
import { publishRealtimeInvalidation } from "./lib/realtime";
import { eq } from "drizzle-orm";
import { staffAccessGroups, staffUsers } from "@db/schema";
import { getDb } from "./queries/connection";
import {
  hasMenuPermission,
  type MenuPermissionKey,
} from "@contracts/menuPermissions";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  // Stack traces contain internal file paths and implementation details.
  // Keep them available only in the isolated automated-test environment.
  isDev: process.env.NODE_ENV === "test",
});

export const createRouter = t.router;

/** Only endpoints that are safe before login may use this procedure. */
export const anonymousQuery = t.procedure;

/**
 * Historical name retained to avoid a broad router rename. Despite the name,
 * every procedure built from publicQuery now requires a signed staff session.
 */
export const authenticatedStaffAction = t.procedure.use(
  async ({ ctx, next }) => {
    const staff = await activeStaffSessionFromRequest(ctx.req);
    if (!staff) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
      });
    }
    return next({ ctx: { ...ctx, staff } });
  }
);

function requiredMenuForPath(path: string): MenuPermissionKey | null {
  if (path.startsWith("membership.")) return "members";
  if (path.startsWith("customers.")) return "customers";
  if (path.startsWith("credit.")) return "debts";
  if (path.startsWith("expenses.")) return "expenses";
  if (path.startsWith("reports.")) return "reports";
  if (path.startsWith("taxInvoice.")) return "tax_invoices";
  if (path.startsWith("audit.")) return "audit";
  if (path.startsWith("workforce.")) return "workforce";
  if (
    path.startsWith("pos.shift") ||
    path === "pos.openShift" ||
    path === "pos.closeShift"
  ) {
    return "shifts";
  }
  if (
    path === "pos.salesHistory" ||
    path === "pos.saleDetail" ||
    path === "pos.updateSale" ||
    path === "pos.voidSale"
  ) {
    return "sales";
  }
  if (path === "pos.createSale" || path === "pos.dashboard") return "pos";
  return null;
}

async function canUseProcedureMenu(
  staff: TrpcContext["staff"] & NonNullable<TrpcContext["staff"]>,
  path: string,
): Promise<boolean> {
  const requiredMenu = requiredMenuForPath(path);
  if (!requiredMenu || staff.role === "admin") return true;
  const user = await getDb().query.staffUsers.findFirst({
    columns: {
      role: true,
      menuPermissions: true,
      accessGroupId: true,
    },
    where: eq(staffUsers.id, staff.id),
  });
  if (!user) return false;
  const accessGroup = user.accessGroupId
    ? await getDb().query.staffAccessGroups.findFirst({
        columns: { role: true, menuPermissions: true },
        where: eq(staffAccessGroups.id, user.accessGroupId),
      })
    : null;
  const stored =
    accessGroup?.role === user.role
      ? accessGroup.menuPermissions
      : user.menuPermissions;
  return hasMenuPermission(user.role, stored, requiredMenu);
}

export const publicQuery = authenticatedStaffAction.use(
  async ({ ctx, path, type, next }) => {
    if (!(await canUseProcedureMenu(ctx.staff, path))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "สิทธิ์ไม่เพียงพอสำหรับเมนูที่ร้องขอ",
      });
    }
    const result = await next();
    if (type === "mutation" && result.ok) {
      if (path.startsWith("auth.")) clearActiveStaffCache();
      publishRealtimeInvalidation(ctx.staff.branchId);
    }
    return result;
  }
);
