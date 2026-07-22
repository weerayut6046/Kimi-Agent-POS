import { describe, expect, it } from "vitest";
import app from "./boot";

describe("realtime HTTP endpoint", () => {
  it("does not open a stream without a signed staff session", async () => {
    const response = await app.request("/api/realtime");

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});
