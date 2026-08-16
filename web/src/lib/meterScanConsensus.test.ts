import { describe, expect, it } from "vitest";
import {
  buildAiMeterAgreement,
  buildMeterConsensus,
} from "./meterScanConsensus";

type Candidate = {
  id: string;
  value: string;
  confidence: number;
  glareRatio: number;
  sourceValid: boolean;
};

function candidate(
  id: string,
  value: string,
  confidence = 0.94,
  glareRatio = 0.02
): Candidate {
  return { id, value, confidence, glareRatio, sourceValid: true };
}

describe("meter image consensus", () => {
  it("auto-accepts three matching photos", () => {
    const result = buildMeterConsensus([
      candidate("a", "420246.87"),
      candidate("b", "420246.87"),
      candidate("c", "420246.87"),
    ]);

    expect(result.autoAccepted).toBe(true);
    expect(result.matchingCount).toBe(3);
    expect(result.agreement).toBe(1);
  });

  it("uses the two-of-three majority even when the outlier scores higher", () => {
    const result = buildMeterConsensus([
      candidate("a", "12345", 0.86),
      candidate("b", "12345", 0.84),
      candidate("outlier", "92345", 0.99, 0),
    ]);

    expect(result.autoAccepted).toBe(true);
    expect(result.representative.value).toBe("12345");
    expect(result.matchingCount).toBe(2);
  });

  it("rejects a tie instead of guessing from confidence", () => {
    const result = buildMeterConsensus([
      candidate("a", "12345"),
      candidate("b", "92345", 0.99),
    ]);

    expect(result.autoAccepted).toBe(false);
    expect(result.issue).toContain("ไม่ตรงกัน");
  });

  it("selects the least reflective matching photo as representative", () => {
    const result = buildMeterConsensus([
      candidate("glare", "12345", 0.95, 0.11),
      candidate("clear", "12345", 0.94, 0.01),
      candidate("other", "12345", 0.92, 0.04),
    ]);

    expect(result.representative.id).toBe("clear");
  });

  it("requires manual review for a reflective single photo", () => {
    const result = buildMeterConsensus([
      candidate("a", "12345", 0.98, 0.14),
    ]);

    expect(result.autoAccepted).toBe(false);
    expect(result.issue).toContain("แสงสะท้อน");
  });
});

describe("AI meter agreement gate", () => {
  const aiCandidate = (
    aiValue: string | null,
    aiMode: "L" | "P" | "unknown" = "L",
    aiConfidence = 0.94
  ) => ({
    aiValue,
    aiMode,
    aiConfidence,
    aiValid: aiValue != null,
    aiIssue: "",
  });

  it("accepts AI only when its value and mode match local OCR", () => {
    const result = buildAiMeterAgreement(
      [aiCandidate("420246.87")],
      "420246.87",
      "L"
    );

    expect(result.status).toBe("matched");
    expect(result.matchingCount).toBe(1);
  });

  it("rejects a one-digit disagreement", () => {
    const result = buildAiMeterAgreement(
      [aiCandidate("420246.87"), aiCandidate("420248.87")],
      "420246.87",
      "L"
    );

    expect(result.status).toBe("mismatch");
    expect(result.issue).toContain("ไม่ตรง");
  });

  it("does not count low-confidence or wrong-mode AI output", () => {
    const result = buildAiMeterAgreement(
      [aiCandidate("420246.87", "L", 0.7), aiCandidate("420246.87", "P")],
      "420246.87",
      "L"
    );

    expect(result.status).toBe("unavailable");
    expect(result.checkedCount).toBe(1);
    expect(result.matchingCount).toBe(0);
  });
});
