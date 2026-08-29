import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:pumppos/core/theme/app_theme.dart';
import 'package:pumppos/features/auth/domain/system_access_status.dart';
import 'package:pumppos/features/auth/presentation/shift_access_blocked_page.dart';

void main() {
  test('parses a blocked access response and active shift', () {
    final status = SystemAccessStatus.fromJson({
      'allowed': false,
      'reason': 'active_shift_locked',
      'workDate': '2026-08-29',
      'hasWorkSchedule': false,
      'message': 'มีกะของพนักงานคนอื่นกำลังใช้งานอยู่',
      'activeShift': {
        'id': 42,
        'staffName': 'พนักงานกะเช้า',
        'openedAt': '2026-08-29T01:00:00.000Z',
      },
    });

    expect(status.allowed, isFalse);
    expect(status.reason, 'active_shift_locked');
    expect(status.activeShift?.id, 42);
    expect(status.activeShift?.staffName, 'พนักงานกะเช้า');
  });

  testWidgets('shows shift details with refresh and logout actions', (
    tester,
  ) async {
    await initializeDateFormatting('th_TH');
    var refreshed = false;
    var loggedOut = false;
    final status = SystemAccessStatus.fromJson({
      'allowed': false,
      'reason': 'active_shift_locked',
      'workDate': '2026-08-29',
      'hasWorkSchedule': false,
      'message': 'ขณะนี้กะของพนักงานกะเช้ากำลังใช้งานอยู่',
      'activeShift': {
        'id': 42,
        'staffName': 'พนักงานกะเช้า',
        'openedAt': '2026-08-29T01:00:00.000Z',
      },
    });

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light,
        home: ShiftAccessBlockedPage(
          staffName: 'พนักงานกะบ่าย',
          branchName: 'สาขาหลัก',
          status: status,
          onRefresh: () => refreshed = true,
          onLogout: () => loggedOut = true,
        ),
      ),
    );

    expect(find.text('ยังเข้าใช้งานระบบไม่ได้'), findsOneWidget);
    expect(find.text('กะที่กำลังใช้งาน #42'), findsOneWidget);
    expect(find.text('ผู้เปิดกะ: พนักงานกะเช้า'), findsOneWidget);
    expect(find.text('พนักงานกะบ่าย · สาขาหลัก'), findsOneWidget);

    await tester.tap(find.text('ตรวจสอบอีกครั้ง'));
    await tester.tap(find.text('ออกจากระบบ'));
    expect(refreshed, isTrue);
    expect(loggedOut, isTrue);
    expect(tester.takeException(), isNull);
  });
}
