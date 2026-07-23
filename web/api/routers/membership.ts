import { z } from "zod";
import { and, desc, eq, like, or } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { adminQuery } from "../guard";
import { getDb } from "../queries/connection";
import { members, pointTransactions, rewards, rewardRedemptions } from "@db/schema";
import { actorFromReq, logAudit } from "../lib/audit";

export const membershipRouter = createRouter({
  listMembers: publicQuery
    .input(z.object({ search: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      if (input?.search) {
        const q = `%${input.search}%`;
        return db
          .select()
          .from(members)
          .where(or(like(members.name, q), like(members.phone, q), like(members.memberCode, q)))
          .orderBy(desc(members.createdAt))
          .limit(50);
      }
      return db.query.members.findMany({ orderBy: (m, { desc: d }) => [d(m.createdAt)], limit: 200 });
    }),

  findByPhone: publicQuery.input(z.object({ phone: z.string().min(3) })).query(async ({ input }) => {
    const db = getDb();
    const rows = await db.select().from(members).where(like(members.phone, `%${input.phone}%`)).limit(5);
    return rows;
  }),

  createMember: publicQuery
    .input(z.object({ name: z.string().min(1), phone: z.string().min(9) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const dup = await db.query.members.findFirst({ where: eq(members.phone, input.phone) });
      if (dup) throw new Error("เบอร์นี้สมัครสมาชิกแล้ว");
      const count = (await db.query.members.findMany()).length;
      const memberCode = `M${String(count + 1).padStart(4, "0")}`;
      const [{ id }] = await db.insert(members).values({ ...input, memberCode }).returning({ id: members.id });
      return { ok: true, id, memberCode };
    }),

  updateMember: adminQuery
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        phone: z.string().min(9).optional(),
        tier: z.enum(["silver", "gold", "platinum"]).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      await getDb().update(members).set(patch).where(eq(members.id, id));
      return { ok: true };
    }),

  deleteMember: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await getDb().delete(members).where(eq(members.id, input.id));
      return { ok: true };
    }),

  adjustPoints: adminQuery
    .input(z.object({ memberId: z.number(), points: z.number().int(), note: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const { member: m, next } = await db.transaction(async tx => {
        const [member] = await tx
          .select()
          .from(members)
          .where(eq(members.id, input.memberId))
          .for("update");
        if (!member) throw new Error("ไม่พบสมาชิก");
        const nextPoints = member.points + input.points;
        if (nextPoints < 0) throw new Error("แต้มติดลบไม่ได้");
        await tx.update(members).set({ points: nextPoints }).where(eq(members.id, member.id));
        await tx.insert(pointTransactions).values({
          branchId: ctx.staff.branchId,
          memberId: member.id,
          type: "adjust",
          points: input.points,
          note: input.note,
        });
        return { member, next: nextPoints };
      });
      logAudit({
        action: "adjust_points",
        ...actorFromReq(ctx.req),
        detail: `ปรับแต้ม ${m.memberCode} (${m.name}) ${input.points > 0 ? "+" : ""}${input.points} เหตุผล: ${input.note}`,
        refType: "member",
        refId: m.id,
      });
      return { ok: true, points: next };
    }),

  memberTransactions: publicQuery.input(z.object({ memberId: z.number() })).query(async ({ input, ctx }) => {
    return getDb()
      .select()
      .from(pointTransactions)
      .where(
        and(
          eq(pointTransactions.branchId, ctx.staff.branchId),
          eq(pointTransactions.memberId, input.memberId),
        ),
      )
      .orderBy(desc(pointTransactions.createdAt))
      .limit(50);
  }),

  // ---------- ของรางวัล ----------
  listRewards: publicQuery.query(async ({ ctx }) => {
    return getDb().query.rewards.findMany({
      where: eq(rewards.branchId, ctx.staff.branchId),
    });
  }),

  upsertReward: adminQuery
    .input(
      z.object({
        id: z.number().optional(),
        name: z.string().min(1),
        pointsRequired: z.number().int().positive(),
        stock: z.number().int().nonnegative(),
        active: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      const { id, ...data } = input;
      if (id) {
        await db
          .update(rewards)
          .set(data)
          .where(and(eq(rewards.id, id), eq(rewards.branchId, branchId)));
      } else {
        await db.insert(rewards).values({ ...data, branchId });
      }
      return { ok: true };
    }),

  deleteReward: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await getDb()
        .delete(rewards)
        .where(
          and(
            eq(rewards.id, input.id),
            eq(rewards.branchId, ctx.staff.branchId),
          ),
        );
      return { ok: true };
    }),

  redeemReward: publicQuery
    .input(z.object({ memberId: z.number(), rewardId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      return db.transaction(async tx => {
        const [memberRows, rewardRows] = await Promise.all([
          tx.select().from(members).where(eq(members.id, input.memberId)).for("update"),
          tx
            .select()
            .from(rewards)
            .where(
              and(
                eq(rewards.id, input.rewardId),
                eq(rewards.branchId, branchId),
              ),
            )
            .for("update"),
        ]);
        const m = memberRows[0];
        const rw = rewardRows[0];
        if (!m) throw new Error("ไม่พบสมาชิก");
        if (!rw || !rw.active) throw new Error("ไม่พบของรางวัล");
        if (rw.stock <= 0) throw new Error("ของรางวัลหมด");
        if (m.points < rw.pointsRequired) throw new Error("แต้มไม่พอ");
        await tx.update(members).set({ points: m.points - rw.pointsRequired }).where(eq(members.id, m.id));
        await tx
          .update(rewards)
          .set({ stock: rw.stock - 1 })
          .where(
            and(eq(rewards.id, rw.id), eq(rewards.branchId, branchId)),
          );
        await tx.insert(rewardRedemptions).values({
          branchId,
          memberId: m.id,
          rewardId: rw.id,
          pointsUsed: rw.pointsRequired,
        });
        await tx.insert(pointTransactions).values({
          branchId,
          memberId: m.id,
          type: "redeem",
          points: -rw.pointsRequired,
          note: `แลกรางวัล: ${rw.name}`,
        });
        return { ok: true, pointsLeft: m.points - rw.pointsRequired };
      });
    }),

  redemptionHistory: publicQuery.query(async ({ ctx }) => {
    const db = getDb();
    const branchId = ctx.staff.branchId;
    const [rows, memberRows, rewardRows] = await Promise.all([
      db
        .select()
        .from(rewardRedemptions)
        .where(eq(rewardRedemptions.branchId, branchId))
        .orderBy(desc(rewardRedemptions.createdAt))
        .limit(50),
      db.query.members.findMany(),
      db.query.rewards.findMany({
        where: eq(rewards.branchId, branchId),
      }),
    ]);
    return rows.map((r) => ({
      ...r,
      memberName: memberRows.find((m) => m.id === r.memberId)?.name ?? "-",
      rewardName: rewardRows.find((w) => w.id === r.rewardId)?.name ?? "-",
    }));
  }),
});
