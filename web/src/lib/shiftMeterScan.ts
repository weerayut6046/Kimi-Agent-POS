import {
  METER_OCR_MAX_BASE64_CHARS_PER_IMAGE,
  type MeterDisplaySide,
} from "@contracts/meterOcr";

export type MeterNozzleTarget = {
  nozzleId: number;
  label: string;
  pumpName: string;
  openMeter: number;
  openMoney: number;
  pricePerLiter: number;
  priceChangedDuringShift: boolean;
};

export type PreparedMeterImage = {
  id: string;
  fileName: string;
  mimeType: "image/jpeg";
  contentBase64: string;
  previewDataUrl: string;
};

export function inferPumpNumber(name: string): number | null {
  const matches = name.match(/\d+/g);
  if (!matches?.length) return null;
  const number = Number(matches.at(-1));
  return Number.isInteger(number) && number >= 0 ? number : null;
}

export function inferNozzleSide(label: string): MeterDisplaySide | null {
  if (/(?:ซ้าย|left)/i.test(label)) return "left";
  if (/(?:ขวา|right)/i.test(label)) return "right";
  return null;
}

export function suggestNozzleId(
  targets: MeterNozzleTarget[],
  pumpNumber: number | null,
  side: MeterDisplaySide
): number | null {
  const sideMatches = targets.filter(
    target => inferNozzleSide(target.label) === side
  );
  const matches =
    pumpNumber == null
      ? sideMatches
      : sideMatches.filter(
          target => inferPumpNumber(target.pumpName) === pumpNumber
        );
  return matches.length === 1 ? matches[0]!.nozzleId : null;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("อ่านไฟล์ภาพไม่สำเร็จ"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

async function loadImageSource(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("เปิดไฟล์ภาพไม่สำเร็จ"));
      image.src = objectUrl;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function canvasToJpeg(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob =>
        blob ? resolve(blob) : reject(new Error("บีบอัดไฟล์ภาพไม่สำเร็จ")),
      "image/jpeg",
      quality
    );
  });
}

export async function prepareMeterImage(
  file: File,
  id = `${file.name}:${file.size}:${file.lastModified}`
): Promise<PreparedMeterImage> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error(`ไฟล์ ${file.name} ต้องเป็น JPG, PNG หรือ WebP`);
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error(`ไฟล์ ${file.name} มีขนาดเกิน 20 MB`);
  }

  const loaded = await loadImageSource(file);
  try {
    const renderJpeg = async (maxDimension: number, quality: number) => {
      const scale = Math.min(
        1,
        maxDimension / Math.max(loaded.width, loaded.height)
      );
      const width = Math.max(1, Math.round(loaded.width * scale));
      const height = Math.max(1, Math.round(loaded.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("อุปกรณ์นี้ไม่รองรับการปรับขนาดภาพ");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(loaded.source, 0, 0, width, height);
      return blobToDataUrl(await canvasToJpeg(canvas, quality));
    };

    // ภาพ local คงรายละเอียดสูง ส่วนสำเนาที่ส่ง AI จำกัดขนาด payload แยกกัน
    // และทั้งสองสำเนาถูก encode ใหม่เป็น JPEG จึงไม่มี EXIF/GPS ติดออกไป
    const previewDataUrl = await renderJpeg(2_560, 0.92);
    for (const attempt of [
      { maxDimension: 2_000, quality: 0.88 },
      { maxDimension: 1_800, quality: 0.82 },
      { maxDimension: 1_600, quality: 0.76 },
      { maxDimension: 1_400, quality: 0.72 },
    ]) {
      const aiDataUrl = await renderJpeg(
        attempt.maxDimension,
        attempt.quality
      );
      const contentBase64 = aiDataUrl.split(",", 2)[1] ?? "";
      if (
        contentBase64.length > 0 &&
        contentBase64.length <= METER_OCR_MAX_BASE64_CHARS_PER_IMAGE
      ) {
        return {
          id,
          fileName: file.name,
          mimeType: "image/jpeg",
          contentBase64,
          previewDataUrl,
        };
      }
    }
  } finally {
    loaded.close();
  }

  throw new Error(
    `ไฟล์ ${file.name} ยังมีขนาดใหญ่เกินไปหลังบีบอัด กรุณาครอปเฉพาะหน้าตู้แล้วลองใหม่`
  );
}
