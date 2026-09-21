import { beforeEach, describe, expect, it, vi } from "vitest";

const { load, warmup, Human } = vi.hoisted(() => {
  const load = vi.fn().mockResolvedValue(undefined);
  const warmup = vi.fn().mockResolvedValue(undefined);
  const Human = vi.fn(function (this: { load: typeof load; warmup: typeof warmup }) {
    this.load = load;
    this.warmup = warmup;
  });
  return { load, warmup, Human };
});

vi.mock("@vladmandic/human", () => ({ Human }));

describe("loadFaceEngine", () => {
  beforeEach(() => {
    load.mockClear();
    warmup.mockClear();
    Human.mockClear();
  });

  it("loads local models without the CSP-incompatible embedded-image warmup", async () => {
    const { loadFaceEngine } = await import("./faceRecognition");

    await loadFaceEngine();

    expect(Human).toHaveBeenCalledWith(
      expect.objectContaining({
        modelBasePath: "/models/human/",
        warmup: "none",
      })
    );
    expect(load).toHaveBeenCalledOnce();
    expect(warmup).not.toHaveBeenCalled();
  });
});
