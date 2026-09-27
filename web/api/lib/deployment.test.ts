import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertDeploymentProcedure,
  getDeploymentInfo,
  getDeploymentMode,
} from "./deployment";

afterEach(() => vi.unstubAllEnvs());

describe("server deployment configuration", () => {
  it("uses server configuration and reports only public deployment information", () => {
    vi.stubEnv("PUMPPOS_DEPLOYMENT_MODE", "platform");
    expect(getDeploymentInfo()).toEqual({
      mode: "platform",
      isolation: "dedicated_database",
    });
    expect(() => assertDeploymentProcedure("pos.checkout")).toThrow();
    expect(() => assertDeploymentProcedure("platform.overview")).not.toThrow();
  });

  it("does not silently turn invalid configuration into a business deployment", () => {
    vi.stubEnv("PUMPPOS_DEPLOYMENT_MODE", "invalid");
    expect(() => getDeploymentMode()).toThrow("PUMPPOS_DEPLOYMENT_MODE");
    expect(() => assertDeploymentProcedure("pos.checkout")).toThrow();
  });
});
