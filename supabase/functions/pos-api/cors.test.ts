import { describe, expect, it } from "vitest";
import {
  createAllowedOrigins,
  createCorsResponseHeaders,
} from "./cors";

describe("pos-api CORS", () => {
  it("allows both exact local preview origins", () => {
    const origins = createAllowedOrigins(
      "https://kimi-agent-pos.vercel.app",
    );

    expect(origins.has("http://127.0.0.1:3000")).toBe(true);
    expect(origins.has("http://localhost:3000")).toBe(true);
  });

  it("does not allow arbitrary loopback ports", () => {
    const origins = createAllowedOrigins(
      "https://kimi-agent-pos.vercel.app",
    );

    expect(origins.has("http://127.0.0.1:49152")).toBe(false);
    expect(origins.has("http://localhost:5173")).toBe(false);
  });

  it("returns the complete preflight headers only for an allowed origin", () => {
    const origins = createAllowedOrigins(
      "https://kimi-agent-pos.vercel.app",
    );
    const allowed = createCorsResponseHeaders(
      "http://localhost:3000",
      origins,
    );
    const blocked = createCorsResponseHeaders(
      "https://untrusted.example",
      origins,
    );

    expect(allowed.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
    expect(allowed.get("access-control-allow-methods")).toBe(
      "GET,POST,OPTIONS",
    );
    expect(allowed.get("access-control-allow-headers")).toContain(
      "authorization",
    );
    expect(blocked.has("access-control-allow-origin")).toBe(false);
  });
});
