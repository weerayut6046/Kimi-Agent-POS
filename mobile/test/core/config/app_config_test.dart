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
      expect(
        config.customerLoyaltyUri,
        Uri.parse('https://kimi-agent-pos.vercel.app/loyalty'),
      );
    });

    test(
      'builds the customer loyalty URL from a configured public web URL',
      () {
        const config = AppConfig(
          supabaseUrl: 'https://example.supabase.co',
          supabasePublishableKey: 'sb_publishable_test',
          functionRegion: 'ap-northeast-1',
          publicWebUrl: 'https://pos.example.com/',
        );

        expect(
          config.customerLoyaltyUri,
          Uri.parse('https://pos.example.com/loyalty'),
        );
      },
    );

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
