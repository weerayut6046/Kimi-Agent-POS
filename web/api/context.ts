import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { StaffSessionClaims } from "./lib/session";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  staff?: StaffSessionClaims;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  return { req: opts.req, resHeaders: opts.resHeaders };
}
