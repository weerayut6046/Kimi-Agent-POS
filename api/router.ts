import { createRouter, publicQuery } from "./middleware";
import { authRouter } from "./routers/auth";
import { catalogRouter } from "./routers/catalog";
import { posRouter } from "./routers/pos";
import { membershipRouter } from "./routers/membership";
import { taxInvoiceRouter } from "./routers/taxInvoice";
import { customersRouter } from "./routers/customers";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  catalog: catalogRouter,
  pos: posRouter,
  membership: membershipRouter,
  taxInvoice: taxInvoiceRouter,
  customers: customersRouter,
});

export type AppRouter = typeof appRouter;
