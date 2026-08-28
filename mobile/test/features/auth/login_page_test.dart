import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pumppos/core/theme/app_theme.dart';
import 'package:pumppos/features/auth/presentation/login_page.dart';

void main() {
  Future<void> pumpLogin(
    WidgetTester tester, {
    required Size size,
    String? errorMessage,
  }) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = size;
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          theme: AppTheme.light,
          home: LoginPage(errorMessage: errorMessage),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('renders the compact web-aligned login without overflow', (
    tester,
  ) async {
    await pumpLogin(
      tester,
      size: const Size(432, 863),
      errorMessage: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่',
    );

    expect(find.text('PumpPOS'), findsOneWidget);
    expect(find.text('เข้าสู่ระบบพนักงาน'), findsOneWidget);
    expect(
      find.text('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('shows the web hero panel on a wide screen', (tester) async {
    await pumpLogin(tester, size: const Size(1200, 800));

    expect(find.text('NEXT GENERATION POS'), findsOneWidget);
    expect(find.text('งานหน้าปั๊ม\nคุมทุกจังหวะในหน้าจอเดียว'), findsOneWidget);
    expect(find.text('เข้าสู่ระบบพนักงาน'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
