import { and, asc, eq } from "drizzle-orm";
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
    .where(
      and(
        eq(staffBranches.staffId, staff.id),
        includeInactive ? undefined : eq(branches.active, true),
      ),
    )
    .orderBy(asc(branches.id));
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

  const membership = await db.query.staffBranches.findFirst({
    where: and(
      eq(staffBranches.staffId, staff.id),
      eq(staffBranches.branchId, branchId),
    ),
    columns: { staffId: true },
  });
  return membership ? branch : null;
}

export async function defaultBranchForStaff(
  staff: Pick<StaffSessionClaims, "id" | "role">,
): Promise<AccessibleBranch | null> {
  const db = getDb();
  if (staff.role !== "admin") {
    const preferred = await db
      .select({ branch: branches })
      .from(staffBranches)
      .innerJoin(branches, eq(staffBranches.branchId, branches.id))
      .where(
        and(
          eq(staffBranches.staffId, staff.id),
          eq(staffBranches.isDefault, true),
          eq(branches.active, true),
        ),
      )
      .orderBy(asc(branches.id))
      .limit(1);
    if (preferred[0]) return preferred[0].branch;
  }
  return (await accessibleBranchesForStaff(staff))[0] ?? null;
}
