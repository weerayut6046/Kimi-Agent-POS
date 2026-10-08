import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { describe, expect, it } from "vitest";
import { createContext } from "./context";
import { anonymousQuery, createRouter } from "./middleware";

const sqlFailure =
  'Failed query: select "auth_user_id" from "staff_users" where "username" = $1\nparams: synthetic-login-user';
const serviceError =
  "ระบบเข้าสู่ระบบขัดข้องชั่วคราว กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ";
const invalidPinError = "ชื่อผู้ใช้หรือ PIN ไม่ถูกต้อง";

const testRouter = createRouter({
  initialSetup: createRouter({
    state: anonymousQuery.query(() => {
      throw new Error(sqlFailure);
    }),
    createOwner: anonymousQuery.mutation(() => {
      throw new Error("synthetic-installation-code-and-provider-secret");
    }),
  }),
  staffAuth: createRouter({
    loginWithPin: anonymousQuery.mutation(() => {
      throw new Error(sqlFailure);
    }),
    completePasskeyLogin: anonymousQuery.mutation(() => {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: sqlFailure,
        cause: new Error("synthetic database cause"),
      });
    }),
    invalidPin: anonymousQuery.mutation(() => {
      throw new TRPCError({ code: "UNAUTHORIZED", message: invalidPinError });
    }),
  }),
  catalog: createRouter({
    internalFailure: anonymousQuery.mutation(() => {
      throw new Error("Existing catalog error message");
    }),
  }),
});

type SerializedError = {
  message: string;
  data: { code: string; httpStatus: number; stack?: string; path?: string };
};

async function requestError(path: string) {
  const isQuery = path === "initialSetup.state";
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: new Request(`http://localhost/api/trpc/${path}`, {
      method: isQuery ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: isQuery ? undefined : JSON.stringify({ json: null }),
    }),
    router: testRouter,
    createContext,
  });
  const raw = await response.text();
  const error = superjson.deserialize<SerializedError>(JSON.parse(raw).error);
  return { response, raw, error };
}

describe("login error HTTP serialization", () => {
  it.each(["initialSetup.state", "initialSetup.createOwner"])(
    "removes installation details and stack from %s internal errors",
    async path => {
      const { response, raw, error } = await requestError(path);
      expect(response.status).toBe(500);
      expect(error.message).toBe(
        "ระบบตั้งค่าขัดข้องชั่วคราว กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ"
      );
      expect(raw).not.toContain("Failed query");
      expect(raw).not.toContain("synthetic-");
      expect(error.data).not.toHaveProperty("stack");
    }
  );
  it.each(["staffAuth.loginWithPin", "staffAuth.completePasskeyLogin"])(
    "removes SQL, parameters and stack from %s internal errors",
    async path => {
      const { response, raw, error } = await requestError(path);

      expect(response.status).toBe(500);
      expect(error.message).toBe(serviceError);
      expect(error.data).toEqual({
        code: "INTERNAL_SERVER_ERROR",
        httpStatus: 500,
        path,
      });
      expect(raw).not.toContain("Failed query");
      expect(raw).not.toContain("staff_users");
      expect(raw).not.toContain("synthetic-login-user");
      expect(raw).not.toContain("synthetic database cause");
      expect(raw).not.toContain("stack");
    }
  );

  it("preserves explicit invalid PIN feedback", async () => {
    const { response, error } = await requestError("staffAuth.invalidPin");

    expect(response.status).toBe(401);
    expect(error.message).toBe(invalidPinError);
    expect(error.data.code).toBe("UNAUTHORIZED");
  });

  it("keeps other modules' existing error formatting", async () => {
    const { response, error } = await requestError("catalog.internalFailure");

    expect(response.status).toBe(500);
    expect(error.message).toBe("Existing catalog error message");
    expect(error.data.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
