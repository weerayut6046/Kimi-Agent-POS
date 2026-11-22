import os from "node:os";
import { expect, it, vi } from "vitest";
import { getLanUrls } from "./lan";

it("keeps the POS available when LAN discovery is restricted", () => {
  const interfaces = vi.spyOn(os, "networkInterfaces").mockImplementation(() => {
    throw new Error("interface enumeration unavailable");
  });
  try {
    expect(getLanUrls(3000)).toEqual([]);
  } finally {
    interfaces.mockRestore();
  }
});
