import { describe, expect, it } from "vitest";
import { shouldStartLegacyUpdater } from "./updatePolicy";

describe("desktop update policy", () => {
  it("uses the legacy updater for an installed NSIS release", () => {
    expect(
      shouldStartLegacyUpdater({
        isPackaged: true,
        isPortable: false,
        isWindowsStore: false,
      })
    ).toBe(true);
  });

  it("lets Microsoft Store manage MSIX updates", () => {
    expect(
      shouldStartLegacyUpdater({
        isPackaged: true,
        isPortable: false,
        isWindowsStore: true,
      })
    ).toBe(false);
  });

  it.each([
    { isPackaged: false, isPortable: false, isWindowsStore: false },
    { isPackaged: true, isPortable: true, isWindowsStore: false },
  ])("does not update unsupported package modes", environment => {
    expect(shouldStartLegacyUpdater(environment)).toBe(false);
  });
});
