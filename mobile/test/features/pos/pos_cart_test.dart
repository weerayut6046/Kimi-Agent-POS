import 'package:flutter_test/flutter_test.dart';
import 'package:pumppos/features/pos/domain/pos_cart.dart';
import 'package:pumppos/features/pos/domain/pos_models.dart';

void main() {
  group('PosCart', () {
    test('calculates fuel and product totals', () {
      final cart = const PosCart().add(_fuel, 25).add(_product, 2);

      expect(cart.lineCount, 2);
      expect(cart.fuelLiters, 25);
      expect(cart.fuelSpend, 925);
      expect(cart.subtotal, 1025);
    });

    test('prevents non-fuel quantities above current stock', () {
      expect(
        () => const PosCart().add(_product, 6),
        throwsA(
          isA<PosCartException>().having(
            (error) => error.message,
            'message',
            contains('สต็อก'),
          ),
        ),
      );
    });

    test('detects a stock change after items entered the cart', () {
      final cart = const PosCart().add(_product, 4);
      final latest = PosProduct(
        id: _product.id,
        code: _product.code,
        name: _product.name,
        category: _product.category,
        unit: _product.unit,
        price: _product.price,
        stockQty: 2,
        active: true,
      );

      expect(cart.stockIssue([latest]), contains('เหลือ 2'));
    });
  });
}

const _fuel = PosProduct(
  id: 1,
  code: 'GSH95',
  name: 'แก๊สโซฮอล์ 95',
  category: ProductCategory.fuel,
  unit: 'ลิตร',
  price: 37,
  stockQty: 0,
  active: true,
);

const _product = PosProduct(
  id: 2,
  code: 'WATER',
  name: 'น้ำดื่ม',
  category: ProductCategory.other,
  unit: 'ขวด',
  price: 50,
  stockQty: 5,
  active: true,
);
