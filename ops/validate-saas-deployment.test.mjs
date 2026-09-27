import assert from "node:assert/strict";
import { test } from "node:test";
import { validateDeploymentManifest } from "./validate-saas-deployment.mjs";

function plan() {
  return {
    platform: {
      appUrl: "https://admin.example.com",
      supabaseProjectRef: "a".repeat(20),
    },
    businesses: [
      {
        code: "STATION_A",
        appUrl: "https://a.example.com",
        supabaseProjectRef: "b".repeat(20),
      },
      {
        code: "STATION_B",
        appUrl: "https://b.example.com",
        supabaseProjectRef: "c".repeat(20),
      },
    ],
  };
}

test("accepts physically separate deployment resources", () => {
  assert.deepEqual(validateDeploymentManifest(plan()), {
    businesses: 2,
    isolation: "dedicated_database",
  });
});

test("rejects sharing the platform or another business database", () => {
  for (const ref of ["a".repeat(20), "b".repeat(20)]) {
    const manifest = plan();
    manifest.businesses[1].supabaseProjectRef = ref;
    assert.throws(
      () => validateDeploymentManifest(manifest),
      /project is shared/
    );
  }
});

test("rejects sharing browser origins or business codes", () => {
  const origin = plan();
  origin.businesses[1].appUrl = origin.businesses[0].appUrl + "/";
  assert.throws(() => validateDeploymentManifest(origin), /origin is shared/);
  const code = plan();
  code.businesses[1].code = code.businesses[0].code;
  assert.throws(
    () => validateDeploymentManifest(code),
    /Duplicate business code/
  );
});

test("rejects credentials, insecure public URLs and non-origin URLs", () => {
  for (const appUrl of [
    "javascript:alert(1)",
    "http://a.example.com",
    "https://user:pass@a.example.com",
    "https://a.example.com/pos",
    "https://a.example.com?token=x",
    "https://a.example.com#x",
    "https://localhost:3010",
    "https://internal",
  ]) {
    const manifest = plan();
    manifest.businesses[0].appUrl = appUrl;
    assert.throws(() => validateDeploymentManifest(manifest));
  }
});

test("permits localhost HTTP only when explicitly requested", () => {
  const manifest = plan();
  manifest.businesses[0].appUrl = "http://localhost:3010";
  assert.throws(() => validateDeploymentManifest(manifest));
  assert.equal(
    validateDeploymentManifest(manifest, { allowLocalhost: true }).businesses,
    2
  );
});
