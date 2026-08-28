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
  testWidgets('shop profile opens one form and saves every related setting', (
    tester,
  ) async {
    final requests = await _pumpEditor(
      tester,
      const OperationItem(
        title: 'ข้อมูลร้านและภาษี',
        subtitle: 'PumpPOS สาขาหลัก',
        entity: OperationEntity.shopProfileConfig,
        record: {
          'shop_name': 'PumpPOS สาขาหลัก',
          'shop_branch': 'สำนักงานใหญ่',
          'shop_address': 'กรุงเทพฯ',
          'shop_phone': '021234567',
          'tax_id': '0100000000001',
          'vat_rate': '7',
        },
      ),
    );

    expect(find.text('ข้อมูลร้านและภาษี'), findsOneWidget);
    for (final label in const [
      'ชื่อร้าน *',
      'ชื่อสาขาบนเอกสาร',
      'ที่อยู่',
      'โทรศัพท์',
      'เลขประจำตัวผู้เสียภาษี',
      'อัตรา VAT (%) *',
    ]) {
      expect(find.text(label), findsOneWidget, reason: label);
    }

    await tester.scrollUntilVisible(
      find.text('บันทึก'),
      250,
      scrollable: find.byWidgetPredicate(
        (widget) =>
            widget is Scrollable &&
            widget.axisDirection == AxisDirection.down &&
            widget.restorationId != 'editable',
      ),
    );
    await tester.tap(find.text('บันทึก'));
    await tester.pumpAndSettle();
    expect(requests, hasLength(1));
    expect(requests.single.url.pathSegments.last, 'catalog.updateSettings');
    final input = _mutationInput(requests.single);
    final entries = (input['entries'] as List)
        .map((value) => Map<String, dynamic>.from(value as Map))
        .toList();
    expect(entries, hasLength(6));
    expect(
      entries.map((entry) => entry['key']),
      containsAll(const [
        'shop_name',
        'shop_branch',
        'shop_address',
        'shop_phone',
        'tax_id',
        'vat_rate',
      ]),
    );
  });

  testWidgets('document settings open one complete editor', (tester) async {
    await _pumpEditor(
      tester,
      const OperationItem(
        title: 'เอกสารและการพิมพ์',
        subtitle: 'ใบเสร็จ 80 มม. · ใบกำกับ A4',
        entity: OperationEntity.documentConfig,
        record: {
          'receipt_prefix': 'R',
          'tax_invoice_prefix': 'T',
          'receipt_paper_size': '80',
          'tax_invoice_paper_size': 'a4',
          'receipt_silent_print': '0',
        },
      ),
    );

    expect(find.text('เอกสารและการพิมพ์'), findsOneWidget);
    for (final label in const [
      'คำนำหน้าเลขใบเสร็จอย่างย่อ',
      'คำนำหน้าเลขใบกำกับภาษี',
      'ขนาดกระดาษใบเสร็จ *',
      'ขนาดกระดาษใบกำกับภาษีเต็มรูป *',
      'พิมพ์ใบเสร็จอัตโนมัติหลังชำระเงิน',
    ]) {
      expect(find.text(label), findsOneWidget, reason: label);
    }
  });

  testWidgets('membership rates open one complete editor', (tester) async {
    await _pumpEditor(
      tester,
      const OperationItem(
        title: 'สมาชิกและคะแนนสะสม',
        subtitle: '100 บาท = 1 คะแนน',
        entity: OperationEntity.membershipConfig,
        record: {'point_earn_per_baht': '100', 'point_redeem_value': '1'},
      ),
    );

    expect(find.text('สมาชิกและคะแนนสะสม'), findsOneWidget);
    expect(find.text('ยอดซื้อที่ได้รับ 1 คะแนน (บาท) *'), findsOneWidget);
    expect(find.text('มูลค่าแลก 1 คะแนน (บาท) *'), findsOneWidget);
  });

  testWidgets('checkout methods open one complete editor', (tester) async {
    await _pumpEditor(
      tester,
      const OperationItem(
        title: 'ช่องทางชำระเงินหน้า POS',
        subtitle: 'เงินสด · โอนจ่าย / QR',
        entity: OperationEntity.checkoutConfig,
        record: {
          'pay_cash_enabled': '1',
          'pay_qr_enabled': '1',
          'pay_card_enabled': '0',
          'pay_credit_enabled': '1',
        },
      ),
    );

    expect(find.text('ช่องทางชำระเงินหน้า POS'), findsOneWidget);
    for (final label in const [
      'เงินสด',
      'โอนจ่าย / QR',
      'บัตร',
      'เครดิต (ขายเชื่อ)',
    ]) {
      expect(find.text(label), findsOneWidget, reason: label);
    }
  });

  testWidgets('automatic backup opens one complete editor', (tester) async {
    await _pumpEditor(
      tester,
      const OperationItem(
        title: 'สำรองข้อมูลอัตโนมัติ',
        subtitle: 'เวลา 23:30 · เก็บ 7 ชุด',
        entity: OperationEntity.automaticBackupConfig,
        record: {
          'backup_auto_enabled': '1',
          'backup_auto_time': '23:30',
          'backup_auto_keep': '7',
        },
      ),
    );

    expect(find.text('สำรองข้อมูลอัตโนมัติ'), findsOneWidget);
    expect(find.text('เปิดสำรองข้อมูลอัตโนมัติ'), findsOneWidget);
    expect(find.text('เวลาสำรองข้อมูล *'), findsOneWidget);
    expect(find.text('จำนวนชุดสำรองที่เก็บ *'), findsOneWidget);
  });
}

Future<List<http.Request>> _pumpEditor(
  WidgetTester tester,
  OperationItem item,
) async {
  await tester.binding.setSurfaceSize(const Size(390, 844));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final requests = <http.Request>[];
  final repository = OperationsRepository(
    TrpcClient(
      baseUri: Uri.parse('https://example.supabase.co/functions/v1/pos-api'),
      publishableKey: 'sb_publishable_test',
      functionRegion: 'ap-southeast-1',
      accessTokenProvider: () => 'user-jwt',
      httpClient: MockClient((request) async {
        requests.add(request);
        return http.Response(
          jsonEncode({
            'result': {
              'data': {
                'json': {'ok': true},
              },
            },
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      }),
    ),
  );

  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: FilledButton(
              key: const Key('open-setting'),
              onPressed: () => showOperationItemActions(
                context: context,
                item: item,
                staff: _staff(),
                repository: repository,
              ),
              child: const Text('เปิดการตั้งค่า'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.byKey(const Key('open-setting')));
  await tester.pumpAndSettle();
  expect(tester.takeException(), isNull);
  return requests;
}

Map<String, dynamic> _mutationInput(http.Request request) {
  final body = jsonDecode(request.body) as Map<String, dynamic>;
  return Map<String, dynamic>.from(body['json'] as Map);
}

StaffSession _staff() => const StaffSession(
  id: 1,
  name: 'ผู้ดูแลระบบ',
  username: 'admin',
  role: StaffRole.admin,
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
