import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FaceCapture } from "./FaceCapture";
import type { FaceFrame } from "@/lib/faceRecognition";
import { frameStatus } from "@/lib/faceScanQuality";

describe("FaceCapture instructions", () => {
  it("keeps the required liveness action visible while models load", () => {
    const markup = renderToStaticMarkup(createElement(FaceCapture, {
      mode: "verify",
      action: "blink",
      onComplete: () => undefined,
      onCancel: () => undefined,
    }));
    expect(markup).toContain("ท่าที่ต้องทำ:");
    expect(markup).toContain("หลับตาค้างครู่หนึ่ง แล้วลืมตา");
    expect(markup).toContain("ภาพยืนยัน 1/3");
  });

  it("only asks for more light when the camera image is actually dark", () => {
    const frame: FaceFrame = {
      embedding: Array(128).fill(0.1),
      faceScore: 0.5,
      real: 0.4,
      live: 0.8,
      faceSize: 200,
      gestures: [],
      yaw: 0,
      brightness: 0.6,
    };
    expect(frameStatus(frame, 1)).not.toContain("เพิ่มแสง");
    expect(frameStatus({ ...frame, faceScore: 0.8 }, 1)).not.toContain("เพิ่มแสง");
    expect(frameStatus({ ...frame, brightness: 0.1 }, 1)).toContain("เพิ่มแสง");
  });
});
