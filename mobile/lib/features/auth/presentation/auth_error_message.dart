String friendlyAuthErrorMessage(Object error) {
  final message = error.toString().trim().replaceFirst(
    RegExp(r'^(AuthException|TrpcException):\s*'),
    '',
  );
  final normalized = message.toLowerCase();

  if (normalized.contains('invalid_credentials') ||
      normalized.contains('invalid login credentials')) {
    return 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่';
  }
  if (normalized.contains('network') ||
      normalized.contains('socket') ||
      normalized.contains('connection')) {
    return 'เชื่อมต่อระบบไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
  }
  if (normalized.contains('too many requests') ||
      normalized.contains('over_request_rate_limit')) {
    return 'ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่';
  }
  if (message.isEmpty) {
    return 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่';
  }
  return message;
}
