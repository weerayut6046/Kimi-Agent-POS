class AppConfig {
  static const defaultPublicWebUrl = 'https://kimi-agent-pos.vercel.app';

  const AppConfig({
    required this.supabaseUrl,
    required this.supabasePublishableKey,
    required this.functionRegion,
    this.publicWebUrl = defaultPublicWebUrl,
  });

  const AppConfig.fromEnvironment()
    : supabaseUrl = const String.fromEnvironment('SUPABASE_URL'),
      supabasePublishableKey = const String.fromEnvironment(
        'SUPABASE_PUBLISHABLE_KEY',
      ),
      functionRegion = const String.fromEnvironment(
        'SUPABASE_FUNCTION_REGION',
        defaultValue: 'ap-northeast-1',
      ),
      publicWebUrl = const String.fromEnvironment(
        'PUBLIC_WEB_URL',
        defaultValue: defaultPublicWebUrl,
      );

  final String supabaseUrl;
  final String supabasePublishableKey;
  final String functionRegion;
  final String publicWebUrl;

  bool get isConfigured =>
      Uri.tryParse(supabaseUrl)?.hasScheme == true &&
      supabasePublishableKey.trim().isNotEmpty;

  Uri get posApiUri {
    if (!isConfigured) {
      throw StateError('Supabase mobile configuration is missing');
    }
    return Uri.parse(
      '${supabaseUrl.replaceFirst(RegExp(r'/+$'), '')}/functions/v1/pos-api',
    );
  }

  Uri get customerLoyaltyUri {
    final base = publicWebUrl.trim().replaceFirst(RegExp(r'/+$'), '');
    final uri = Uri.tryParse('$base/loyalty');
    if (uri == null ||
        (uri.scheme != 'https' && uri.scheme != 'http') ||
        uri.host.isEmpty) {
      throw StateError('PumpPOS public web URL is invalid');
    }
    return uri;
  }
}
