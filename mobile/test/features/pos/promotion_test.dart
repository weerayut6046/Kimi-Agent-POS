import 'package:flutter_test/flutter_test.dart';
import 'package:pumppos/features/pos/domain/pos_cart.dart';
import 'package:pumppos/features/pos/domain/pos_models.dart';
import 'package:pumppos/features/pos/domain/promotion.dart';

void main() {
  test('combines per-liter and fuel threshold promotions', () {
    final cart = const PosCart().add(_fuel, 30);
    final promotion = PromotionSummary.calculate(
      _settings,
      cart,
      now: DateTime.utc(2026, 8, 15),
    );

    expect(cart.subtotal, 1200);
    expect(promotion.discount, 35);
    expect(promotion.labels, hasLength(2));
  });

  test('does not apply promotions outside the Bangkok date range', () {
    final promotion = PromotionSummary.calculate(
      _settings,
      const PosCart().add(_fuel, 30),
      now: DateTime.utc(2026, 9, 1),
    );

    expect(promotion.discount, 0);
    expect(promotion.labels, isEmpty);
  });
}

const _fuel = PosProduct(
  id: 1,
  code: 'GSH95',
  name: 'แก๊สโซฮอล์ 95',
  category: ProductCategory.fuel,
  unit: 'ลิตร',
  price: 40,
  stockQty: 0,
  active: true,
);

const _settings = <String, String>{
  'promotion_per_liter_feature_enabled': '1',
  'promotion_enabled': '1',
  'promotion_name': 'ลดต่อลิตร',
  'promotion_discount': '0.50',
  'promotion_start_date': '2026-08-01',
  'promotion_end_date': '2026-08-31',
  'bill_promotion_enabled': '1',
  'bill_promotion_name': 'ครบพันลดเพิ่ม',
  'bill_promotion_min_fuel_spend': '1000',
  'bill_promotion_discount': '20',
  'bill_promotion_start_date': '2026-08-01',
  'bill_promotion_end_date': '2026-08-31',
};
