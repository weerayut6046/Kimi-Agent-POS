import type { MeterDisplayMode } from "@contracts/meterOcr";

export const SINGLE_IMAGE_AUTO_ACCEPT_CONFIDENCE = 0.9;
export const SINGLE_IMAGE_MAX_GLARE_RATIO = 0.06;
export const MULTI_IMAGE_MAX_GLARE_RATIO = 0.12;

export type MeterConsensusCandidate = {
  value: string;
  confidence: number;
  glareRatio: number;
  sourceValid: boolean;
};

export type MeterConsensusResult<T extends MeterConsensusCandidate> = {
  representative: T;
  sampleCount: number;
  matchingCount: number;
  agreement: number;
  confidence: number;
  autoAccepted: boolean;
  issue: string;
};

export type AiMeterCandidate = {
  aiValue: string | null;
  aiMode: MeterDisplayMode;
  aiConfidence: number;
  aiValid: boolean;
  aiIssue: string;
};

export type AiMeterAgreement<T extends AiMeterCandidate> = {
  representative: T | null;
  status: "matched" | "mismatch" | "unavailable";
  checkedCount: number;
  matchingCount: number;
  issue: string;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function canonicalMeterValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return String(numeric);
}

function sameMeterValue(left: string | null, right: string | null) {
  if (left == null || right == null) return false;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return (
    Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber) &&
    leftNumber === rightNumber
  );
}

export function buildAiMeterAgreement<T extends AiMeterCandidate>(
  candidates: readonly T[],
  localValue: string,
  localMode: MeterDisplayMode
): AiMeterAgreement<T> {
  const checked = candidates.filter(
    candidate =>
      candidate.aiValid &&
      candidate.aiConfidence >= 0.82 &&
      (candidate.aiMode === "L" || candidate.aiMode === "P")
  );
  const matching = checked.filter(
    candidate =>
      candidate.aiMode === localMode &&
      sameMeterValue(candidate.aiValue, localValue)
  );
  const requiredChecks = Math.ceil((candidates.length * 2) / 3);
  const requiredMatches = Math.ceil((checked.length * 2) / 3);
  const status = checked.length < requiredChecks
    ? ("unavailable" as const)
    : matching.length >= requiredMatches
      ? ("matched" as const)
      : ("mismatch" as const);
  const representative = [...(matching.length ? matching : checked)].sort(
    (left, right) => right.aiConfidence - left.aiConfidence
  )[0] ?? null;
  const issue =
    status === "matched"
      ? ""
      : status === "mismatch"
        ? `AI อ่านไม่ตรงกับระบบในเครื่อง (${matching.length}/${checked.length}) กรุณาตรวจเลขจริง`
        : candidates.map(candidate => candidate.aiIssue).find(Boolean) ||
          "AI ยังยืนยันผลนี้ไม่ได้ กรุณาลองใหม่หรือตรวจเลขจริง";

  return {
    representative,
    status,
    checkedCount: checked.length,
    matchingCount: matching.length,
    issue,
  };
}

function candidateQuality(candidate: MeterConsensusCandidate) {
  return (
    clamp(candidate.confidence, 0, 1) *
    (1 - clamp(candidate.glareRatio, 0, 0.8))
  );
}

/**
 * Selects an exact-value consensus without synthesising missing digits.
 * Repeated photos are intentionally treated as correlated evidence: agreement
 * is required, but confidence is averaged instead of multiplied into a fake
 * near-100% probability.
 */
export function buildMeterConsensus<T extends MeterConsensusCandidate>(
  candidates: readonly T[]
): MeterConsensusResult<T> {
  if (!candidates.length) {
    throw new Error("ต้องมีผลอ่านอย่างน้อย 1 ภาพ");
  }

  const fallback = [...candidates].sort(
    (left, right) => candidateQuality(right) - candidateQuality(left)
  )[0]!;
  const groups = new Map<string, T[]>();
  for (const candidate of candidates) {
    const value = candidate.sourceValid
      ? canonicalMeterValue(candidate.value)
      : null;
    if (value == null) continue;
    groups.set(value, [...(groups.get(value) ?? []), candidate]);
  }

  const ranked = [...groups.values()].sort((left, right) => {
    if (right.length !== left.length) return right.length - left.length;
    const leftQuality = left.reduce(
      (total, candidate) => total + candidateQuality(candidate),
      0
    );
    const rightQuality = right.reduce(
      (total, candidate) => total + candidateQuality(candidate),
      0
    );
    return rightQuality - leftQuality;
  });
  const winning = ranked[0] ?? [];
  const representative = winning.length
    ? [...winning].sort(
        (left, right) => candidateQuality(right) - candidateQuality(left)
      )[0]!
    : fallback;
  const sampleCount = candidates.length;
  const matchingCount = winning.length;
  const agreement = matchingCount / sampleCount;
  const averageConfidence = winning.length
    ? winning.reduce(
        (total, candidate) => total + clamp(candidate.confidence, 0, 1),
        0
      ) / winning.length
    : 0;
  const averageGlare = winning.length
    ? winning.reduce(
        (total, candidate) => total + clamp(candidate.glareRatio, 0, 1),
        0
      ) / winning.length
    : 1;
  const confidence = clamp(
    averageConfidence *
      (0.72 + agreement * 0.28) *
      (1 - Math.min(0.25, averageGlare * 0.7)),
    0,
    0.99
  );

  let autoAccepted = false;
  let issue = "";
  if (!winning.length) {
    issue = "อ่านตัวเลขได้ไม่ครบ กรุณากรอกและยืนยันจากหน้าจอจริง";
  } else if (sampleCount === 1) {
    autoAccepted =
      representative.confidence >= SINGLE_IMAGE_AUTO_ACCEPT_CONFIDENCE &&
      representative.glareRatio <= SINGLE_IMAGE_MAX_GLARE_RATIO;
    if (!autoAccepted) {
      issue =
        representative.glareRatio > SINGLE_IMAGE_MAX_GLARE_RATIO
          ? "ภาพเดียวมีแสงสะท้อน กรุณาถ่ายเพิ่มอีก 2 มุมหรือยืนยันเลขด้วยตนเอง"
          : "ผลจากภาพเดียวยังไม่มั่นใจพอ กรุณาถ่ายเพิ่มอีก 2 มุมหรือยืนยันเลขด้วยตนเอง";
    }
  } else {
    const requiredMatches = Math.ceil((sampleCount * 2) / 3);
    const minimumConfidence = sampleCount >= 3 ? 0.68 : 0.76;
    autoAccepted =
      matchingCount >= requiredMatches &&
      averageConfidence >= minimumConfidence &&
      representative.glareRatio <= MULTI_IMAGE_MAX_GLARE_RATIO;
    if (!autoAccepted) {
      if (matchingCount < requiredMatches) {
        issue = `ตัวเลขจากหลายภาพไม่ตรงกัน (${matchingCount}/${sampleCount}) กรุณาตรวจเลขจริง`;
      } else if (representative.glareRatio > MULTI_IMAGE_MAX_GLARE_RATIO) {
        issue = "ทุกภาพที่ตรงกันยังมีแสงสะท้อนมาก กรุณาถ่ายเพิ่มจากมุมอื่น";
      } else {
        issue = "ภาพที่ตรงกันยังไม่ชัดพอ กรุณาตรวจเลขจริงก่อนยืนยัน";
      }
    }
  }

  return {
    representative,
    sampleCount,
    matchingCount,
    agreement,
    confidence,
    autoAccepted,
    issue,
  };
}
