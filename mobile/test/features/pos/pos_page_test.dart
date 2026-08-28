import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pumppos/features/auth/domain/staff_session.dart';
import 'package:pumppos/features/pos/application/pos_provider.dart';
import 'package:pumppos/features/pos/domain/pos_models.dart';
import 'package:pumppos/features/pos/presentation/pos_page.dart';

void main() {
  testWidgets('renders the mobile product catalog for an open shift', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          posBootstrapProvider(3).overrideWith((ref) async => _bootstrap),
        ],
        child: const MaterialApp(
          home: Scaffold(body: PosPage(staff: _staff)),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('หน้าขาย'), findsOneWidget);
    expect(find.text('แก๊สโซฮอล์ 95'), findsOneWidget);
    expect(find.textContaining('กะ #9'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

const _bootstrap = PosBootstrap(
  products: [
    PosProduct(
      id: 1,
      code: 'GSH95',
      name: 'แก๊สโซฮอล์ 95',
      category: ProductCategory.fuel,
      unit: 'ลิตร',
      price: 37.5,
      stockQty: 1000,
      active: true,
    ),
  ],
  settings: {
    'pay_cash_enabled': '1',
    'pay_qr_enabled': '1',
    'pay_card_enabled': '1',
  },
  currentShift: PosShift(id: 9, staffName: 'แคชเชียร์', openedAt: null),
);

const _staff = StaffSession(
  id: 12,
  name: 'แคชเชียร์',
  username: 'cashier',
  role: StaffRole.cashier,
  menuPermissions: {'pos'},
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
