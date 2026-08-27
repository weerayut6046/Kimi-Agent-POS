const MAX_QR_IMAGE_BYTES = 8_000_000;
const MAX_DECODE_EDGE = 2_048;
const MAX_SOURCE_PIXELS = 80_000_000;
const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type DecodedQrImage = {
  payload: string;
  previewUrl: string;
};

export async function decodeQrPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): Promise<string | null> {
  // โหลดตัวถอด QR เฉพาะเมื่อผู้ดูแลเลือกไฟล์ ไม่เพิ่มภาระให้หน้า POS
  const { default: jsQR } = await import("jsqr");
  return (
    jsQR(pixels, width, height, { inversionAttempts: "attemptBoth" })?.data
      .trim() || null
  );
}

function validateFile(file: File) {
  const extensionAccepted = /\.(?:jpe?g|png|webp)$/i.test(file.name);
  if (
    (file.type && !ACCEPTED_IMAGE_TYPES.has(file.type)) ||
    (!file.type && !extensionAccepted)
  ) {
    throw new Error("รองรับเฉพาะรูป QR แบบ PNG, JPG หรือ WebP");
  }
  if (file.size <= 0) throw new Error("ไฟล์รูป QR ว่างเปล่า");
  if (file.size > MAX_QR_IMAGE_BYTES) {
    throw new Error("ไฟล์รูป QR ต้องมีขนาดไม่เกิน 8MB");
  }
}

async function loadImage(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("อ่านไฟล์รูป QR ไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("ไฟล์นี้ไม่ใช่รูปภาพที่เปิดได้"));
    element.src = dataUrl;
  });
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

function canvas2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("เบราว์เซอร์นี้ไม่รองรับการอ่านรูป QR");
  return context;
}

/** อ่าน QR ในเครื่องผู้ใช้ รูปต้นฉบับจะไม่ถูกอัปโหลดไปยังเซิร์ฟเวอร์ */
export async function decodeQrImageFile(file: File): Promise<DecodedQrImage> {
  validateFile(file);
  let loaded: Awaited<ReturnType<typeof loadImage>>;
  try {
    loaded = await loadImage(file);
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error("อ่านไฟล์รูป QR ไม่สำเร็จ");
  }

  try {
    if (loaded.width < 80 || loaded.height < 80) {
      throw new Error("รูป QR มีความละเอียดต่ำเกินไป");
    }
    if (loaded.width * loaded.height > MAX_SOURCE_PIXELS) {
      throw new Error("รูป QR มีความละเอียดสูงเกินไป กรุณาย่อรูปก่อนอัปโหลด");
    }

    const scale = Math.min(
      1,
      MAX_DECODE_EDGE / Math.max(loaded.width, loaded.height)
    );
    const width = Math.max(1, Math.round(loaded.width * scale));
    const height = Math.max(1, Math.round(loaded.height * scale));
    const decodeCanvas = document.createElement("canvas");
    decodeCanvas.width = width;
    decodeCanvas.height = height;
    const context = canvas2d(decodeCanvas);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.drawImage(loaded.source, 0, 0, width, height);

    const payload = await decodeQrPixels(
      context.getImageData(0, 0, width, height).data,
      width,
      height
    );
    if (!payload) {
      throw new Error(
        "ไม่พบ QR ในรูป กรุณาใช้รูปที่คมชัด เห็น QR เต็มกรอบ และไม่มีแสงสะท้อน"
      );
    }

    const previewScale = Math.min(1, 420 / Math.max(loaded.width, loaded.height));
    const preview = document.createElement("canvas");
    preview.width = Math.max(1, Math.round(loaded.width * previewScale));
    preview.height = Math.max(1, Math.round(loaded.height * previewScale));
    const previewContext = canvas2d(preview);
    previewContext.fillStyle = "#ffffff";
    previewContext.fillRect(0, 0, preview.width, preview.height);
    previewContext.drawImage(loaded.source, 0, 0, preview.width, preview.height);

    return { payload, previewUrl: preview.toDataURL("image/png") };
  } finally {
    loaded.close?.();
  }
}
