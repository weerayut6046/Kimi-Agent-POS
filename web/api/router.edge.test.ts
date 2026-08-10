import { describe, expect, it } from "vitest";
import { edgeAppRouter } from "./router.edge";

describe("Supabase Edge API router", () => {
  it("registers every security procedure used by the dashboard", () => {
    expect(Object.keys(edgeAppRouter._def.procedures)).toEqual(
      expect.arrayContaining([
        "security.overview",
        "security.events",
        "security.scan",
        "security.analyze",
        "security.reports",
        "security.setEventStatus",
      ])
    );
  });
});
