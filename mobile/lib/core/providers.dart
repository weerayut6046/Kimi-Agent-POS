import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import 'config/app_config.dart';
import 'network/trpc_client.dart';

final appConfigProvider = Provider<AppConfig>(
  (ref) => throw StateError('AppConfig must be overridden at startup'),
);

final httpClientProvider = Provider<http.Client>((ref) {
  final client = http.Client();
  ref.onDispose(client.close);
  return client;
});

final trpcClientProvider = Provider<TrpcClient>((ref) {
  final config = ref.watch(appConfigProvider);
  return TrpcClient(
    baseUri: config.posApiUri,
    publishableKey: config.supabasePublishableKey,
    functionRegion: config.functionRegion,
    accessTokenProvider: () =>
        Supabase.instance.client.auth.currentSession?.accessToken,
    httpClient: ref.watch(httpClientProvider),
  );
});
