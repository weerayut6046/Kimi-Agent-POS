import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import {
  activeStaffSessionFromRequest,
  clearActiveStaffCache,
} from "./lib/authorization";
import { publishRealtimeInvalidation } from "./lib/realtime";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
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

export const publicQuery = authenticatedStaffAction.use(
  async ({ ctx, path, type, next }) => {
    const result = await next();
    if (type === "mutation" && result.ok) {
      if (path.startsWith("auth.")) clearActiveStaffCache();
      publishRealtimeInvalidation(ctx.staff.branchId);
    }
    return result;
  }
);
