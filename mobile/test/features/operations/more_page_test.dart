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
import 'package:pumppos/features/shell/presentation/app_shell.dart';

void main() {
  setUpAll(() => initializeDateFormatting('th_TH'));

  testWidgets('additional menu opens the native stock screen', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final repository = OperationsRepository(
      TrpcClient(
        baseUri: Uri.parse('https://example.supabase.co/functions/v1/pos-api'),
        publishableKey: 'sb_publishable_test',
        functionRegion: 'ap-southeast-1',
        accessTokenProvider: () => 'user-jwt',
        httpClient: MockClient((request) async {
          final procedure = request.url.pathSegments.last;
          final payload = switch (procedure) {
            'catalog.listTanks' => <Object?>[
              <String, Object?>{
                'id': 1,
                'name': 'ถังหลัก',
                'currentLiters': 4200,
                'capacityLiters': 10000,
                'lowAlertAt': 1000,
                'percent': 42,
                'isLow': false,
                'product': <String, Object?>{'name': 'Gasohol 95'},
              },
            ],
            'catalog.listProducts' => <Object?>[
              <String, Object?>{
                'id': 1,
                'name': 'Gasohol 95',
                'code': 'GSH95',
                'category': 'fuel',
                'unit': 'ลิตร',
                'price': 35.5,
                'stockQty': 0,
                'lowStockAt': 0,
                'active': true,
              },
            ],
            'catalog.lowStockAlerts' => <String, Object?>{
              'lowTanks': <Object?>[],
              'lowProducts': <Object?>[],
              'count': 0,
            },
            'catalog.listRefills' => <Object?>[],
            'catalog.listTankReadings' => <Object?>[],
            _ => throw StateError('Unexpected procedure $procedure'),
          };
          return http.Response(
            jsonEncode({
              'result': {
                'data': {'json': payload},
              },
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
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
          home: MorePage(staff: _staff()),
        ),
      ),
    );

    expect(find.text('17 เมนู'), findsOneWidget);
    final stockMenu = find.byKey(const ValueKey('more-stock'));
    await tester.ensureVisible(stockMenu);
    await tester.tap(
      find.descendant(of: stockMenu, matching: find.byType(InkWell)),
    );
    await tester.pumpAndSettle();

    expect(find.byType(OperationsPage), findsOneWidget);
    expect(find.text('สินค้าใช้งาน'), findsOneWidget);
    expect(find.textContaining('Gasohol 95'), findsWidgets);
    expect(find.text('ถังหลัก'), findsOneWidget);
    expect(find.byKey(const ValueKey('tank-visual-1')), findsOneWidget);
  });
}

StaffSession _staff() => StaffSession(
  id: 1,
  name: 'ผู้ดูแลระบบ',
  username: 'admin',
  role: StaffRole.admin,
  menuPermissions: OperationsModule.values
      .map((module) => module.permission)
      .toSet(),
  branch: const BranchSummary(
    id: 7,
    code: 'BKK-01',
    name: 'สถานีทดสอบ',
    address: '',
    phone: '',
    taxId: '',
    active: true,
  ),
  branches: const [],
);
