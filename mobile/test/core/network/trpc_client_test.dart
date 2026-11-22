import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:pumppos/core/network/trpc_client.dart';

void main() {
  test(
    'query sends Supabase and branch headers and decodes tRPC data',
    () async {
      late http.Request capturedRequest;
      final client = TrpcClient(
        baseUri: Uri.parse('https://example.supabase.co/functions/v1/pos-api'),
        publishableKey: 'sb_publishable_test',
        functionRegion: 'ap-northeast-1',
        accessTokenProvider: () => 'access-token',
        httpClient: MockClient((request) async {
          capturedRequest = request;
          return http.Response(
            jsonEncode({
              'result': {
                'data': {
                  'json': {'todayTotal': 1250},
                },
              },
            }),
            200,
            headers: {'content-type': 'application/json'},
          );
        }),
      );

      final result = await client.query('pos.dashboard', branchId: 7);

      expect(capturedRequest.url.path, '/functions/v1/pos-api/pos.dashboard');
      expect(capturedRequest.headers['authorization'], 'Bearer access-token');
      expect(capturedRequest.headers['apikey'], 'sb_publishable_test');
      expect(capturedRequest.headers['x-region'], 'ap-northeast-1');
      expect(capturedRequest.headers['x-branch-id'], '7');
      expect(result, {'todayTotal': 1250});
    },
  );

  test('surfaces the tRPC error message', () async {
    final client = TrpcClient(
      baseUri: Uri.parse('https://example.supabase.co/functions/v1/pos-api'),
      publishableKey: 'sb_publishable_test',
      functionRegion: 'ap-northeast-1',
      accessTokenProvider: () => 'access-token',
      httpClient: MockClient(
        (_) async => http.Response(
          jsonEncode({
            'error': {
              'json': {'message': 'Access denied'},
            },
          }),
          403,
        ),
      ),
    );

    expect(
      () => client.query('pos.dashboard'),
      throwsA(
        isA<TrpcException>()
            .having((error) => error.statusCode, 'statusCode', 403)
            .having((error) => error.message, 'message', 'Access denied'),
      ),
    );
  });

  test('requires an authenticated session before making a request', () async {
    var wasCalled = false;
    final client = TrpcClient(
      baseUri: Uri.parse('https://example.supabase.co/functions/v1/pos-api'),
      publishableKey: 'sb_publishable_test',
      functionRegion: 'ap-northeast-1',
      accessTokenProvider: () => null,
      httpClient: MockClient((_) async {
        wasCalled = true;
        return http.Response('{}', 200);
      }),
    );

    expect(
      () => client.query('auth.currentStaff'),
      throwsA(isA<TrpcException>()),
    );
    expect(wasCalled, isFalse);
  });
}
