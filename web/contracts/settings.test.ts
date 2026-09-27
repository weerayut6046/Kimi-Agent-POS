import { describe, expect, it } from "vitest";
import {
  APP_TEMPLATE_IDS,
  APP_TEMPLATE_OPTIONS,
  DEFAULT_APP_TEMPLATE,
  DEFAULT_SETTINGS,
  mergeSettingDefaults,
  normalizeAppTemplate,
  normalizeAppTheme,
  normalizeMeterOcrMode,
} from "./settings";

describe("application template settings", () => {
  it("uses PumpPOS for missing or invalid stored values", () => {
    expect(DEFAULT_APP_TEMPLATE).toBe("pumppos");
    expect(DEFAULT_SETTINGS.app_template).toBe("pumppos");
    expect(mergeSettingDefaults([]).app_template).toBe("pumppos");
    for (const value of [undefined, null, 123, {}, "unknown-template"]) {
      expect(normalizeAppTemplate(value)).toBe("pumppos");
    }
    expect(
      mergeSettingDefaults([["app_template", "invalid"]]).app_template
    ).toBe("pumppos");
  });

  it("preserves supported templates independently of the color theme", () => {
    expect(normalizeAppTemplate("pumppos")).toBe("pumppos");
    expect(normalizeAppTemplate("tailadmin")).toBe("tailadmin");
    const merged = mergeSettingDefaults([
      ["app_template", "tailadmin"],
      ["app_theme", "ocean"],
    ]);
    expect(merged.app_template).toBe("tailadmin");
    expect(merged.app_theme).toBe("ocean");
  });

  it("exposes one named option for each supported template", () => {
    expect(APP_TEMPLATE_OPTIONS.map(option => option.id)).toEqual(
      APP_TEMPLATE_IDS
    );
    expect(APP_TEMPLATE_OPTIONS.map(option => option.label)).toEqual([
      "PumpPOS",
      "TailAdmin",
    ]);
  });
});

describe("application theme settings", () => {
  it("uses Command Center for missing or invalid legacy values", () => {
    expect(DEFAULT_SETTINGS.app_theme).toBe("command");
    expect(normalizeAppTheme(undefined)).toBe("command");
    expect(normalizeAppTheme("unknown-theme")).toBe("command");
    expect(mergeSettingDefaults([["app_theme", "invalid"]]).app_theme).toBe(
      "command"
    );
  });

  it("preserves every supported theme", () => {
    expect(normalizeAppTheme("calm")).toBe("calm");
    expect(normalizeAppTheme("thai-modern")).toBe("thai-modern");
    expect(normalizeAppTheme("industrial")).toBe("industrial");
    expect(normalizeAppTheme("ocean")).toBe("ocean");
  });
});

describe("meter OCR settings", () => {
  it("บังคับทุกค่าจากฐานข้อมูลรุ่นเก่าให้ประมวลผลในเครื่อง", () => {
    expect(normalizeMeterOcrMode("local")).toBe("local");
    expect(normalizeMeterOcrMode("gemini")).toBe("local");
    expect(normalizeMeterOcrMode("auto")).toBe("local");
    expect(normalizeMeterOcrMode(undefined)).toBe("local");
    expect(DEFAULT_SETTINGS.meter_ocr_mode).toBe("local");
    expect(
      mergeSettingDefaults([["meter_ocr_mode", "gemini"]]).meter_ocr_mode
    ).toBe("local");
  });
});
