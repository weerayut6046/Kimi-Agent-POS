import { createRouter, publicQuery } from "./middleware";
import { authRouter } from "./routers/auth";
import { catalogRouter } from "./routers/catalog";
import { posRouter } from "./routers/pos";
import { membershipRouter } from "./routers/membership";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  catalog: catalogRouter,
  pos: posRouter,
  membership: membershipRouter,
});

export type AppRouter = typeof appRouter;
