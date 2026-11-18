import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pumppos/features/pos/domain/pos_cart.dart';
import 'package:pumppos/features/pos/domain/pos_models.dart';
import 'package:pumppos/features/pos/domain/promotion.dart';
import 'package:pumppos/features/pos/presentation/pos_draft_receipt.dart';

void main() {
  testWidgets('shows and updates the exact draft total on a phone', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    var cart = const PosCart().add(_fuel, 500 / _fuel.price);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Padding(
            padding: const EdgeInsets.all(16),
            child: StatefulBuilder(
              builder: (context, setState) => PosDraftReceipt(
                cart: cart,
                promotion: PromotionSummary.calculate(
                  _settings,
                  cart,
                  now: DateTime.utc(2026, 11, 15),
                ),
                onQuantityChanged: (id, qty) =>
                    setState(() => cart = cart.setQuantity(id, qty)),
                onRemove: (id) => setState(() => cart = cart.remove(id)),
              ),
            ),
          ),
        ),
      ),
    );

    expect(find.text('บิลร่าง'), findsOneWidget);
    expect(find.text('รอชำระ'), findsOneWidget);
    expect(find.text('13.333 ลิตร'), findsOneWidget);
    expect(find.text('฿500.00'), findsNWidgets(2));
    expect(find.text('−฿5.00'), findsOneWidget);
    expect(find.text('฿495.00'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.add_rounded));
    await tester.pump();
    expect(find.text('฿532.50'), findsOneWidget);

    await tester.tap(find.byTooltip('นำออก'));
    await tester.pump();
    expect(find.text('รอชำระ'), findsNothing);
    expect(find.text('฿0.00'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

const _fuel = PosProduct(
  id: 1,
  code: 'GSH95',
  name: 'แก๊สโซฮอล์ 95',
  category: ProductCategory.fuel,
  unit: 'ลิตร',
  price: 37.5,
  stockQty: 0,
  active: true,
);

const _settings = {
  'bill_promotion_enabled': '1',
  'bill_promotion_name': 'เติมครบ 500 ลด 5',
  'bill_promotion_min_fuel_spend': '500',
  'bill_promotion_discount': '5',
  'bill_promotion_start_date': '2026-11-01',
  'bill_promotion_end_date': '2026-11-30',
};
