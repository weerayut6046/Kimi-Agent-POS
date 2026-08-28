import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pumppos/features/setup/presentation/config_missing_page.dart';

void main() {
  testWidgets('shows safe setup guidance when configuration is absent', (
    tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: ConfigMissingPage()));

    expect(find.text('ยังไม่ได้ตั้งค่า Mobile Environment'), findsOneWidget);
    expect(find.textContaining('SUPABASE_PUBLISHABLE_KEY'), findsOneWidget);
    expect(find.textContaining('service_role'), findsOneWidget);
  });
}
