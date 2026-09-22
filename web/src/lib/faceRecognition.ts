import type { Human } from "@vladmandic/human";

export type FaceFrame = {
  embedding: number[];
  faceScore: number;
  real: number;
  live: number;
  faceSize: number;
  gestures: string[];
  yaw: number | null;
  brightness: number | null;
};

export function meanFaceBrightness(pixels: Uint8ClampedArray): number | null {
  if (pixels.length < 4) return null;
  let luminance = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    luminance += 0.2126 * pixels[index]! +
      0.7152 * pixels[index + 1]! + 0.0722 * pixels[index + 2]!;
  }
  return luminance / (pixels.length / 4) / 255;
}

function measureFaceBrightness(video: HTMLVideoElement, box: [number, number, number, number]): number | null {
  if (!video.videoWidth || !video.videoHeight || typeof document === "undefined") return null;
  const [x, y, width, height] = box;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  try {
    context.drawImage(video, x, y, width, height, 0, 0, 32, 32);
    return meanFaceBrightness(context.getImageData(0, 0, 32, 32).data);
  } catch {
    return null;
  }
}

export function faceFacingCenter(frame: FaceFrame): boolean {
  // Gesture and rotation are produced by the mesh independently. A mobile
  // browser may miss the stricter gesture label on an otherwise centered face.
  return frame.gestures.includes("facing center") ||
    (frame.yaw !== null && Math.abs(frame.yaw) <= 0.22);
}

let enginePromise: Promise<Human> | null = null;

export function loadFaceEngine(): Promise<Human> {
  if (enginePromise) return enginePromise;
  enginePromise = import("@vladmandic/human")
    .then(async ({ Human }) => {
      const engine = new Human({
        backend: "webgl",
        debug: false,
        async: true,
        // Human's browser warmup fetches an embedded `data:` image. Keep it
        // disabled so the face scanner works with our strict connect-src CSP;
        // the first camera frame initializes the inference kernels instead.
        warmup: "none",
        cacheModels: true,
        // Blinks can change only a small area of a portrait frame. A larger
        // cache threshold reused stale mesh/anti-spoof results on phones.
        cacheSensitivity: 0.01,
        modelBasePath: "/models/human/",
        filter: { enabled: true, equalization: true, flip: false },
        face: {
          enabled: true,
          detector: {
            modelPath: "blazeface.json",
            maxDetected: 2,
            minConfidence: 0.6,
            minSize: 80,
            rotation: true,
            return: false,
            skipFrames: 1,
            skipTime: 100,
          },
          mesh: {
            enabled: true,
            modelPath: "facemesh.json",
            keepInvalid: false,
          },
          // Face mesh already provides every landmark used by our blink and
          // head-turn challenges, so the separate iris model only adds work.
          iris: { enabled: false, modelPath: "iris.json" },
          description: {
            enabled: true,
            modelPath: "faceres.json",
            minConfidence: 0.5,
            skipFrames: 2,
            skipTime: 350,
          },
          emotion: { enabled: false },
          antispoof: {
            enabled: true,
            modelPath: "antispoof.json",
            skipFrames: 2,
            skipTime: 350,
          },
          liveness: {
            enabled: true,
            modelPath: "liveness.json",
            skipFrames: 2,
            skipTime: 350,
          },
        },
        body: { enabled: false },
        hand: { enabled: false },
        object: { enabled: false },
        segmentation: { enabled: false },
        gesture: { enabled: true },
      });
      await engine.load();
      return engine;
    })
    .catch(error => {
      enginePromise = null;
      throw error;
    });
  return enginePromise;
}

export async function detectFaceFrame(
  engine: Human,
  video: HTMLVideoElement
): Promise<{ frame: FaceFrame | null; faceCount: number }> {
  const result = await engine.detect(video);
  if (result.face.length !== 1) {
    return { frame: null, faceCount: result.face.length };
  }
  const face = result.face[0]!;
  const embedding = face.embedding ? [...face.embedding] : [];
  const gestures = result.gesture.map(item => item.gesture);
  const yaw = face.rotation?.angle.yaw;
  const faceScore = face.faceScore ?? face.boxScore ?? 0;
  const real = face.real || 0;
  return {
    faceCount: 1,
    frame: {
      embedding,
      faceScore,
      real,
      live: face.live || 0,
      faceSize: Math.min(face.box[2], face.box[3]),
      gestures,
      yaw: typeof yaw === "number" && Number.isFinite(yaw) ? yaw : null,
      // Read the camera image only when guidance might mention lighting.
      brightness: faceScore < 0.6 || real < 0.6
        ? measureFaceBrightness(video, face.box)
        : null,
    },
  };
}
