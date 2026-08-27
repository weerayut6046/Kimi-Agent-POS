import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { decodeQrPixels } from "./qrImageDecoder";

function qrPixels(payload: string, scale = 5, quietZone = 4) {
  const modules = QRCode.create(payload, { errorCorrectionLevel: "M" }).modules;
  const size = modules.size + quietZone * 2;
  const width = size * scale;
  const pixels = new Uint8ClampedArray(width * width * 4);
  pixels.fill(255);

  for (let y = 0; y < modules.size; y += 1) {
    for (let x = 0; x < modules.size; x += 1) {
      if (!modules.get(x, y)) continue;
      for (let py = 0; py < scale; py += 1) {
        for (let px = 0; px < scale; px += 1) {
          const targetX = (x + quietZone) * scale + px;
          const targetY = (y + quietZone) * scale + py;
          const offset = (targetY * width + targetX) * 4;
          pixels[offset] = 0;
          pixels[offset + 1] = 0;
          pixels[offset + 2] = 0;
          pixels[offset + 3] = 255;
        }
      }
    }
  }
  return { pixels, width };
}

describe("QR image decoder", () => {
  it("อ่านข้อความ QR ร้านค้าจากพิกเซลของรูปอัปโหลด", async () => {
    const payload =
      "00020101021130830016A0000006770101120115010753700088205021922141170560220009090317WEERAYUTNAMWONGSA53037645802TH62080704000063046EAD";
    const { pixels, width } = qrPixels(payload);

    await expect(decodeQrPixels(pixels, width, width)).resolves.toBe(payload);
  });

  it("คืน null เมื่อรูปไม่มี QR", async () => {
    const pixels = new Uint8ClampedArray(200 * 200 * 4);
    pixels.fill(255);
    await expect(decodeQrPixels(pixels, 200, 200)).resolves.toBeNull();
  });
});
