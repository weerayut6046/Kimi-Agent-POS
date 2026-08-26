import { z } from "zod";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  like,
  or,
  sql,
} from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { adminQuery, managerQuery } from "../guard";
import { getDb } from "../queries/connection";
import {
  branches,
  memberCardBatches,
  memberCards,
  members,
  pointTransactions,
  rewards,
  rewardRedemptions,
} from "@db/schema";
import { actorFromReq, logAudit } from "../lib/audit";
import {
  extractMemberCardCode,
  generateMemberCode,
  isLongMemberCode,
  normalizeMemberCode,
} from "@contracts/memberCode";
import { isMemberCardExpired } from "@contracts/memberExpiry";
import { expireDueMemberPoints } from "../lib/memberExpiry";

function generateCardBatchCode(now = new Date()) {
  const stamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `CARD-${stamp}-${generateMemberCode().slice(2, 8)}`;
}

export const membershipRouter = createRouter({
  listCardBatches: managerQuery.query(async () => {
    const db = getDb();
    const batches = await db
      .select({
        id: memberCardBatches.id,
        batchCode: memberCardBatches.batchCode,
        label: memberCardBatches.label,
        quantity: memberCardBatches.quantity,
        branchId: memberCardBatches.branchId,
        branchName: branches.name,
        createdByStaffId: memberCardBatches.createdByStaffId,
        createdAt: memberCardBatches.createdAt,
      })
      .from(memberCardBatches)
      .innerJoin(branches, eq(memberCardBatches.branchId, branches.id))
      .orderBy(desc(memberCardBatches.createdAt))
      .limit(50);

    if (batches.length === 0) return [];
    const stats = await db
      .select({
        batchId: memberCards.batchId,
        total: sql<number>`count(*)::int`,
        unused: sql<number>`count(*) filter (where ${memberCards.status} = 'unused')::int`,
        activated: sql<number>`count(*) filter (where ${memberCards.status} = 'activated')::int`,
        void: sql<number>`count(*) filter (where ${memberCards.status} = 'void')::int`,
      })
      .from(memberCards)
      .where(
        inArray(
          memberCards.batchId,
          batches.map(batch => batch.id)
        )
      )
      .groupBy(memberCards.batchId);
    const statsByBatch = new Map(stats.map(row => [row.batchId, row]));
    return batches.map(batch => ({
      ...batch,
      total: statsByBatch.get(batch.id)?.total ?? 0,
      unused: statsByBatch.get(batch.id)?.unused ?? 0,
      activated: statsByBatch.get(batch.id)?.activated ?? 0,
      void: statsByBatch.get(batch.id)?.void ?? 0,
    }));
  }),

  getCardBatch: managerQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [batch] = await db
        .select({
          id: memberCardBatches.id,
          batchCode: memberCardBatches.batchCode,
          label: memberCardBatches.label,
          quantity: memberCardBatches.quantity,
          branchId: memberCardBatches.branchId,
          branchName: branches.name,
          createdAt: memberCardBatches.createdAt,
        })
        .from(memberCardBatches)
        .innerJoin(branches, eq(memberCardBatches.branchId, branches.id))
        .where(eq(memberCardBatches.id, input.id))
        .limit(1);
      if (!batch) throw new Error("ไม่พบชุดบัตรสมาชิก");
      const cards = await db
        .select()
        .from(memberCards)
        .where(eq(memberCards.batchId, batch.id))
        .orderBy(asc(memberCards.id));
      return { batch, cards };
    }),

  createCardBatch: managerQuery
    .input(
      z.object({
        quantity: z.number().int().min(1).max(500),
        label: z.string().trim().max(80).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const result = await db.transaction(async tx => {
        let batch: typeof memberCardBatches.$inferSelect | undefined;
        for (let attempt = 0; attempt < 5 && !batch; attempt += 1) {
          const [created] = await tx
            .insert(memberCardBatches)
            .values({
              batchCode: generateCardBatchCode(),
              label: input.label ?? "",
              quantity: input.quantity,
              branchId: ctx.staff.branchId,
              createdByStaffId: ctx.staff.id,
            })
            .onConflictDoNothing()
            .returning();
          batch = created;
        }
        if (!batch) throw new Error("ไม่สามารถสร้างเลขอ้างอิงชุดบัตรได้");

        const createdCards: (typeof memberCards.$inferSelect)[] = [];
        for (
          let attempt = 0;
          attempt < 12 && createdCards.length < input.quantity;
          attempt += 1
        ) {
          const needed = input.quantity - createdCards.length;
          const candidates = new Set<string>();
          while (candidates.size < needed * 2) {
            candidates.add(generateMemberCode());
          }
          const candidateList = [...candidates];
          const memberConflicts = await tx
            .select({ memberCode: members.memberCode })
            .from(members)
            .where(inArray(members.memberCode, candidateList));
          const usedCodes = new Set(memberConflicts.map(row => row.memberCode));
          const availableCodes = candidateList
            .filter(code => !usedCodes.has(code))
            .slice(0, needed);
          if (availableCodes.length === 0) continue;
          const inserted = await tx
            .insert(memberCards)
            .values(
              availableCodes.map(memberCode => ({
                batchId: batch!.id,
                memberCode,
                status: "unused" as const,
              }))
            )
            .onConflictDoNothing()
            .returning();
          createdCards.push(...inserted);
        }
        if (createdCards.length !== input.quantity) {
          throw new Error("ไม่สามารถสร้างเลขบัตรที่ไม่ซ้ำได้ครบตามจำนวน");
        }
        return { batch, cards: createdCards };
      });
      logAudit({
        action: "create_member_card_batch",
        ...actorFromReq(ctx.req),
        detail: `สร้างชุดบัตร ${result.batch.batchCode} จำนวน ${input.quantity} ใบ${input.label ? ` (${input.label})` : ""}`,
        refType: "member_card_batch",
        refId: result.batch.id,
      });
      return result;
    }),

  listMembers: publicQuery
    .input(z.object({ search: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const db = getDb();
      await expireDueMemberPoints(db, ctx.staff.branchId);
      if (input?.search) {
        const q = `%${input.search}%`;
        return db
          .select()
          .from(members)
          .where(
            or(
              like(members.name, q),
              like(members.phone, q),
              like(members.memberCode, q)
            )
          )
          .orderBy(desc(members.createdAt))
          .limit(50);
      }
      return db.query.members.findMany({
        orderBy: (m, { desc: d }) => [d(m.createdAt)],
        limit: 200,
      });
    }),

  findByPhone: publicQuery
    .input(z.object({ phone: z.string().min(3) }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      await expireDueMemberPoints(db, ctx.staff.branchId);
      const query = input.phone.trim();
      const memberCodeQuery = normalizeMemberCode(query);
      const rows = await db
        .select()
        .from(members)
        // คงชื่อ endpoint เดิมเพื่อไม่กระทบ client รุ่นเก่า แต่รองรับรหัสบนบัตรด้วย
        .where(
          or(
            like(members.phone, `%${query}%`),
            like(members.memberCode, `%${memberCodeQuery}%`)
          )
        )
        .limit(5);
      return rows;
    }),

  checkCardAvailability: publicQuery
    .input(z.object({ cardCode: z.string().trim().min(1).max(160) }))
    .query(async ({ input }) => {
      const cardCode = extractMemberCardCode(input.cardCode);
      if (!isLongMemberCode(cardCode)) {
        return { cardCode, valid: false, available: false };
      }
      const db = getDb();
      const [existing, registeredCard] = await Promise.all([
        db.query.members.findFirst({
          columns: { id: true },
          where: eq(members.memberCode, cardCode),
        }),
        db.query.memberCards.findFirst({
          columns: { status: true },
          where: eq(memberCards.memberCode, cardCode),
        }),
      ]);
      return {
        cardCode,
        valid: true,
        available:
          !existing && (!registeredCard || registeredCard.status === "unused"),
      };
    }),

  createMember: publicQuery
    .input(
      z.object({
        name: z.string().trim().min(1),
        phone: z.string().trim().min(9),
        cardCode: z.string().trim().max(160).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      return db.transaction(async tx => {
        const dup = await tx.query.members.findFirst({
          where: eq(members.phone, input.phone),
        });
        if (dup) throw new Error("เบอร์นี้สมัครสมาชิกแล้ว");

        let memberCode = input.cardCode
          ? extractMemberCardCode(input.cardCode)
          : "";
        let registeredCard: typeof memberCards.$inferSelect | undefined;
        if (input.cardCode) {
          if (!isLongMemberCode(memberCode)) {
            throw new Error(
              "เลขบัตรไม่ถูกต้อง กรุณาเสียบ สแกน หรือกรอกเลข 16 หลักใหม่"
            );
          }
          const existingMember = await tx.query.members.findFirst({
            columns: { id: true },
            where: eq(members.memberCode, memberCode),
          });
          if (existingMember) throw new Error("บัตรนี้เปิดใช้งานแล้ว");

          registeredCard = await tx.query.memberCards.findFirst({
            where: eq(memberCards.memberCode, memberCode),
          });
          if (registeredCard?.status === "activated") {
            throw new Error("บัตรนี้เปิดใช้งานแล้ว");
          }
          if (registeredCard?.status === "void") {
            throw new Error("บัตรนี้ถูกยกเลิกแล้ว");
          }
          if (!registeredCard) {
            const [created] = await tx
              .insert(memberCards)
              .values({ memberCode, status: "unused" })
              .onConflictDoNothing()
              .returning();
            registeredCard =
              created ??
              (await tx.query.memberCards.findFirst({
                where: eq(memberCards.memberCode, memberCode),
              }));
          }
        } else {
          for (let attempt = 0; attempt < 8; attempt += 1) {
            const candidate = generateMemberCode();
            const [created] = await tx
              .insert(memberCards)
              .values({ memberCode: candidate, status: "unused" })
              .onConflictDoNothing()
              .returning();
            if (created) {
              memberCode = candidate;
              registeredCard = created;
              break;
            }
          }
        }
        if (!memberCode || !registeredCard) {
          throw new Error("ไม่สามารถสร้างรหัสสมาชิกที่ไม่ซ้ำได้");
        }
        if (registeredCard.status !== "unused") {
          throw new Error("บัตรนี้ไม่พร้อมเปิดใช้งาน");
        }

        const [{ id }] = await tx
          .insert(members)
          .values({ name: input.name, phone: input.phone, memberCode })
          .returning({ id: members.id });
        const [activatedCard] = await tx
          .update(memberCards)
          .set({
            status: "activated",
            activatedMemberId: id,
            activatedAt: new Date(),
          })
          .where(
            and(
              eq(memberCards.id, registeredCard.id),
              eq(memberCards.status, "unused")
            )
          )
          .returning({ id: memberCards.id });
        if (!activatedCard) throw new Error("บัตรนี้ถูกเปิดใช้งานไปแล้ว");
        return { ok: true, id, memberCode };
      });
    }),

  updateMember: adminQuery
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        phone: z.string().min(9).optional(),
        tier: z.enum(["silver", "gold", "platinum"]).optional(),
      })
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
    .input(
      z.object({
        memberId: z.number(),
        points: z.number().int(),
        note: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await expireDueMemberPoints(db, ctx.staff.branchId);
      const { member: m, next } = await db.transaction(async tx => {
        const [member] = await tx
          .select()
          .from(members)
          .where(eq(members.id, input.memberId))
          .for("update");
        if (!member) throw new Error("ไม่พบสมาชิก");
        if (isMemberCardExpired(member.cardExpiresAt)) {
          throw new Error("บัตรสมาชิกหมดอายุแล้ว ไม่สามารถปรับแต้มได้");
        }
        const nextPoints = member.points + input.points;
        if (nextPoints < 0) throw new Error("แต้มติดลบไม่ได้");
        await tx
          .update(members)
          .set({ points: nextPoints })
          .where(eq(members.id, member.id));
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

  // สมาชิกและยอดแต้มเป็นบัญชีกลาง ประวัติจึงต้องเห็นครบทุกสาขา
  memberTransactions: publicQuery
    .input(z.object({ memberId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      await expireDueMemberPoints(db, ctx.staff.branchId);
      return db
        .select({
          ...getTableColumns(pointTransactions),
          branchName: branches.name,
        })
        .from(pointTransactions)
        .innerJoin(branches, eq(pointTransactions.branchId, branches.id))
        .where(eq(pointTransactions.memberId, input.memberId))
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
      })
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
            eq(rewards.branchId, ctx.staff.branchId)
          )
        );
      return { ok: true };
    }),

  redeemReward: publicQuery
    .input(z.object({ memberId: z.number(), rewardId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const branchId = ctx.staff.branchId;
      await expireDueMemberPoints(db, branchId);
      return db.transaction(async tx => {
        const [memberRows, rewardRows] = await Promise.all([
          tx
            .select()
            .from(members)
            .where(eq(members.id, input.memberId))
            .for("update"),
          tx
            .select()
            .from(rewards)
            .where(
              and(
                eq(rewards.id, input.rewardId),
                eq(rewards.branchId, branchId)
              )
            )
            .for("update"),
        ]);
        const m = memberRows[0];
        const rw = rewardRows[0];
        if (!m) throw new Error("ไม่พบสมาชิก");
        if (isMemberCardExpired(m.cardExpiresAt)) {
          throw new Error("บัตรสมาชิกหมดอายุแล้ว ไม่สามารถแลกของรางวัลได้");
        }
        if (!rw || !rw.active) throw new Error("ไม่พบของรางวัล");
        if (rw.stock <= 0) throw new Error("ของรางวัลหมด");
        if (m.points < rw.pointsRequired) throw new Error("แต้มไม่พอ");
        await tx
          .update(members)
          .set({ points: m.points - rw.pointsRequired })
          .where(eq(members.id, m.id));
        await tx
          .update(rewards)
          .set({ stock: rw.stock - 1 })
          .where(and(eq(rewards.id, rw.id), eq(rewards.branchId, branchId)));
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
    return rows.map(r => ({
      ...r,
      memberName: memberRows.find(m => m.id === r.memberId)?.name ?? "-",
      rewardName: rewardRows.find(w => w.id === r.rewardId)?.name ?? "-",
    }));
  }),
});
