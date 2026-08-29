import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pumppos/features/auth/domain/staff_session.dart';
import 'package:pumppos/features/shifts/application/shift_provider.dart';
import 'package:pumppos/features/shifts/domain/shift_models.dart';
import 'package:pumppos/features/shifts/presentation/shift_page.dart';

void main() {
  testWidgets('renders opening readings when no shift is active', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          shiftBootstrapProvider(3).overrideWith((ref) async => _bootstrap),
        ],
        child: const MaterialApp(
          home: Scaffold(body: ShiftPage(staff: _staff)),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('เปิดกะใหม่'), findsOneWidget);
    expect(find.byKey(const Key('shift-history-button')), findsOneWidget);
    expect(find.text('หัว 1'), findsOneWidget);
    expect(find.text('เงินทอนเริ่มกะ (บาท)'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('shows counted total with POS sales and expenses', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          shiftBootstrapProvider(
            3,
          ).overrideWith((ref) async => _activeBootstrap),
        ],
        child: const MaterialApp(
          home: Scaffold(body: ShiftPage(staff: _staff)),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('POS ฿500.00'), findsOneWidget);
    expect(find.textContaining('ค่าใช้จ่าย ฿60.00'), findsOneWidget);
    expect(find.text('ยอดนับได้รวม ฿440.00'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

const _bootstrap = ShiftBootstrap(
  currentShift: null,
  nozzles: [
    ShiftNozzle(
      id: 7,
      label: 'หัว 1',
      pumpName: 'ตู้ 1',
      productName: 'แก๊สโซฮอล์ 95',
      currentMeter: 1000,
      currentMoney: 37000,
      active: true,
    ),
  ],
);

final _activeBootstrap = ShiftBootstrap(
  currentShift: CurrentShift(
    id: 14,
    staffName: 'แคชเชียร์',
    openedAt: null,
    openingFloat: 500,
    expectedCash: 940,
    posSales: 500,
    expensesTotal: 60,
    readings: const [
      ShiftReading(
        nozzleId: 7,
        label: 'หัว 1',
        pumpName: 'ตู้ 1',
        productName: 'แก๊สโซฮอล์ 95',
        openMeter: 1000,
        openMoney: 37000,
        pricePerLiter: 37,
        priceChangedDuringShift: false,
      ),
    ],
  ),
  nozzles: _bootstrap.nozzles,
);

const _staff = StaffSession(
  id: 12,
  name: 'แคชเชียร์',
  username: 'cashier',
  role: StaffRole.cashier,
  menuPermissions: {'shifts'},
  branch: BranchSummary(
    id: 3,
    code: 'BKK-01',
    name: 'สถานีทดสอบ',
    address: '',
    phone: '',
    taxId: '',
    active: true,
  ),
  branches: [],
);
