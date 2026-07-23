/** Build an unsigned AppX/MSIX package for Microsoft Store submission. */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..", "..");
const packageMetadata = require(path.join(root, "package.json"));
const args = process.argv.slice(2);
const testIdentity = args.includes("--test-identity");
const validateOnly = args.includes("--validate-only");
const requiredIdentityVariables = [
  "PUMPPOS_STORE_IDENTITY_NAME",
  "PUMPPOS_STORE_PUBLISHER",
  "PUMPPOS_STORE_PUBLISHER_DISPLAY_NAME",
];

if (!testIdentity) {
  const missing = requiredIdentityVariables.filter(
    name => !process.env[name]?.trim()
  );
  if (missing.length > 0) {
    console.error(
      `Missing Partner Center product identity variables: ${missing.join(", ")}`
    );
    process.exit(1);
  }
}
if (validateOnly) {
  console.log(">> Partner Center product identity variables are configured.");
  process.exit(0);
}

const outputDir = path.join(
  root,
  "release",
  testIdentity ? "store-test" : "store"
);
const artifact = path.join(
  outputDir,
  `PumpPOS-Store-${packageMetadata.version}-x64.appx`
);

const signingVariables = [
  "WIN_CSC_LINK",
  "WIN_CSC_KEY_PASSWORD",
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
];
const childEnv = {
  ...process.env,
  PUMPPOS_STORE_TEST_IDENTITY: testIdentity ? "1" : "0",
};
for (const name of signingVariables) delete childEnv[name];

const electronBuilderCli = path.join(
  root,
  "node_modules",
  "electron-builder",
  "out",
  "cli",
  "cli.js"
);
const build = spawnSync(
  process.execPath,
  [
    electronBuilderCli,
    "--win",
    "appx",
    "--x64",
    "--config",
    "desktop/electron-builder.store.cjs",
  ],
  {
    cwd: root,
    env: childEnv,
    shell: false,
    stdio: "inherit",
  }
);

if (build.error) throw build.error;
if ((build.status ?? 1) !== 0) process.exit(build.status ?? 1);

const verifier = path.join(
  root,
  "desktop",
  "scripts",
  "verify-store-package.ps1"
);
const powershell = process.platform === "win32" ? "powershell.exe" : "pwsh";
const verify = spawnSync(
  powershell,
  [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    verifier,
    "-PackagePath",
    artifact,
    "-UnpackedDir",
    path.join(outputDir, "win-unpacked"),
    "-IdentityName",
    testIdentity
      ? "KimiAgentPumpPOS.Test"
      : childEnv.PUMPPOS_STORE_IDENTITY_NAME || "",
    "-Publisher",
    testIdentity
      ? "CN=KimiAgentPumpPOSTest"
      : childEnv.PUMPPOS_STORE_PUBLISHER || "",
    "-ApplicationId",
    childEnv.PUMPPOS_STORE_APPLICATION_ID || "PumpPOS",
    ...(testIdentity ? ["-TestIdentity"] : []),
  ],
  { cwd: root, shell: false, stdio: "inherit" }
);

if (verify.error) throw verify.error;
if ((verify.status ?? 1) !== 0) process.exit(verify.status ?? 1);

const uploadBuilder = path.join(
  root,
  "desktop",
  "scripts",
  "create-store-upload.ps1"
);
const upload = spawnSync(
  powershell,
  [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    uploadBuilder,
    "-PackagePath",
    artifact,
  ],
  { cwd: root, shell: false, stdio: "inherit" }
);
if (upload.error) throw upload.error;
process.exit(upload.status ?? 1);
