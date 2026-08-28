import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app/app.dart';
import 'core/config/app_config.dart';
import 'core/providers.dart';
import 'core/security/secure_supabase_storage.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('th_TH');

  const config = AppConfig.fromEnvironment();
  if (config.isConfigured) {
    await Supabase.initialize(
      url: config.supabaseUrl,
      publishableKey: config.supabasePublishableKey,
      authOptions: FlutterAuthClientOptions(
        localStorage: SecureSupabaseStorage(),
        autoRefreshToken: true,
        detectSessionInUri: false,
      ),
    );
  }

  runApp(
    ProviderScope(
      overrides: [appConfigProvider.overrideWithValue(config)],
      child: PumpPosApp(config: config),
    ),
  );
}
