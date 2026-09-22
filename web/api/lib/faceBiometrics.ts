import { env } from "./env";
import { decryptSecret, encryptSecret } from "./secretCrypto";

export const FACE_MODEL = "human-faceres-v1";
export const FACE_MATCH_THRESHOLD = 0.55;
const FACE_TEMPLATE_KEY_SCOPE = "pump-pos:employee-face-template:v1";

function templateContext(staffId: number): string {
  return `employee-face:${staffId}`;
}

export function normalizeFaceEmbeddings(embeddings: number[][]): number[][] {
  if (embeddings.length < 1) throw new Error("ไม่พบข้อมูลใบหน้า");
  const dimensions = embeddings[0]?.length ?? 0;
  if (dimensions < 128 || dimensions > 4_096) {
    throw new Error("ขนาดข้อมูลใบหน้าไม่ถูกต้อง");
  }
  return embeddings.map(embedding => {
    if (embedding.length !== dimensions) {
      throw new Error("ข้อมูลใบหน้าแต่ละภาพมีขนาดไม่ตรงกัน");
    }
    let magnitude = 0;
    const normalized = embedding.map(value => {
      if (!Number.isFinite(value) || Math.abs(value) > 10) {
        throw new Error("ข้อมูลใบหน้ามีค่าที่ไม่ถูกต้อง");
      }
      magnitude += value * value;
      return Math.round(value * 1_000_000) / 1_000_000;
    });
    if (magnitude < 0.000001)
      throw new Error("ข้อมูลใบหน้าไม่มีรายละเอียดเพียงพอ");
    return normalized;
  });
}

export async function encryptFaceEmbeddings(
  staffId: number,
  embeddings: number[][]
): Promise<string> {
  const normalized = normalizeFaceEmbeddings(embeddings);
  return encryptSecret(JSON.stringify(normalized), {
    appSecret: env.appSecret,
    keyScope: FACE_TEMPLATE_KEY_SCOPE,
    context: templateContext(staffId),
  });
}

export async function decryptFaceEmbeddings(
  staffId: number,
  payload: string
): Promise<number[][]> {
  const decrypted = await decryptSecret(
    payload,
    {
      appSecret: env.appSecret,
      keyScope: FACE_TEMPLATE_KEY_SCOPE,
      context: templateContext(staffId),
    },
    "อ่านข้อมูลใบหน้าที่ลงทะเบียนไว้ไม่สำเร็จ กรุณาลงทะเบียนใหม่"
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypted);
  } catch {
    throw new Error("รูปแบบข้อมูลใบหน้าที่ลงทะเบียนไว้ไม่ถูกต้อง");
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every(
      value =>
        Array.isArray(value) && value.every(item => typeof item === "number")
    )
  ) {
    throw new Error("รูปแบบข้อมูลใบหน้าที่ลงทะเบียนไว้ไม่ถูกต้อง");
  }
  return normalizeFaceEmbeddings(parsed as number[][]);
}

// สูตรเดียวกับ Human.match.similarity สำหรับโมเดล FaceRes
export function faceSimilarity(first: number[], second: number[]): number {
  if (first.length !== second.length || first.length < 128) return 0;
  let squaredDifference = 0;
  for (let index = 0; index < first.length; index += 1) {
    const difference = first[index]! - second[index]!;
    squaredDifference += difference * difference;
  }
  const distance = Math.round(100 * 25 * squaredDifference) / 100;
  if (distance === 0) return 1;
  const normalized = (1 - Math.sqrt(distance) / 100 - 0.2) / (0.8 - 0.2);
  return Math.round(100 * Math.max(Math.min(normalized, 1), 0)) / 100;
}

export function bestFaceSimilarity(
  candidate: number[],
  enrolled: number[][]
): number {
  return enrolled.reduce(
    (best, embedding) => Math.max(best, faceSimilarity(candidate, embedding)),
    0
  );
}

export function verifyFaceSamples(
  candidates: number[][],
  enrolled: number[][]
): { accepted: boolean; similarity: number; matchCount: number } {
  const scores = candidates.map(candidate =>
    bestFaceSimilarity(candidate, enrolled)
  );
  const matchCount = scores.filter(score => score >= FACE_MATCH_THRESHOLD).length;
  // Existing clients send one sample. New scans require a strict majority,
  // so a single noisy frame cannot decide the entire login.
  return {
    accepted: matchCount > candidates.length / 2,
    similarity: Math.max(...scores),
    matchCount,
  };
}
