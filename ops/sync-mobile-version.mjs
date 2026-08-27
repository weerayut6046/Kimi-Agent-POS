import { readFile, writeFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const match = /^(\d+)\.(\d+)\.(\d+)/.exec(packageJson.version);

if (!match) {
  throw new Error(`Invalid package version: ${packageJson.version}`);
}

const [, majorText, minorText, patchText] = match;
const major = Number(majorText);
const minor = Number(minorText);
const patch = Number(patchText);

if (minor >= 1_000 || patch >= 1_000) {
  throw new Error("Mobile version components must be lower than 1000");
}

const derivedBuildNumber = major * 1_000_000 + minor * 1_000 + patch;
const buildNumber = Number(process.env.MOBILE_BUILD_NUMBER ?? derivedBuildNumber);

if (!Number.isSafeInteger(buildNumber) || buildNumber < 1 || buildNumber > 2_100_000_000) {
  throw new Error(`Invalid MOBILE_BUILD_NUMBER: ${buildNumber}`);
}

async function replaceFile(path, replacements) {
  const source = await readFile(path, "utf8");
  let updated = source;
  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(updated)) {
      throw new Error(`Expected version field was not found in ${path}`);
    }
    updated = updated.replace(pattern, replacement);
  }
  if (updated !== source) await writeFile(path, updated, "utf8");
}

await replaceFile("android/app/build.gradle", [
  [/versionCode\s+\d+/, `versionCode ${buildNumber}`],
  [/versionName\s+"[^"]+"/, `versionName "${packageJson.version}"`],
]);

await replaceFile("ios/App/App.xcodeproj/project.pbxproj", [
  [/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${buildNumber};`],
  [/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${packageJson.version};`],
]);
