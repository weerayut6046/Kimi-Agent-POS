import { describe, expect, it } from "vitest";
import {
  inferNozzleSide,
  inferPumpNumber,
  suggestNozzleId,
  type MeterNozzleTarget,
} from "./shiftMeterScan";

const targets: MeterNozzleTarget[] = [
  {
    nozzleId: 11,
    label: "ตู้ 1 (ซ้าย) - GSH95",
    pumpName: "ตู้จ่าย 1",
    openMeter: 0,
    openMoney: 0,
    pricePerLiter: 40,
    priceChangedDuringShift: false,
  },
  {
    nozzleId: 12,
    label: "ตู้ 1 (ขวา) - DB7",
    pumpName: "ตู้จ่าย 1",
    openMeter: 0,
    openMoney: 0,
    pricePerLiter: 40,
    priceChangedDuringShift: false,
  },
  {
    nozzleId: 21,
    label: "ตู้ 2 left - GSH95",
    pumpName: "Pump 2",
    openMeter: 0,
    openMoney: 0,
    pricePerLiter: 40,
    priceChangedDuringShift: false,
  },
];

describe("shift meter image mapping", () => {
  it("อ่านเลขตู้จากชื่อและตำแหน่งจากชื่อหัวจ่าย", () => {
    expect(inferPumpNumber("ตู้จ่าย 12")).toBe(12);
    expect(inferNozzleSide("ตู้ 1 (ซ้าย) - GSH95")).toBe("left");
    expect(inferNozzleSide("Pump 1 RIGHT")).toBe("right");
  });

  it("แนะนำหัวจ่ายเมื่อเลขตู้และฝั่งตรงกันเพียงรายการเดียว", () => {
    expect(suggestNozzleId(targets, 1, "left")).toBe(11);
    expect(suggestNozzleId(targets, 1, "right")).toBe(12);
    expect(suggestNozzleId(targets, 2, "left")).toBe(21);
    expect(suggestNozzleId(targets, null, "left")).toBeNull();
    expect(suggestNozzleId(targets, null, "right")).toBe(12);
  });
});
