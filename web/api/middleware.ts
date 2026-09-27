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
  getApiMenuPermissions,
  hasMenuPermission,
} from "@contracts/menuPermissions";
import { systemAccessForRequest } from "./lib/systemAccess";
import { assertDeploymentProcedure, getDeploymentMode } from "./lib/deployment";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  // Stack traces contain internal file paths and implementation details.
  // Keep them available only in the isolated automated-test environment.
  isDev: process.env.NODE_ENV === "test",
  errorFormatter({ shape, error, path }) {
    if (
      path?.startsWith("faceAuth.") &&
      error.code === "INTERNAL_SERVER_ERROR"
    ) {
      const { stack: _stack, ...data } = shape.data;
      return {
        ...shape,
        message:
          "ระบบเข้าสู่ระบบขัดข้องชั่วคราว กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ",
        data,
      };
    }
    return shape;
  },
});

export const createRouter = t.router;

const deploymentProcedure = t.procedure.use(({ path, next }) => {
  assertDeploymentProcedure(path);
  return next();
});

/** Only endpoints that are safe before login may use this procedure. */
export const anonymousQuery = deploymentProcedure;

/**
 * Historical name retained to avoid a broad router rename. Despite the name,
 * every procedure built from publicQuery now requires a signed staff session.
 */
export const authenticatedStaffAction = deploymentProcedure.use(
  async ({ ctx, next }) => {
    const staff = await activeStaffSessionFromRequest(ctx.req);
    if (!staff) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
      });
    }
    if (getDeploymentMode() === "platform" && staff.role !== "admin") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "ระบบส่วนกลางสงวนไว้สำหรับผู้ดูแลแพลตฟอร์ม",
      });
    }
    return next({ ctx: { ...ctx, staff } });
  }
);

type PermissionSnapshot = {
  role: typeof staffUsers.$inferSelect.role;
  stored: typeof staffUsers.$inferSelect.menuPermissions;
} | null;

// A tRPC batch shares one Request. Read the current permissions once for its
// concurrent procedures, but release the snapshot before a later request.
const requestPermissionPromises = new WeakMap<
  Request,
  Promise<PermissionSnapshot>
>();

function permissionSnapshotForRequest(
  request: Request,
  staffId: number
): Promise<PermissionSnapshot> {
  const existing = requestPermissionPromises.get(request);
  if (existing) return existing;

  const pending = (async () => {
    const user = await getDb().query.staffUsers.findFirst({
      columns: {
        role: true,
        menuPermissions: true,
        accessGroupId: true,
      },
      where: eq(staffUsers.id, staffId),
    });
    if (!user) return null;
    const accessGroup = user.accessGroupId
      ? await getDb().query.staffAccessGroups.findFirst({
          columns: { role: true, menuPermissions: true },
          where: eq(staffAccessGroups.id, user.accessGroupId),
        })
      : null;
    return {
      role: user.role,
      stored:
        accessGroup?.role === user.role
          ? accessGroup.menuPermissions
          : user.menuPermissions,
    };
  })();
  requestPermissionPromises.set(request, pending);
  const clear = () =>
    queueMicrotask(() => {
      if (requestPermissionPromises.get(request) === pending) {
        requestPermissionPromises.delete(request);
      }
    });
  void pending.then(clear, clear);
  return pending;
}

async function canUseProcedureMenu(
  staff: TrpcContext["staff"] & NonNullable<TrpcContext["staff"]>,
  path: string,
  request: Request
): Promise<boolean> {
  const requiredMenus = getApiMenuPermissions(path);
  if (requiredMenus.length === 0 || staff.role === "admin") return true;
  const snapshot = await permissionSnapshotForRequest(request, staff.id);
  if (!snapshot) return false;
  return requiredMenus.some(requiredMenu =>
    hasMenuPermission(snapshot.role, snapshot.stored, requiredMenu)
  );
}

export const publicQuery = authenticatedStaffAction.use(
  async ({ ctx, path, type, next }) => {
    if (!(await canUseProcedureMenu(ctx.staff, path, ctx.req))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "สิทธิ์ไม่เพียงพอสำหรับเมนูที่ร้องขอ",
      });
    }
    const systemAccess = await systemAccessForRequest(ctx.req, ctx.staff);
    if (!systemAccess.allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          systemAccess.message ??
          "ไม่สามารถเข้าใช้งานระบบได้ในขณะที่กะของพนักงานคนอื่นกำลังทำงานอยู่",
      });
    }
    const result = await next();
    if (type === "mutation" && result.ok) {
      if (path.startsWith("auth.")) clearActiveStaffCache();
      if (getDeploymentMode() === "business") {
        publishRealtimeInvalidation(ctx.staff.branchId);
      }
    }
    return result;
  }
);
