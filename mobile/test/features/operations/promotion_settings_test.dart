import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:pumppos/core/network/trpc_client.dart';
import 'package:pumppos/features/auth/domain/staff_session.dart';
import 'package:pumppos/features/operations/data/operations_repository.dart';
import 'package:pumppos/features/operations/domain/operations_models.dart';
import 'package:pumppos/features/operations/presentation/operation_action_sheets.dart';

void main() {
  testWidgets('per-liter promotion opens one complete editor', (tester) async {
    await _pumpEditor(
      tester,
      const OperationItem(
        title: 'โปรโมชั่นลดต่อลิตร',
        subtitle: 'ลดทันที 50 สตางค์',
        entity: OperationEntity.perLiterPromotionConfig,
        record: {
          'promotion_enabled': '1',
          'promotion_name': 'ลดทันที 50 สตางค์',
          'promotion_discount': '0.50',
          'promotion_start_date': '2026-08-01',
          'promotion_end_date': '2026-08-31',
        },
      ),
    );

    expect(find.text('โปรโมชั่นลดราคาต่อลิตร'), findsOneWidget);
    expect(find.text('เปิดใช้งานโปรโมชั่น'), findsOneWidget);
    expect(find.text('ชื่อโปรโมชั่น *'), findsOneWidget);
    expect(find.text('ส่วนลดต่อลิตร *'), findsOneWidget);
    expect(find.text('วันที่เริ่ม *'), findsOneWidget);
    expect(find.text('วันที่สิ้นสุด *'), findsOneWidget);
    expect(find.text('ลดทันที 50 สตางค์'), findsOneWidget);
  });

  testWidgets('bill promotion opens one complete editor', (tester) async {
    await _pumpEditor(
      tester,
      const OperationItem(
        title: 'โปรโมชั่นลดท้ายบิล',
        subtitle: 'เติมครบรับส่วนลด',
        entity: OperationEntity.billPromotionConfig,
        record: {
          'bill_promotion_enabled': '0',
          'bill_promotion_name': 'เติมครบรับส่วนลด',
          'bill_promotion_min_fuel_spend': '1000',
          'bill_promotion_discount': '20',
          'bill_promotion_start_date': '2026-08-01',
          'bill_promotion_end_date': '2026-08-31',
        },
      ),
    );

    expect(find.text('โปรโมชั่นลดท้ายบิล'), findsWidgets);
    expect(find.text('เปิดใช้งานโปรโมชั่น'), findsOneWidget);
    expect(find.text('ชื่อโปรโมชั่น *'), findsOneWidget);
    expect(find.text('ยอดเติมน้ำมันขั้นต่ำ *'), findsOneWidget);
    expect(find.text('ส่วนลดท้ายบิล *'), findsOneWidget);
    expect(find.text('วันที่เริ่ม *'), findsOneWidget);
    expect(find.text('วันที่สิ้นสุด *'), findsOneWidget);
    expect(find.text('เติมครบรับส่วนลด'), findsOneWidget);
  });
}

Future<void> _pumpEditor(WidgetTester tester, OperationItem item) async {
  await tester.binding.setSurfaceSize(const Size(390, 844));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final repository = OperationsRepository(
    TrpcClient(
      baseUri: Uri.parse('https://example.supabase.co/functions/v1/pos-api'),
      publishableKey: 'sb_publishable_test',
      functionRegion: 'ap-southeast-1',
      accessTokenProvider: () => 'user-jwt',
      httpClient: MockClient(
        (_) async => http.Response(
          jsonEncode({
            'result': {
              'data': {
                'json': {'ok': true},
              },
            },
          }),
          200,
          headers: {'content-type': 'application/json'},
        ),
      ),
    ),
  );

  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: FilledButton(
              key: const Key('open-promotion'),
              onPressed: () => showOperationItemActions(
                context: context,
                item: item,
                staff: _staff(),
                repository: repository,
              ),
              child: const Text('เปิดโปรโมชั่น'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.byKey(const Key('open-promotion')));
  await tester.pumpAndSettle();
  expect(tester.takeException(), isNull);
}

StaffSession _staff() => const StaffSession(
  id: 1,
  name: 'ผู้จัดการ',
  username: 'manager',
  role: StaffRole.manager,
  menuPermissions: {'settings'},
  branch: BranchSummary(
    id: 7,
    code: 'MAIN',
    name: 'สาขาหลัก',
    address: '',
    phone: '',
    taxId: '',
    active: true,
  ),
  branches: [],
);
