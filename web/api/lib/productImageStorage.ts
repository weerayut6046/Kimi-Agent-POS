import { createClient } from "@supabase/supabase-js";
import { env } from "./env";
import { safeExternalProductImageUrl } from "./externalProductLookup";

const PRODUCT_IMAGE_BUCKET = "pumppos-product-images";
const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PRODUCT_IMAGE_TIMEOUT_MS = 8_000;
const PRODUCT_IMAGE_USER_AGENT =
  "PumpPOS/2.1.11 (https://github.com/weerayut6046/Kimi-Agent-POS)";
const IMAGE_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

type ProductImageStorage = {
  prepare(): Promise<void>;
  upload(
    path: string,
    bytes: Uint8Array,
    contentType: string
  ): Promise<void>;
  publicUrl(path: string): string;
};

type PersistProductImageDependencies = {
  fetchImpl?: typeof fetch;
  storage?: ProductImageStorage | null;
};

let storageAdapter: ProductImageStorage | null | undefined;
let bucketReady: Promise<void> | null = null;

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  for (const key of ["statusCode", "status"] as const) {
    const value = (error as Record<string, unknown>)[key];
    const parsed = Number(value);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    errorStatus(error) === 409 ||
    /already exists|duplicate/i.test(errorMessage(error))
  );
}

function configuredStorageAdapter(): ProductImageStorage | null {
  if (storageAdapter !== undefined) return storageAdapter;
  if (!env.supabaseUrl || !env.supabaseSecretKey) {
    storageAdapter = null;
    return storageAdapter;
  }

  const client = createClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  storageAdapter = {
    async prepare() {
      bucketReady ??= (async () => {
        const current = await client.storage.getBucket(PRODUCT_IMAGE_BUCKET);
        if (current.data) {
          if (!current.data.public) {
            const updated = await client.storage.updateBucket(
              PRODUCT_IMAGE_BUCKET,
              {
                public: true,
                fileSizeLimit: PRODUCT_IMAGE_MAX_BYTES,
                allowedMimeTypes: [...IMAGE_EXTENSIONS.keys()],
              }
            );
            if (updated.error) throw updated.error;
          }
          return;
        }

        const created = await client.storage.createBucket(
          PRODUCT_IMAGE_BUCKET,
          {
            public: true,
            fileSizeLimit: PRODUCT_IMAGE_MAX_BYTES,
            allowedMimeTypes: [...IMAGE_EXTENSIONS.keys()],
          }
        );
        if (created.error && !isAlreadyExistsError(created.error)) {
          throw created.error;
        }
      })().catch(error => {
        bucketReady = null;
        throw error;
      });
      await bucketReady;
    },
    async upload(path, bytes, contentType) {
      const result = await client.storage
        .from(PRODUCT_IMAGE_BUCKET)
        .upload(path, bytes, {
          cacheControl: "31536000",
          contentType,
          upsert: true,
        });
      if (result.error) throw result.error;
    },
    publicUrl(path) {
      return client.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path).data
        .publicUrl;
    },
  };
  return storageAdapter;
}

async function downloadProductImage(
  imageUrl: string,
  fetchImpl: typeof fetch
): Promise<{ bytes: Uint8Array; contentType: string; extension: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PRODUCT_IMAGE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(imageUrl, {
      method: "GET",
      headers: {
        Accept: "image/jpeg,image/png,image/webp",
        "User-Agent": PRODUCT_IMAGE_USER_AGENT,
      },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Product image download failed (HTTP ${response.status})`);
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > PRODUCT_IMAGE_MAX_BYTES) {
      throw new Error("Product image is larger than 5 MB");
    }
    const contentType =
      response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
    const extension = IMAGE_EXTENSIONS.get(contentType);
    if (!extension) throw new Error("Unsupported product image type");

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > PRODUCT_IMAGE_MAX_BYTES) {
      throw new Error("Product image has an invalid size");
    }
    return { bytes, contentType, extension };
  } finally {
    clearTimeout(timeout);
  }
}

async function contentHash(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest).slice(0, 8), value =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

/**
 * Mirrors a trusted Open Facts image to the POS Storage bucket. If Storage is
 * unavailable, keep the validated provider URL so importing a product still
 * succeeds and the image remains persisted in the product row.
 */
export async function persistExternalProductImage(
  input: { imageUrl: string | null | undefined; branchId: number; barcode: string },
  dependencies: PersistProductImageDependencies = {}
): Promise<string | null> {
  const sourceUrl = safeExternalProductImageUrl(input.imageUrl);
  if (!sourceUrl) return null;

  const storage =
    dependencies.storage === undefined
      ? configuredStorageAdapter()
      : dependencies.storage;
  if (!storage) return sourceUrl;

  try {
    const image = await downloadProductImage(
      sourceUrl,
      dependencies.fetchImpl ?? fetch
    );
    const hash = await contentHash(image.bytes);
    const path = `${input.branchId}/${input.barcode}-${hash}.${image.extension}`;
    await storage.prepare();
    await storage.upload(path, image.bytes, image.contentType);
    return storage.publicUrl(path);
  } catch (error) {
    console.warn("Unable to mirror external product image; using source URL", {
      message: errorMessage(error),
    });
    return sourceUrl;
  }
}
