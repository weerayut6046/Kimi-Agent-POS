import { describe, expect, it, vi } from "vitest";
import {
  detectFaceFrame,
  faceFacingCenter,
  meanFaceBrightness,
  type FaceFrame,
} from "./faceRecognition";

describe("face recognition frame handling", () => {
  it("measures actual camera luminance for lighting guidance", () => {
    expect(meanFaceBrightness(new Uint8ClampedArray([0, 0, 0, 255]))).toBe(0);
    expect(meanFaceBrightness(new Uint8ClampedArray([255, 255, 255, 255]))).toBeCloseTo(1);
    expect(meanFaceBrightness(new Uint8ClampedArray())).toBeNull();
  });

  it("reads the face region when the model scores are low", async () => {
    const pixels = new Uint8ClampedArray(32 * 32 * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      pixels.set([220, 220, 220, 255], index);
    }
    const drawImage = vi.fn();
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage, getImageData: () => ({ data: pixels }) }),
      }),
    });
    try {
      const engine = {
        detect: async () => ({
          face: [{
            embedding: Array(128).fill(0.1),
            faceScore: 0.5,
            boxScore: 0.8,
            real: 0.4,
            live: 0.8,
            box: [20, 30, 200, 200],
          }],
          gesture: [],
        }),
      } as unknown as Parameters<typeof detectFaceFrame>[0];
      const video = { videoWidth: 480, videoHeight: 640 } as HTMLVideoElement;
      const result = await detectFaceFrame(engine, video);
      expect(drawImage).toHaveBeenCalledWith(video, 20, 30, 200, 200, 0, 0, 32, 32);
      expect(result.frame?.brightness).toBeCloseTo(220 / 255);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves gestures when the descriptor is not ready yet", async () => {
    const engine = {
      detect: async () => ({
        face: [{
          embedding: undefined,
          faceScore: 0.9,
          boxScore: 0.9,
          real: 0.8,
          live: 0.8,
          box: [0, 0, 240, 240],
          rotation: { angle: { yaw: 0.1 } },
        }],
        gesture: [{ gesture: "blink left eye" }],
      }),
    } as unknown as Parameters<typeof detectFaceFrame>[0];

    const result = await detectFaceFrame(engine, {} as HTMLVideoElement);
    expect(result.faceCount).toBe(1);
    expect(result.frame?.embedding).toEqual([]);
    expect(result.frame?.gestures).toContain("blink left eye");
    expect(result.frame?.yaw).toBe(0.1);
    expect(result.frame?.brightness).toBeNull();
  });

  it("accepts a centered mesh angle when the strict gesture label is absent", () => {
    const frame = { gestures: [], yaw: 0.1 } as unknown as FaceFrame;
    expect(faceFacingCenter(frame)).toBe(true);
    expect(faceFacingCenter({ ...frame, yaw: 0.4 })).toBe(false);
    expect(faceFacingCenter({ ...frame, yaw: null })).toBe(false);
  });
});
