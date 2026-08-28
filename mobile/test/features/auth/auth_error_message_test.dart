import 'package:flutter_test/flutter_test.dart';
import 'package:pumppos/features/auth/presentation/auth_error_message.dart';

void main() {
  test('translates Supabase invalid credentials into actionable Thai', () {
    final message = friendlyAuthErrorMessage(
      'AuthException(message: Invalid login credentials, '
      'statusCode: 400, code: invalid_credentials)',
    );

    expect(message, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่');
    expect(message, isNot(contains('AuthException')));
  });

  test('keeps an unknown useful error message', () {
    expect(friendlyAuthErrorMessage('ระบบกำลังปรับปรุง'), 'ระบบกำลังปรับปรุง');
  });
}
