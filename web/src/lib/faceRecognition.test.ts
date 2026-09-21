import { beforeEach, describe, expect, it, vi } from "vitest";

const { load, warmup, Human } = vi.hoisted(() => {
  const load = vi.fn().mockResolvedValue(undefined);
  const warmup = vi.fn().mockResolvedValue(undefined);
  const Human = vi.fn(function (this: {
    load: typeof load;
    warmup: typeof warmup;
  }) {
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
        cacheSensitivity: 0.05,
        modelBasePath: "/models/human/",
        warmup: "none",
        face: expect.objectContaining({
          iris: expect.objectContaining({ enabled: false }),
          description: expect.objectContaining({ skipFrames: 2 }),
          antispoof: expect.objectContaining({ skipFrames: 2 }),
          liveness: expect.objectContaining({ skipFrames: 2 }),
        }),
      })
    );
    expect(load).toHaveBeenCalledOnce();
    expect(warmup).not.toHaveBeenCalled();
  });
});
