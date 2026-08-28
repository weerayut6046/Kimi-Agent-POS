import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:pumppos/core/network/trpc_client.dart';
import 'package:pumppos/features/shifts/data/shift_repository.dart';

void main() {
  test('loads the active shift and branch nozzles', () async {
    final repository = ShiftRepository(
      _client((request) async {
        return switch (request.url.pathSegments.last) {
          'pos.currentShift' => _response({
            'id': 14,
            'staffName': 'สมชาย',
            'openedAt': '2026-08-28T01:00:00.000Z',
            'openingFloat': 500,
            'cash': {'expectedCash': 1250},
            'readings': [
              {
                'nozzleId': 7,
                'openMeter': 1000,
                'openMoney': 37000,
                'pricePerLiter': 37,
                'priceChangedDuringShift': false,
                'nozzle': {'label': 'หัว 1'},
                'pump': {'name': 'ตู้ 1'},
                'product': {'name': 'แก๊สโซฮอล์ 95'},
              },
            ],
          }),
          'catalog.listPumps' => _response([
            {
              'id': 1,
              'name': 'ตู้ 1',
              'nozzles': [
                {
                  'id': 7,
                  'label': 'หัว 1',
                  'currentMeter': 1000,
                  'currentMoney': 37000,
                  'active': true,
                  'product': {'name': 'แก๊สโซฮอล์ 95'},
                },
              ],
            },
          ]),
          _ => http.Response('Not found', 404),
        };
      }),
    );

    final data = await repository.load(3);

    expect(data.currentShift?.id, 14);
    expect(data.currentShift?.expectedCash, 1250);
    expect(data.currentShift?.readings.single.label, 'หัว 1');
    expect(data.nozzles.single.pumpName, 'ตู้ 1');
  });

  test('sends rounded readings when closing a shift', () async {
    late Map<String, dynamic> requestBody;
    final repository = ShiftRepository(
      _client((request) async {
        requestBody = jsonDecode(request.body) as Map<String, dynamic>;
        return _response({'ok': true});
      }),
    );

    await repository.closeShift(
      branchId: 3,
      shiftId: 14,
      readings: const [
        ShiftClosingReading(
          nozzleId: 7,
          closeMeter: 1012.3456,
          closeMoney: 37456.789,
        ),
      ],
      countedCash: 1249.995,
      transferAmount: 200,
      cashCounts: const {'1000': 1, '100': 2, '20': 2, '5': 2},
      note: 'ตรวจแล้ว',
    );

    final input = requestBody['json'] as Map<String, dynamic>;
    final readings = input['readings'] as List<dynamic>;
    expect(readings.single, {
      'nozzleId': 7,
      'closeMeter': 1012.346,
      'closeMoney': 37456.79,
    });
    expect(input['countedCash'], 1250);
    expect(input['cashCounts'], {'1000': 1, '100': 2, '20': 2, '5': 2});
    expect(input['lubricantItems'], isEmpty);
  });
}

TrpcClient _client(MockClientHandler handler) {
  return TrpcClient(
    baseUri: Uri.parse('https://example.supabase.co/functions/v1/pos-api'),
    publishableKey: 'sb_publishable_test',
    functionRegion: 'ap-northeast-1',
    accessTokenProvider: () => 'access-token',
    httpClient: MockClient(handler),
  );
}

http.Response _response(Object? data) {
  return http.Response(
    jsonEncode({
      'result': {
        'data': {'json': data},
      },
    }),
    200,
    headers: {'content-type': 'application/json'},
  );
}
