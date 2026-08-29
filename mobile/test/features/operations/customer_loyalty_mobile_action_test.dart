import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:pumppos/core/config/app_config.dart';
import 'package:pumppos/core/network/trpc_client.dart';
import 'package:pumppos/core/providers.dart';
import 'package:pumppos/features/auth/domain/staff_session.dart';
import 'package:pumppos/features/operations/application/operations_provider.dart';
import 'package:pumppos/features/operations/data/operations_repository.dart';
import 'package:pumppos/features/operations/domain/operations_models.dart';
import 'package:pumppos/features/operations/presentation/operations_page.dart';

void main() {
  testWidgets('members page opens the customer loyalty QR from the app bar', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final repository = OperationsRepository(
      TrpcClient(
        baseUri: Uri.parse('https://example.supabase.co/functions/v1/pos-api'),
        publishableKey: 'sb_publishable_test',
        functionRegion: 'ap-northeast-1',
        accessTokenProvider: () => 'user-jwt',
        httpClient: MockClient((request) async {
          final procedure = request.url.pathSegments.last;
          if (!const {
            'membership.listMembers',
            'membership.listRewards',
            'membership.redemptionHistory',
          }.contains(procedure)) {
            throw StateError('Unexpected procedure $procedure');
          }
          return http.Response(
            jsonEncode({
              'result': {
                'data': {'json': <Object?>[]},
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
        overrides: [
          appConfigProvider.overrideWithValue(
            const AppConfig(
              supabaseUrl: 'https://example.supabase.co',
              supabasePublishableKey: 'sb_publishable_test',
              functionRegion: 'ap-northeast-1',
              publicWebUrl: 'https://pos.example.com',
            ),
          ),
          operationsRepositoryProvider.overrideWithValue(repository),
        ],
        child: MaterialApp(
          home: OperationsPage(
            module: OperationsModule.members,
            staff: _staff(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final action = find.byKey(const Key('customer-loyalty-qr-action'));
    expect(action, findsOneWidget);
    await tester.tap(action);
    await tester.pumpAndSettle();

    expect(find.text('QR ตรวจสอบแต้มสมาชิก'), findsOneWidget);
    expect(find.text('https://pos.example.com/loyalty'), findsOneWidget);
    expect(find.byKey(const Key('customer-loyalty-qr')), findsOneWidget);
  });
}

StaffSession _staff() => const StaffSession(
  id: 1,
  name: 'ผู้ดูแลระบบ',
  username: 'admin',
  role: StaffRole.admin,
  menuPermissions: {'members'},
  branch: BranchSummary(
    id: 1,
    code: 'MAIN',
    name: 'สถานีทดสอบ',
    address: '',
    phone: '',
    taxId: '',
    active: true,
  ),
  branches: [],
);
