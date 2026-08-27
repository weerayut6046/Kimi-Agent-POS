import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

function commandSucceeds(command, args, env) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      stdio: "ignore",
      env,
      shell: false,
      windowsHide: true,
    });
    child.once("error", () => resolve(false));
    child.once("exit", code => resolve(code === 0));
  });
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function dockerDesktopPath(env) {
  const candidates = [
    env.ProgramFiles
      ? path.join(env.ProgramFiles, "Docker", "Docker", "Docker Desktop.exe")
      : "",
    env.LOCALAPPDATA
      ? path.join(env.LOCALAPPDATA, "Docker", "Docker Desktop.exe")
      : "",
  ];
  return candidates.find(candidate => candidate && existsSync(candidate));
}

/** Ensure Docker Engine is reachable, starting Docker Desktop on Windows when needed. */
export async function ensureDockerEngine(env = process.env) {
  if (
    await commandSucceeds(
      "docker",
      ["info", "--format", "{{.ServerVersion}}"],
      env
    )
  ) {
    return;
  }

  if (process.platform !== "win32") {
    throw new Error(
      "Docker Engine is not running. Start Docker Desktop/Engine and try again."
    );
  }

  const desktop = dockerDesktopPath(env);
  if (!desktop) {
    throw new Error(
      "Docker Desktop is not installed. Install it, start it once, then run this command again."
    );
  }

  console.log(">> Docker Engine is offline; starting Docker Desktop...");
  const desktopProcess = spawn(desktop, [], {
    detached: true,
    stdio: "ignore",
    env,
    shell: false,
    windowsHide: true,
  });
  desktopProcess.unref();

  for (let attempt = 1; attempt <= 60; attempt += 1) {
    await wait(1_000);
    if (
      await commandSucceeds(
        "docker",
        ["info", "--format", "{{.ServerVersion}}"],
        env
      )
    ) {
      console.log(">> Docker Engine is ready.");
      return;
    }
    if (attempt % 10 === 0) {
      console.log(`>> Waiting for Docker Engine... ${attempt}s`);
    }
  }

  throw new Error(
    "Docker Desktop started but the Engine was not ready within 60 seconds. Open Docker Desktop to inspect its status, then retry."
  );
}
