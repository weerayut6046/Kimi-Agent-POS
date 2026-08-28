import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:pumppos/core/network/trpc_client.dart';
import 'package:pumppos/features/auth/domain/staff_session.dart';
import 'package:pumppos/features/operations/application/operations_provider.dart';
import 'package:pumppos/features/operations/data/operations_repository.dart';
import 'package:pumppos/features/operations/domain/operations_models.dart';
import 'package:pumppos/features/operations/presentation/operations_page.dart';

void main() {
  setUpAll(() => initializeDateFormatting('th_TH'));

  testWidgets('Admin can create, edit, and delete staff', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final staffRows = <Map<String, Object?>>[
      <String, Object?>{
        'id': 1,
        'name': 'ผู้ดูแลระบบ',
        'username': 'admin',
        'role': 'admin',
        'active': true,
        'createdAt': '2026-08-01T08:00:00.000Z',
      },
      <String, Object?>{
        'id': 2,
        'name': 'พนักงานเดิม',
        'username': 'cashier01',
        'role': 'cashier',
        'active': true,
        'createdAt': '2026-08-02T08:00:00.000Z',
      },
    ];
    final mutations = <String>[];
    final client = MockClient((request) async {
      final procedure = request.url.pathSegments.last;
      Object? payload;
      if (request.method == 'GET') {
        payload = switch (procedure) {
          'auth.listStaffAccess' => staffRows,
          'auth.listAllBranches' => <Object?>[
            <String, Object?>{
              'id': 7,
              'code': 'BKK-01',
              'name': 'สถานีทดสอบ',
              'active': true,
            },
          ],
          'auth.listAccessGroups' => <Object?>[],
          'workforce.scheduleList' => <Object?>[],
          'workforce.listTemplates' => <Object?>[],
          'workforce.employeeProfiles' => <Object?>[],
          'workforce.payrollList' => <Object?>[],
          _ => throw StateError('Unexpected query $procedure'),
        };
      } else {
        mutations.add(procedure);
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        final input = Map<String, dynamic>.from(body['json'] as Map);
        switch (procedure) {
          case 'auth.createStaff':
            staffRows.add(<String, Object?>{
              'id': 3,
              'name': input['name'],
              'username': input['username'],
              'role': input['role'],
              'active': true,
              'branchIds': input['branchIds'],
              'menuPermissions': input['menuPermissions'],
              'createdAt': '2026-08-28T08:00:00.000Z',
            });
          case 'auth.updateStaff':
            final row = staffRows.firstWhere(
              (item) => item['id'] == input['id'],
            );
            row.addAll(<String, Object?>{
              'name': input['name'],
              'username': input['username'],
              'role': input['role'],
              'active': input['active'],
              'branchIds': input['branchIds'],
              'menuPermissions': input['menuPermissions'],
            });
          case 'auth.deleteStaff':
            staffRows.removeWhere((item) => item['id'] == input['id']);
          default:
            throw StateError('Unexpected mutation $procedure');
        }
        payload = <String, Object?>{'ok': true};
      }
      return http.Response(
        jsonEncode({
          'result': {
            'data': {'json': payload},
          },
        }),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    final repository = OperationsRepository(
      TrpcClient(
        baseUri: Uri.parse('https://example.supabase.co/functions/v1/pos-api'),
        publishableKey: 'sb_publishable_test',
        functionRegion: 'ap-southeast-1',
        accessTokenProvider: () => 'admin-user-jwt',
        httpClient: client,
      ),
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [operationsRepositoryProvider.overrideWithValue(repository)],
        child: MaterialApp(
          locale: const Locale('th', 'TH'),
          supportedLocales: const [Locale('th', 'TH')],
          localizationsDelegates: const [
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: OperationsPage(
            module: OperationsModule.workforce,
            staff: _admin(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('add-staff')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('staff-name')), 'มาลี ใหม่');
    await tester.enterText(find.byKey(const Key('staff-username')), 'Mali.01');
    await tester.enterText(
      find.byKey(const Key('staff-password')),
      'ValidPass1',
    );
    await tester.tap(find.byKey(const Key('save-staff')));
    await tester.pumpAndSettle();

    expect(mutations, contains('auth.createStaff'));
    expect(staffRows.any((row) => row['username'] == 'mali.01'), isTrue);

    await tester.enterText(
      find.byKey(const Key('operations-search')),
      'mali.01',
    );
    await tester.pump();
    await tester.ensureVisible(find.byKey(const ValueKey('staff-actions-3')));
    await tester.tap(find.byKey(const ValueKey('staff-actions-3')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('แก้ไขพนักงาน'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('staff-name')), 'มาลี แก้ไข');
    await tester.tap(find.byKey(const Key('save-staff')));
    await tester.pumpAndSettle();

    expect(mutations, contains('auth.updateStaff'));
    expect(staffRows.firstWhere((row) => row['id'] == 3)['name'], 'มาลี แก้ไข');

    await tester.ensureVisible(find.byKey(const ValueKey('staff-actions-3')));
    await tester.tap(find.byKey(const ValueKey('staff-actions-3')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ลบพนักงาน'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'ลบพนักงาน'));
    await tester.pumpAndSettle();

    expect(mutations, contains('auth.deleteStaff'));
    expect(staffRows.any((row) => row['id'] == 3), isFalse);
  });
}

StaffSession _admin() => const StaffSession(
  id: 1,
  name: 'ผู้ดูแลระบบ',
  username: 'admin',
  role: StaffRole.admin,
  menuPermissions: {'workforce'},
  branch: BranchSummary(
    id: 7,
    code: 'BKK-01',
    name: 'สถานีทดสอบ',
    address: '',
    phone: '',
    taxId: '',
    active: true,
  ),
  branches: [],
);
