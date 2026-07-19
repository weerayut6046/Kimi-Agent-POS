/** สร้าง state เริ่มต้นของหน้า Settings จากข้อมูลที่ React Query cache ไว้แล้ว */
export function createInitialSettingsForm(
  settingMap: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  return { ...(settingMap ?? {}) };
}
