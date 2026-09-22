import type { FaceFrame } from "./faceRecognition";

// Only flag severe underexposure; normal skin tones vary widely.
const DARK_FACE_BRIGHTNESS = 0.15;

export function frameStatus(frame: FaceFrame | null, faceCount: number): string {
  if (faceCount === 0) return "วางใบหน้าให้อยู่กลางกรอบ";
  if (faceCount > 1) return "ให้มีเพียง 1 คนอยู่ในภาพ";
  if (!frame) return "กำลังอ่านรายละเอียดใบหน้า...";
  if (frame.faceSize < 160) return "ขยับเข้าใกล้กล้องอีกนิด";
  if (frame.brightness !== null && frame.brightness < DARK_FACE_BRIGHTNESS)
    return "ภาพใบหน้ามืด กรุณาเพิ่มแสงด้านหน้าและเลี่ยงแสงย้อน";
  if (frame.faceScore < 0.6)
    return "มองกล้องตรง ๆ และถือกล้องให้นิ่ง";
  if (frame.real < 0.6)
    return "กำลังตรวจความเป็นบุคคลจริง กรุณามองกล้องตรงและอย่าใช้ฟิลเตอร์";
  if (frame.live < 0.6)
    return "ขยับใบหน้าเล็กน้อย แล้วกลับมามองกล้องตรง";
  if (frame.embedding.length < 128)
    return "เห็นใบหน้าแล้ว กำลังอ่านรายละเอียดเพื่อเปรียบเทียบ...";
  return "ตรวจพบใบหน้าแล้ว";
}
