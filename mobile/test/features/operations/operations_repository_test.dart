import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:pumppos/core/network/trpc_client.dart';
import 'package:pumppos/features/operations/data/operations_repository.dart';
import 'package:pumppos/features/operations/domain/operations_models.dart';

void main() {
  setUpAll(() => initializeDateFormatting('th_TH'));

  test(
    'every additional menu loads a valid snapshot from its Edge APIs',
    () async {
      final called = <String>[];
      final client = MockClient((request) async {
        final procedure = request.url.pathSegments.last;
        called.add(procedure);
        return http.Response(
          jsonEncode({
            'result': {
              'data': {'json': _payload(procedure)},
            },
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final repository = OperationsRepository(
        TrpcClient(
          baseUri: Uri.parse(
            'https://example.supabase.co/functions/v1/pos-api',
          ),
          publishableKey: 'sb_publishable_test',
          functionRegion: 'ap-southeast-1',
          accessTokenProvider: () => 'user-jwt',
          httpClient: client,
        ),
      );

      for (final module in OperationsModule.values) {
        final snapshot = await repository.load(
          module: module,
          branchId: 7,
          date: DateTime(2026, 8, 28),
        );
        expect(snapshot.groups, isNotEmpty, reason: module.name);
        expect(snapshot.metrics, isNotEmpty, reason: module.name);
        if (module == OperationsModule.settings) {
          final items = snapshot.groups.expand((group) => group.items).toList();
          for (final entity in const <OperationEntity>[
            OperationEntity.shopProfileConfig,
            OperationEntity.documentConfig,
            OperationEntity.membershipConfig,
            OperationEntity.checkoutConfig,
            OperationEntity.perLiterPromotionConfig,
            OperationEntity.billPromotionConfig,
            OperationEntity.automaticBackupConfig,
          ]) {
            expect(
              items.where((item) => item.entity == entity).length,
              1,
              reason: entity.name,
            );
          }
          const groupedKeys = <String>{
            'shop_name',
            'shop_branch',
            'shop_address',
            'shop_phone',
            'tax_id',
            'vat_rate',
            'receipt_prefix',
            'tax_invoice_prefix',
            'receipt_paper_size',
            'tax_invoice_paper_size',
            'receipt_silent_print',
            'point_earn_per_baht',
            'point_redeem_value',
            'pay_cash_enabled',
            'pay_qr_enabled',
            'pay_card_enabled',
            'pay_credit_enabled',
            'backup_auto_enabled',
            'backup_auto_time',
            'backup_auto_keep',
          };
          expect(
            items.where(
              (item) =>
                  item.entity == OperationEntity.setting &&
                  (groupedKeys.contains('${item.record['key']}') ||
                      '${item.record['key']}'.contains('promotion')),
            ),
            isEmpty,
          );
        }
      }

      expect(
        called,
        containsAll(<String>[
          'workforce.myScheduleList',
          'catalog.listTanks',
          'membership.listMembers',
          'customers.list',
          'credit.summary',
          'pos.salesHistory',
          'expenses.list',
          'reports.daily',
          'taxInvoice.list',
          'audit.list',
          'security.overview',
          'catalog.getSettings',
        ]),
      );
    },
  );

  test(
    'non-admin workforce requests and renders only the signed-in staff data',
    () async {
      final called = <String>[];
      final client = MockClient((request) async {
        final procedure = request.url.pathSegments.last;
        called.add(procedure);
        final payload = switch (procedure) {
          'workforce.myProfile' => <String, Object?>{
            'staffId': 3,
            'username': 'cashier',
            'name': 'สมชาย ของฉัน',
            'role': 'manager',
            'active': true,
            'position': 'หัวหน้ากะ',
            'salaryType': 'monthly',
            'baseRate': 15000,
            'overtimeRate': 100,
            'hireDate': '2026-01-01',
          },
          'workforce.myScheduleList' => <Object?>[
            <String, Object?>{
              'id': 41,
              'staffId': 3,
              'staffName': 'สมชาย ของฉัน',
              'staffRole': 'manager',
              'workDate': '2026-08-28',
              'shiftTemplateId': 2,
              'shiftName': 'กะเช้า',
              'startTime': '06:00',
              'endTime': '14:00',
              'breakMinutes': 30,
              'status': 'scheduled',
              'cashAdvance': 0,
              'note': null,
            },
          ],
          'workforce.myPayroll' => <String, Object?>{
            'id': 51,
            'staffId': 3,
            'payrollMonth': '2026-08',
            'baseAmount': 15000,
            'overtimeAmount': 500,
            'bonus': 0,
            'absenceDeduction': 0,
            'advanceDeduction': 0,
            'deduction': 0,
            'netAmount': 15500,
            'status': 'draft',
          },
          _ => throw StateError('Unexpected workforce procedure $procedure'),
        };
        return http.Response(
          jsonEncode({
            'result': {
              'data': {'json': payload},
            },
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final repository = OperationsRepository(
        TrpcClient(
          baseUri: Uri.parse(
            'https://example.supabase.co/functions/v1/pos-api',
          ),
          publishableKey: 'sb_publishable_test',
          functionRegion: 'ap-southeast-1',
          accessTokenProvider: () => 'manager-user-jwt',
          httpClient: client,
        ),
      );

      final snapshot = await repository.load(
        module: OperationsModule.workforce,
        branchId: 7,
        date: DateTime(2026, 8, 28),
        role: 'manager',
      );

      expect(called, <String>[
        'workforce.myProfile',
        'workforce.myScheduleList',
        'workforce.myPayroll',
      ]);
      expect(called, isNot(contains('auth.listStaff')));
      expect(called, isNot(contains('workforce.scheduleList')));
      final items = snapshot.groups.expand((group) => group.items).toList();
      expect(
        items.where((item) => item.entity == OperationEntity.staff),
        hasLength(1),
      );
      expect(
        items.where((item) => item.entity == OperationEntity.schedule),
        hasLength(1),
      );
      expect(
        items
            .where((item) => item.record.containsKey('staffId'))
            .every((item) => item.record['staffId'] == 3),
        isTrue,
      );
      expect(items.any((item) => item.title.contains('สมชาย ของฉัน')), isTrue);
    },
  );

  test(
    'staff mutations use the authenticated Admin Edge API contract',
    () async {
      final requests = <http.Request>[];
      final client = MockClient((request) async {
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
      });
      final repository = OperationsRepository(
        TrpcClient(
          baseUri: Uri.parse(
            'https://example.supabase.co/functions/v1/pos-api',
          ),
          publishableKey: 'sb_publishable_test',
          functionRegion: 'ap-southeast-1',
          accessTokenProvider: () => 'admin-user-jwt',
          httpClient: client,
        ),
      );

      await repository.createStaff(
        branchId: 7,
        name: 'สมชาย ใจดี',
        username: 'Somchai.01',
        password: 'ValidPass1',
        role: 'cashier',
        accessGroupId: 3,
        menuPermissions: const {'dashboard', 'pos'},
        branchIds: const [7, 8],
      );
      await repository.updateStaff(
        branchId: 7,
        staff: const StaffRecordData(
          id: 22,
          name: 'สมชาย ใจดี',
          username: 'somchai.01',
          role: 'manager',
          active: false,
          accessGroupId: 4,
          branchIds: <int>[7, 8],
          menuPermissions: <String>{'dashboard', 'reports'},
        ),
        password: 'ValidEdit2',
      );
      await repository.deleteStaff(branchId: 7, staffId: 22);

      expect(requests.map((request) => request.url.pathSegments.last), [
        'auth.createStaff',
        'auth.updateStaff',
        'auth.deleteStaff',
      ]);
      expect(requests.every((request) => request.method == 'POST'), isTrue);
      expect(
        requests.every((request) => request.headers['x-branch-id'] == '7'),
        isTrue,
      );
      expect(
        requests.every(
          (request) =>
              request.headers['authorization'] == 'Bearer admin-user-jwt',
        ),
        isTrue,
      );

      final create = _mutationInput(requests[0]);
      expect(create['username'], 'somchai.01');
      expect(create['password'], 'ValidPass1');
      expect(create['role'], 'cashier');
      expect(create['branchIds'], [7, 8]);
      expect(create['accessGroupId'], 3);
      expect(create['menuPermissions'], containsAll(['dashboard', 'pos']));

      final update = _mutationInput(requests[1]);
      expect(update, containsPair('id', 22));
      expect(update, containsPair('role', 'manager'));
      expect(update, containsPair('active', false));
      expect(update, containsPair('password', 'ValidEdit2'));
      expect(update, containsPair('accessGroupId', 4));
      expect(update['branchIds'], [7, 8]);
      expect(update['menuPermissions'], containsAll(['dashboard', 'reports']));

      expect(_mutationInput(requests[2]), {'id': 22});
    },
  );
}

Map<String, dynamic> _mutationInput(http.Request request) {
  final body = jsonDecode(request.body) as Map<String, dynamic>;
  return Map<String, dynamic>.from(body['json'] as Map);
}

Object? _payload(String procedure) => switch (procedure) {
  'auth.listStaff' => <Object?>[],
  'auth.listStaffAccess' => <Object?>[],
  'workforce.scheduleList' => <Object?>[],
  'workforce.myProfile' => <String, Object?>{},
  'workforce.myScheduleList' => <Object?>[],
  'workforce.myPayroll' => <String, Object?>{},
  'catalog.listTanks' => <Object?>[],
  'catalog.listProducts' => <Object?>[],
  'catalog.lowStockAlerts' => <String, Object?>{
    'lowTanks': <Object?>[],
    'lowProducts': <Object?>[],
    'count': 0,
  },
  'catalog.listRefills' => <Object?>[],
  'catalog.listTankReadings' => <Object?>[],
  'stockCount.listSessions' => <Object?>[],
  'membership.listMembers' => <Object?>[],
  'membership.listRewards' => <Object?>[],
  'membership.redemptionHistory' => <Object?>[],
  'membership.listCardBatches' => <Object?>[],
  'customers.list' => <Object?>[],
  'credit.summary' => <Object?>[],
  'pos.salesHistory' => <Object?>[],
  'expenses.list' => <String, Object?>{'items': <Object?>[], 'total': 0},
  'reports.daily' => <String, Object?>{
    'totalSales': 0,
    'billCount': 0,
    'totalLiters': 0,
    'expectedCash': 0,
    'byMethod': <String, Object?>{},
    'fuelLiters': <Object?>[],
    'shifts': <Object?>[],
    'expenses': <String, Object?>{'total': 0},
    'debtPayments': <String, Object?>{'total': 0},
  },
  'reports.fuelStockSummary' => <String, Object?>{
    'periods': <Object?>[],
    'currentProducts': <Object?>[],
  },
  'reports.tankReconciliation' => <String, Object?>{'tanks': <Object?>[]},
  'taxInvoice.list' => <Object?>[],
  'audit.list' => <String, Object?>{
    'rows': <Object?>[],
    'actions': <Object?>[],
  },
  'security.overview' => <String, Object?>{
    'criticalNew': 0,
    'warningNew': 0,
    'infoNew': 0,
    'acknowledged': 0,
    'last24h': 0,
    'lastScanAt': null,
  },
  'security.events' => <String, Object?>{
    'rows': <Object?>[],
    'truncated': false,
  },
  'security.reports' => <Object?>[],
  'catalog.getSettings' => <String, Object?>{
    'shop_name': 'PumpPOS Test',
    'shop_branch': 'สาขาหลัก',
    'shop_address': 'กรุงเทพฯ',
    'shop_phone': '021234567',
    'tax_id': '0100000000001',
    'vat_enabled': 'true',
    'vat_rate': '7',
    'receipt_prefix': 'R',
    'tax_invoice_prefix': 'T',
    'receipt_paper_size': '80',
    'tax_invoice_paper_size': 'a4',
    'receipt_silent_print': '0',
    'point_earn_per_baht': '100',
    'point_redeem_value': '1',
    'pay_cash_enabled': '1',
    'pay_qr_enabled': '1',
    'pay_card_enabled': '0',
    'pay_credit_enabled': '1',
    'backup_auto_enabled': '1',
    'backup_auto_time': '23:30',
    'backup_auto_keep': '7',
    'promotion_enabled': '1',
    'promotion_name': 'ลดต่อลิตร',
    'promotion_discount': '0.50',
    'promotion_start_date': '2026-08-01',
    'promotion_end_date': '2026-08-31',
    'bill_promotion_enabled': '0',
    'bill_promotion_name': 'ลดท้ายบิล',
    'bill_promotion_min_fuel_spend': '1000',
    'bill_promotion_discount': '20',
    'bill_promotion_start_date': '2026-08-01',
    'bill_promotion_end_date': '2026-08-31',
  },
  _ => throw StateError('Unhandled procedure $procedure'),
};
