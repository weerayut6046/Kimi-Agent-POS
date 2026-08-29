import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pumppos/features/operations/presentation/customer_loyalty_qr_sheet.dart';
import 'package:qr_flutter/qr_flutter.dart';

void main() {
  testWidgets('shows a customer loyalty QR with share and print actions', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: FilledButton(
                onPressed: () => showCustomerLoyaltyQrSheet(
                  context: context,
                  loyaltyUri: Uri.parse('https://pos.example.com/loyalty'),
                  stationName: 'สถานีทดสอบ',
                ),
                child: const Text('เปิด QR'),
              ),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('เปิด QR'));
    await tester.pumpAndSettle();

    expect(find.text('QR ตรวจสอบแต้มสมาชิก'), findsOneWidget);
    expect(find.text('สถานีทดสอบ'), findsOneWidget);
    expect(find.text('สแกนเช็กแต้มสะสม'), findsOneWidget);
    expect(find.byType(QrImageView), findsOneWidget);
    expect(
      find.byKey(const Key('share-customer-loyalty-link')),
      findsOneWidget,
    );
    expect(find.byKey(const Key('print-customer-loyalty-qr')), findsOneWidget);
  });
}
