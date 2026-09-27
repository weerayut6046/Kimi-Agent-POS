import { describe, expect, it } from "vitest";
import {
  isProcedureAllowedInDeployment,
  resolveDeploymentMode,
} from "./deployment";

describe("deployment boundaries", () => {
  it("preserves business installations by default and rejects unknown configuration", () => {
    expect(resolveDeploymentMode()).toBe("business");
    expect(resolveDeploymentMode(" PLATFORM ")).toBe("platform");
    expect(() => resolveDeploymentMode("shared")).toThrow(
      "PUMPPOS_DEPLOYMENT_MODE"
    );
  });

  it.each([
    "pos.checkout",
    "catalog.listProducts",
    "membership.customerPoints",
    "customers.list",
    "dbadmin.restoreUpload",
    "auth.createBranch",
    "auth.listStaffAccess",
    "faceAuth.enrollFace",
    "auth.futureBusinessFeature",
    "onboarding.state",
    "onboarding.complete",
  ])("denies business procedure %s in the platform", path => {
    expect(isProcedureAllowedInDeployment("platform", path)).toBe(false);
    expect(isProcedureAllowedInDeployment("business", path)).toBe(true);
  });

  it.each([
    "ping",
    "auth.deploymentInfo",
    "auth.currentStaff",
    "faceAuth.beginFaceLogin",
    "faceAuth.completePasskeyLogin",
  ])(
    "keeps authentication procedure %s available in both deployments",
    path => {
      expect(isProcedureAllowedInDeployment("business", path)).toBe(true);
      expect(isProcedureAllowedInDeployment("platform", path)).toBe(true);
    }
  );

  it("keeps future SaaS endpoints within the platform boundary", () => {
    expect(
      isProcedureAllowedInDeployment("platform", "platform.futureFeature")
    ).toBe(true);
    expect(
      isProcedureAllowedInDeployment("business", "platform.futureFeature")
    ).toBe(false);
    expect(
      isProcedureAllowedInDeployment("platform", "platformSpoof.overview")
    ).toBe(false);
  });
});
