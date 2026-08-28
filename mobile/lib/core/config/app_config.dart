class AppConfig {
  const AppConfig({
    required this.supabaseUrl,
    required this.supabasePublishableKey,
    required this.functionRegion,
  });

  const AppConfig.fromEnvironment()
    : supabaseUrl = const String.fromEnvironment('SUPABASE_URL'),
      supabasePublishableKey = const String.fromEnvironment(
        'SUPABASE_PUBLISHABLE_KEY',
      ),
      functionRegion = const String.fromEnvironment(
        'SUPABASE_FUNCTION_REGION',
        defaultValue: 'ap-northeast-1',
      );

  final String supabaseUrl;
  final String supabasePublishableKey;
  final String functionRegion;

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
}
