import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

function deploymentResource(value, label, allowLocalhost) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: deployment resource is required`);
  }
  if (
    typeof value.supabaseProjectRef !== "string" ||
    !/^[a-z0-9]{20}$/.test(value.supabaseProjectRef)
  ) {
    throw new Error(
      `${label}: Supabase project reference must be 20 lowercase letters/digits`
    );
  }
  const url = new URL(value.appUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (local && !allowLocalhost) ||
    (url.protocol !== "https:" &&
      !(allowLocalhost && local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !url.hostname ||
    (!local && !url.hostname.includes("."))
  ) {
    throw new Error(
      `${label}: appUrl must be a HTTPS origin without credentials, path, query or fragment`
    );
  }
  return { project: value.supabaseProjectRef, origin: url.origin };
}

export function validateDeploymentManifest(
  manifest,
  { allowLocalhost = false } = {}
) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !Array.isArray(manifest.businesses)
  ) {
    throw new Error("Manifest must contain platform and businesses");
  }
  const platform = deploymentResource(
    manifest.platform,
    "platform",
    allowLocalhost
  );
  const projects = new Set([platform.project]);
  const origins = new Set([platform.origin]);
  const codes = new Set();
  for (const business of manifest.businesses) {
    if (
      !business ||
      typeof business.code !== "string" ||
      !/^[A-Z0-9_-]{2,40}$/.test(business.code)
    ) {
      throw new Error(
        "Business code must contain 2-40 uppercase letters/digits, underscore or hyphen"
      );
    }
    if (codes.has(business.code))
      throw new Error(`Duplicate business code: ${business.code}`);
    const resource = deploymentResource(
      business,
      business.code,
      allowLocalhost
    );
    if (projects.has(resource.project))
      throw new Error(
        `${business.code}: Supabase project is shared with another deployment`
      );
    if (origins.has(resource.origin))
      throw new Error(
        `${business.code}: app origin is shared with another deployment`
      );
    codes.add(business.code);
    projects.add(resource.project);
    origins.add(resource.origin);
  }
  return {
    businesses: manifest.businesses.length,
    isolation: "dedicated_database",
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: node ops/validate-saas-deployment.mjs --manifest <path> [--allow-localhost]"
    );
    return;
  }
  const manifestIndex = args.indexOf("--manifest");
  if (
    manifestIndex < 0 ||
    !args[manifestIndex + 1] ||
    args.some(
      (arg, index) =>
        !["--manifest", "--allow-localhost"].includes(arg) &&
        index !== manifestIndex + 1
    )
  ) {
    throw new Error(
      "Usage: node ops/validate-saas-deployment.mjs --manifest <path> [--allow-localhost]"
    );
  }
  const manifest = JSON.parse(
    await fs.readFile(args[manifestIndex + 1], "utf8")
  );
  const result = validateDeploymentManifest(manifest, {
    allowLocalhost: args.includes("--allow-localhost"),
  });
  console.log(
    `Valid dedicated deployment plan: platform + ${result.businesses} businesses`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
