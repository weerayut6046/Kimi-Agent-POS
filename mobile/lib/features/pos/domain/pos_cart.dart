import 'pos_models.dart';

class PosCartException implements Exception {
  const PosCartException(this.message);

  final String message;

  @override
  String toString() => message;
}

class CartLine {
  const CartLine({required this.product, required this.quantity});

  final PosProduct product;
  final double quantity;

  double get amount => _round(quantity * product.price, 2);
}

class PosCart {
  const PosCart([this.lines = const []]);

  final List<CartLine> lines;

  bool get isEmpty => lines.isEmpty;
  int get lineCount => lines.length;
  double get subtotal =>
      _round(lines.fold<double>(0, (sum, line) => sum + line.amount), 2);
  double get fuelLiters => lines
      .where((line) => line.product.isFuel)
      .fold<double>(0, (sum, line) => sum + line.quantity);
  double get fuelSpend => _round(
    lines
        .where((line) => line.product.isFuel)
        .fold<double>(0, (sum, line) => sum + line.amount),
    2,
  );

  PosCart add(PosProduct product, double quantity) {
    if (!quantity.isFinite || quantity <= 0) {
      throw const PosCartException('จำนวนสินค้าต้องมากกว่า 0');
    }
    if (!product.canSell) {
      throw PosCartException('${product.name} ไม่พร้อมขาย');
    }
    final current = lines
        .where((line) => line.product.id == product.id)
        .firstOrNull;
    final nextQuantity = _round((current?.quantity ?? 0) + quantity, 4);
    _validateStock(product, nextQuantity);

    final nextLines = <CartLine>[
      for (final line in lines)
        if (line.product.id != product.id) line,
      CartLine(product: product, quantity: nextQuantity),
    ];
    return PosCart(List<CartLine>.unmodifiable(nextLines));
  }

  PosCart setQuantity(int productId, double quantity) {
    if (quantity <= 0) return remove(productId);
    final current = lines
        .where((line) => line.product.id == productId)
        .firstOrNull;
    if (current == null) return this;
    final nextQuantity = _round(quantity, 4);
    _validateStock(current.product, nextQuantity);
    return PosCart(
      List<CartLine>.unmodifiable([
        for (final line in lines)
          if (line.product.id == productId)
            CartLine(product: line.product, quantity: nextQuantity)
          else
            line,
      ]),
    );
  }

  PosCart remove(int productId) => PosCart(
    List<CartLine>.unmodifiable(
      lines.where((line) => line.product.id != productId),
    ),
  );

  String? stockIssue(List<PosProduct> currentProducts) {
    final byId = {for (final product in currentProducts) product.id: product};
    for (final line in lines) {
      final product = byId[line.product.id];
      if (product == null || !product.active) {
        return '${line.product.name} ไม่พร้อมขายแล้ว กรุณานำออกจากบิล';
      }
      if (!product.isFuel && line.quantity > product.stockQty) {
        return 'สต็อก ${product.name} ไม่พอ (เหลือ ${product.stockQty} ${product.unit})';
      }
    }
    return null;
  }

  static void _validateStock(PosProduct product, double quantity) {
    if (!product.isFuel && quantity > product.stockQty) {
      throw PosCartException(
        'สต็อก ${product.name} ไม่พอ (เหลือ ${product.stockQty} ${product.unit})',
      );
    }
  }
}

double _round(double value, int digits) {
  final factor = switch (digits) {
    2 => 100,
    4 => 10000,
    _ => 1,
  };
  return (value * factor).round() / factor;
}
