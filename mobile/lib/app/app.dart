import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import '../core/config/app_config.dart';
import '../core/theme/app_theme.dart';
import '../features/auth/presentation/auth_gate.dart';
import '../features/setup/presentation/config_missing_page.dart';
import '../shared/widgets/network_status_banner.dart';

class PumpPosApp extends StatelessWidget {
  const PumpPosApp({required this.config, super.key});

  final AppConfig config;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PumpPOS',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      locale: const Locale('th'),
      supportedLocales: const [Locale('th'), Locale('en')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      builder: (context, child) => NetworkStatusBanner(child: child!),
      home: config.isConfigured ? const AuthGate() : const ConfigMissingPage(),
    );
  }
}
