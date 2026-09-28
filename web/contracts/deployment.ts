export const DEPLOYMENT_MODES = ["business", "platform"] as const;

export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];
export type BusinessWorkspace = "pos" | "backoffice";

export type DeploymentInfo = {
  mode: DeploymentMode;
  isolation: "dedicated_database";
};

/** Existing installations keep their business workspace until explicitly configured. */
export function resolveDeploymentMode(value?: string): DeploymentMode {
  const mode = value?.trim().toLowerCase() || "business";
  if (mode === "business" || mode === "platform") return mode;
  throw new Error("PUMPPOS_DEPLOYMENT_MODE must be business or platform");
}

// The platform has its own database and identities. Business administration
// endpoints must not become platform endpoints just because their role is admin.
const PLATFORM_AUTH_PROCEDURES = new Set([
  "initialSetup.state",
  "ping",
  "auth.deploymentInfo",
  "auth.currentStaff",
  "auth.systemAccess",
  "auth.reportLoginAttempt",
  "auth.realtimeSession",
  "faceAuth.passkeyStatus",
  "faceAuth.beginFaceLogin",
  "faceAuth.completeFaceLogin",
  "faceAuth.beginPasskeyLogin",
  "faceAuth.completePasskeyLogin",
  "faceAuth.beginPasskeyRegistration",
  "faceAuth.completePasskeyRegistration",
]);

export function isProcedureAllowedInDeployment(
  mode: DeploymentMode,
  path: string
): boolean {
  if (mode === "business") return !path.startsWith("platform.");
  return path.startsWith("platform.") || PLATFORM_AUTH_PROCEDURES.has(path);
}
