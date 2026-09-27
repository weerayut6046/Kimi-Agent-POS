import { TRPCError } from "@trpc/server";
import {
  isProcedureAllowedInDeployment,
  resolveDeploymentMode,
  type DeploymentInfo,
  type DeploymentMode,
} from "@contracts/deployment";

/** Server configuration is authoritative; request headers never select a deployment. */
export function getDeploymentMode(): DeploymentMode {
  const deno = (
    globalThis as typeof globalThis & {
      Deno?: { env?: { get(name: string): string | undefined } };
    }
  ).Deno;
  const value =
    deno?.env?.get("PUMPPOS_DEPLOYMENT_MODE") ??
    process.env.PUMPPOS_DEPLOYMENT_MODE;
  return resolveDeploymentMode(value);
}

export function getDeploymentInfo(): DeploymentInfo {
  return { mode: getDeploymentMode(), isolation: "dedicated_database" };
}

export function requirePlatformDeployment(): void {
  if (getDeploymentMode() !== "platform") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "งานบริหาร SaaS ใช้งานได้เฉพาะระบบส่วนกลาง",
    });
  }
}

export function requireBusinessDeployment(): void {
  if (getDeploymentMode() !== "business") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "งานของกิจการใช้งานได้เฉพาะระบบกิจการนั้น",
    });
  }
}

export function assertDeploymentProcedure(path: string): void {
  if (!isProcedureAllowedInDeployment(getDeploymentMode(), path)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "คำสั่งนี้ไม่อยู่ในขอบเขตของระบบที่กำลังใช้งาน",
    });
  }
}
