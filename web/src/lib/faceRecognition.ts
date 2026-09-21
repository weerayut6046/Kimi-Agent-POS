import type { Human } from "@vladmandic/human";

export type FaceFrame = {
  embedding: number[];
  faceScore: number;
  real: number;
  live: number;
  faceSize: number;
  gestures: string[];
};

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
        // Reuse results for near-identical camera frames. Head turns and
        // blinks still exceed this threshold, while sensor noise does not.
        cacheSensitivity: 0.05,
        modelBasePath: "/models/human/",
        filter: { enabled: true, equalization: true, flip: false },
        face: {
          enabled: true,
          detector: {
            modelPath: "blazeface.json",
            maxDetected: 1,
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
  return {
    faceCount: 1,
    frame:
      embedding.length >= 128
        ? {
            embedding,
            faceScore: face.faceScore || face.boxScore || 0,
            real: face.real || 0,
            live: face.live || 0,
            faceSize: Math.min(face.box[2], face.box[3]),
            gestures,
          }
        : null,
  };
}
