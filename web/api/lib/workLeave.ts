import {
  and,
  asc,
  eq,
  gte,
  inArray,
  lte,
  sql,
  type SQLWrapper,
} from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { staffUsers, workLeaveRequests } from "@db/schema";
import type { getDb } from "../queries/connection";

type Db = ReturnType<typeof getDb>;
export type WorkforceTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// คำขอลา การอนุมัติ และการจัดกะของคนเดียวกันใช้แถวล็อกเดียวกัน
export async function lockWorkforceStaff(
  tx: WorkforceTx,
  ...staffIds: number[]
) {
  await tx
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(inArray(staffUsers.id, staffIds))
    .orderBy(asc(staffUsers.id))
    .for("update");
}

function approvedLeaveForStaff(branchId: number, staffId: number | SQLWrapper) {
  return and(
    eq(workLeaveRequests.branchId, branchId),
    eq(workLeaveRequests.staffId, staffId),
    eq(workLeaveRequests.status, "approved")
  );
}

export async function assertWorkScheduleAvailable(
  tx: WorkforceTx,
  branchId: number,
  staffId: number,
  date: string
) {
  const [leave] = await tx
    .select({ id: workLeaveRequests.id })
    .from(workLeaveRequests)
    .where(
      and(
        approvedLeaveForStaff(branchId, staffId),
        lte(workLeaveRequests.startOn, date),
        gte(workLeaveRequests.endOn, date)
      )
    )
    .limit(1);
  if (leave) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `พนักงานมีใบลาอนุมัติวันที่ ${date} กรุณาเลือกพนักงานคนอื่นหรือทบทวนใบลา`,
    });
  }
}

export function approvedLeaveScheduleFlag(
  branchId: number,
  staffId: SQLWrapper,
  workDate: SQLWrapper
) {
  return sql<boolean>`exists (
    select 1 from ${workLeaveRequests}
    where ${approvedLeaveForStaff(branchId, staffId)}
      and to_char(${workLeaveRequests.startOn}, 'YYYY-MM-DD') <= ${workDate}
      and to_char(${workLeaveRequests.endOn}, 'YYYY-MM-DD') >= ${workDate}
  )`;
}
