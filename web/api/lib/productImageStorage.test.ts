import { afterEach, describe, expect, it, vi } from "vitest";
import { persistExternalProductImage } from "./productImageStorage";

afterEach(() => vi.restoreAllMocks());

describe("persistExternalProductImage", () => {
  it("downloads a trusted image and stores it under a content-addressed path", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      })
    );
    const storage = {
      prepare: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn().mockResolvedValue(undefined),
      publicUrl: vi.fn((path: string) => `https://storage.example/${path}`),
    };

    const result = await persistExternalProductImage(
      {
        imageUrl:
          "https://images.openfoodfacts.org/images/products/example.jpg",
        branchId: 7,
        barcode: "8851234567890",
      },
      { fetchImpl: fetchMock, storage }
    );

    expect(result).toMatch(
      /^https:\/\/storage\.example\/7\/8851234567890-[a-f0-9]{16}\.jpg$/
    );
    expect(storage.prepare).toHaveBeenCalledOnce();
    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^7\/8851234567890-[a-f0-9]{16}\.jpg$/),
      bytes,
      "image/jpeg"
    );
  });

  it("rejects untrusted image hosts without making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const result = await persistExternalProductImage(
      {
        imageUrl: "https://example.com/untrusted.jpg",
        branchId: 1,
        barcode: "8851234567890",
      },
      { fetchImpl: fetchMock, storage: null }
    );

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the validated source URL when mirroring fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sourceUrl =
      "https://images.openfoodfacts.org/images/products/example.jpg";
    const storage = {
      prepare: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn().mockRejectedValue(new Error("storage unavailable")),
      publicUrl: vi.fn(),
    };

    const result = await persistExternalProductImage(
      { imageUrl: sourceUrl, branchId: 1, barcode: "8851234567890" },
      {
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "Content-Type": "image/png" },
          })
        ),
        storage,
      }
    );

    expect(result).toBe(sourceUrl);
    expect(console.warn).toHaveBeenCalledOnce();
  });
});
