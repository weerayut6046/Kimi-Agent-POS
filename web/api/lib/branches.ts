import { and, asc, desc, eq } from "drizzle-orm";
import { branches, staffBranches } from "@db/schema";
import { getDb } from "../queries/connection";
import type { StaffSessionClaims } from "./session";

export type AccessibleBranch = {
  id: number;
  code: string;
  name: string;
  address: string;
  phone: string;
  taxId: string;
  active: boolean;
};

export async function accessibleBranchesForStaff(
  staff: Pick<StaffSessionClaims, "id" | "role">,
  includeInactive = false,
): Promise<AccessibleBranch[]> {
  const db = getDb();
  if (staff.role === "admin") {
    return db
      .select()
      .from(branches)
      .where(includeInactive ? undefined : eq(branches.active, true))
      .orderBy(asc(branches.id));
  }

  const rows = await db
    .select({ branch: branches })
    .from(staffBranches)
    .innerJoin(branches, eq(staffBranches.branchId, branches.id))
    .where(eq(staffBranches.staffId, staff.id))
    .orderBy(desc(staffBranches.isDefault), asc(branches.id))
    .limit(1);
  if (!includeInactive && !rows[0]?.branch.active) return [];
  return rows.map((row) => row.branch);
}

export async function branchForStaff(
  staff: Pick<StaffSessionClaims, "id" | "role">,
  branchId: number,
): Promise<AccessibleBranch | null> {
  const db = getDb();
  const branch = await db.query.branches.findFirst({
    where: and(eq(branches.id, branchId), eq(branches.active, true)),
  });
  if (!branch) return null;
  if (staff.role === "admin") return branch;

  const workingBranch = (await accessibleBranchesForStaff(staff))[0];
  return workingBranch?.id === branchId ? branch : null;
}

export async function defaultBranchForStaff(
  staff: Pick<StaffSessionClaims, "id" | "role">,
): Promise<AccessibleBranch | null> {
  return (await accessibleBranchesForStaff(staff))[0] ?? null;
}
