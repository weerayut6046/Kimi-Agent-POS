import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { describe, expect, it } from "vitest";
import { createContext } from "./context";
import { appRouter } from "./router";
import { edgeAppRouter } from "./router.edge";

const retiredProcedures = [
  ["faceAuth.beginFaceLogin", "POST"],
  ["faceAuth.completeFaceLogin", "POST"],
  ["faceAuth.faceProfileList", "GET"],
  ["faceAuth.enrollFace", "POST"],
  ["faceAuth.deleteFaceProfile", "POST"],
  ["staffAuth.enrollFace", "POST"],
] as const;

describe.each([
  ["Node", appRouter],
  ["Edge", edgeAppRouter],
] as const)("%s retired face API", (_runtime, router) => {
  it.each(retiredProcedures)(
    "%s is unavailable to direct API requests",
    async (path, method) => {
      const response = await fetchRequestHandler({
        endpoint: "/api/trpc",
        req: new Request(`http://localhost/api/trpc/${path}`, {
          method,
          headers: { "content-type": "application/json" },
          body: method === "POST" ? JSON.stringify({ json: {} }) : undefined,
        }),
        router,
        createContext,
      });
      expect(response.status).toBe(404);
      const result = (await response.json()) as {
        error: Parameters<typeof superjson.deserialize>[0];
      };
      expect(
        superjson.deserialize<{ data: { code: string } }>(result.error).data
          .code
      ).toBe("NOT_FOUND");
    }
  );
});
