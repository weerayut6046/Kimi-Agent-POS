import 'package:flutter_test/flutter_test.dart';
import 'package:pumppos/core/config/app_config.dart';

void main() {
  group('AppConfig', () {
    test('builds the POS Edge Function endpoint', () {
      const config = AppConfig(
        supabaseUrl: 'https://example.supabase.co/',
        supabasePublishableKey: 'sb_publishable_test',
        functionRegion: 'ap-northeast-1',
      );

      expect(config.isConfigured, isTrue);
      expect(
        config.posApiUri,
        Uri.parse('https://example.supabase.co/functions/v1/pos-api'),
      );
    });

    test('rejects missing public configuration', () {
      const config = AppConfig(
        supabaseUrl: '',
        supabasePublishableKey: '',
        functionRegion: 'ap-northeast-1',
      );

      expect(config.isConfigured, isFalse);
      expect(() => config.posApiUri, throwsStateError);
    });
  });
}
