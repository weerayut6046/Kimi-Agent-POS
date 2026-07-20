export type WorkAreaSize = { width: number; height: number };

export type DesktopWindowBounds = {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
};

/**
 * จำกัดขนาดหน้าต่างเริ่มต้นไม่ให้เกินพื้นที่ใช้งานจริงของจอ
 * และลด minimum ลงตามจอ เพื่อให้ title bar/ปุ่มด้านล่างไม่หลุดออกนอกหน้าจอ
 */
export function fitWindowToWorkArea(workArea: WorkAreaSize): DesktopWindowBounds {
  const availableWidth = Math.max(1, Math.floor(workArea.width));
  const availableHeight = Math.max(1, Math.floor(workArea.height));

  return {
    width: Math.min(1366, availableWidth),
    height: Math.min(900, availableHeight),
    minWidth: Math.min(720, availableWidth),
    minHeight: Math.min(520, availableHeight),
  };
}
