enum ProductCategory { fuel, lubricant, other }

enum PaymentMethod { cash, qr, card, credit, thungngern }

extension ProductCategoryLabel on ProductCategory {
  String get label => switch (this) {
    ProductCategory.fuel => 'น้ำมัน',
    ProductCategory.lubricant => 'น้ำมันเครื่อง',
    ProductCategory.other => 'สินค้าอื่น',
  };
}

extension PaymentMethodLabel on PaymentMethod {
  String get label => switch (this) {
    PaymentMethod.cash => 'เงินสด',
    PaymentMethod.qr => 'QR โอนเงิน',
    PaymentMethod.card => 'บัตร',
    PaymentMethod.credit => 'ขายเชื่อ',
    PaymentMethod.thungngern => 'QR ถุงเงิน',
  };
}

class PosMember {
  const PosMember({
    required this.id,
    required this.memberCode,
    required this.name,
    required this.phone,
    required this.points,
    required this.cardExpiresAt,
  });

  factory PosMember.fromJson(Map<String, dynamic> json) => PosMember(
    id: _requiredInt(json, 'id'),
    memberCode: _requiredString(json, 'memberCode'),
    name: _requiredString(json, 'name'),
    phone: _requiredString(json, 'phone'),
    points: _requiredInt(json, 'points'),
    cardExpiresAt: DateTime.tryParse(
      json['cardExpiresAt']?.toString() ?? '',
    )?.toLocal(),
  );

  final int id;
  final String memberCode;
  final String name;
  final String phone;
  final int points;
  final DateTime? cardExpiresAt;

  bool get expired =>
      cardExpiresAt != null && !cardExpiresAt!.isAfter(DateTime.now());
}

class PosCustomer {
  const PosCustomer({
    required this.id,
    required this.name,
    required this.phone,
    required this.vehiclePlate,
    required this.creditLimit,
  });

  factory PosCustomer.fromJson(Map<String, dynamic> json) => PosCustomer(
    id: _requiredInt(json, 'id'),
    name: _requiredString(json, 'name'),
    phone: json['phone'] as String? ?? '',
    vehiclePlate: json['vehiclePlate'] as String? ?? '',
    creditLimit: _number(json['creditLimit']),
  );

  final int id;
  final String name;
  final String phone;
  final String vehiclePlate;
  final double creditLimit;
}

class PosProduct {
  const PosProduct({
    required this.id,
    required this.code,
    required this.name,
    required this.category,
    required this.unit,
    required this.price,
    required this.stockQty,
    required this.active,
    this.imageUrl,
  });

  factory PosProduct.fromJson(Map<String, dynamic> json) {
    final categoryName = _requiredString(json, 'category');
    ProductCategory? category;
    for (final item in ProductCategory.values) {
      if (item.name == categoryName) category = item;
    }
    if (category == null) {
      throw const FormatException('Unknown product category');
    }

    return PosProduct(
      id: _requiredInt(json, 'id'),
      code: _requiredString(json, 'code'),
      name: _requiredString(json, 'name'),
      category: category,
      unit: _requiredString(json, 'unit'),
      price: _number(json['price']),
      stockQty: _number(json['stockQty']),
      active: json['active'] == true,
      imageUrl: json['imageUrl'] as String?,
    );
  }

  final int id;
  final String code;
  final String name;
  final ProductCategory category;
  final String unit;
  final double price;
  final double stockQty;
  final bool active;
  final String? imageUrl;

  bool get isFuel => category == ProductCategory.fuel;
  bool get canSell => active && (isFuel || stockQty > 0);
}

class PosShift {
  const PosShift({
    required this.id,
    required this.staffName,
    required this.openedAt,
  });

  factory PosShift.fromJson(Map<String, dynamic> json) {
    return PosShift(
      id: _requiredInt(json, 'id'),
      staffName: _requiredString(json, 'staffName'),
      openedAt: DateTime.tryParse(_requiredString(json, 'openedAt')),
    );
  }

  final int id;
  final String staffName;
  final DateTime? openedAt;
}

class PosBootstrap {
  const PosBootstrap({
    required this.products,
    required this.settings,
    required this.currentShift,
    this.thungngernEnabled = false,
  });

  final List<PosProduct> products;
  final Map<String, String> settings;
  final PosShift? currentShift;
  final bool thungngernEnabled;

  List<PaymentMethod> get enabledPaymentMethods {
    return PaymentMethod.values
        .where((method) {
          if (method == PaymentMethod.thungngern) return thungngernEnabled;
          return (settings['pay_${method.name}_enabled'] ?? '1') != '0';
        })
        .toList(growable: false);
  }
}

class ThungngernSession {
  const ThungngernSession({
    required this.id,
    required this.refCode,
    required this.payload,
    required this.amount,
    required this.expiresAt,
  });

  factory ThungngernSession.fromJson(Map<String, dynamic> json) =>
      ThungngernSession(
        id: _requiredInt(json, 'sessionId'),
        refCode: _requiredString(json, 'refCode'),
        payload: _requiredString(json, 'payload'),
        amount: _number(json['amount']),
        expiresAt: DateTime.tryParse(
          json['expiresAt']?.toString() ?? '',
        )?.toLocal(),
      );

  final int id;
  final String refCode;
  final String payload;
  final double amount;
  final DateTime? expiresAt;
}

class PromptPayQr {
  const PromptPayQr({required this.payload, required this.mode});

  factory PromptPayQr.fromJson(Map<String, dynamic> json) {
    return PromptPayQr(
      payload: json['payload'] as String?,
      mode: json['mode'] as String? ?? 'promptpay',
    );
  }

  final String? payload;
  final String mode;
}

class SaleReceipt {
  const SaleReceipt({required this.sale, required this.items});

  factory SaleReceipt.fromJson(Map<String, dynamic> json) {
    final saleJson = json['sale'];
    final itemJson = json['items'];
    if (saleJson is! Map<String, dynamic> || itemJson is! List<dynamic>) {
      throw const FormatException('Invalid sale receipt response');
    }
    return SaleReceipt(
      sale: SaleSummary.fromJson(saleJson),
      items: List<ReceiptLine>.unmodifiable(
        itemJson.map((item) => ReceiptLine.fromJson(_jsonMap(item))),
      ),
    );
  }

  final SaleSummary sale;
  final List<ReceiptLine> items;
}

class SaleSummary {
  const SaleSummary({
    required this.id,
    required this.receiptNo,
    required this.subtotal,
    required this.discount,
    required this.vatRate,
    required this.vatAmount,
    required this.total,
    required this.paymentMethod,
    required this.received,
    required this.changeAmount,
    required this.createdAt,
  });

  factory SaleSummary.fromJson(Map<String, dynamic> json) {
    final paymentName = _requiredString(json, 'paymentMethod');
    PaymentMethod? paymentMethod;
    for (final item in PaymentMethod.values) {
      if (item.name == paymentName) paymentMethod = item;
    }
    if (paymentMethod == null) {
      throw const FormatException('Unknown receipt payment method');
    }

    return SaleSummary(
      id: _requiredInt(json, 'id'),
      receiptNo: _requiredString(json, 'receiptNo'),
      subtotal: _number(json['subtotal']),
      discount: _number(json['discount']),
      vatRate: _number(json['vatRate']),
      vatAmount: _number(json['vatAmount']),
      total: _number(json['total']),
      paymentMethod: paymentMethod,
      received: _number(json['received']),
      changeAmount: _number(json['changeAmt']),
      createdAt: DateTime.tryParse(_requiredString(json, 'createdAt')),
    );
  }

  final int id;
  final String receiptNo;
  final double subtotal;
  final double discount;
  final double vatRate;
  final double vatAmount;
  final double total;
  final PaymentMethod paymentMethod;
  final double received;
  final double changeAmount;
  final DateTime? createdAt;
}

class ReceiptLine {
  const ReceiptLine({
    required this.name,
    required this.quantity,
    required this.unit,
    required this.unitPrice,
    required this.amount,
  });

  factory ReceiptLine.fromJson(Map<String, dynamic> json) {
    return ReceiptLine(
      name: _requiredString(json, 'name'),
      quantity: _number(json['qty']),
      unit: _requiredString(json, 'unit'),
      unitPrice: _number(json['unitPrice']),
      amount: _number(json['amount']),
    );
  }

  final String name;
  final double quantity;
  final String unit;
  final double unitPrice;
  final double amount;
}

Map<String, dynamic> _jsonMap(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  throw const FormatException('Invalid JSON object');
}

int _requiredInt(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is int) return value;
  if (value is num) return value.toInt();
  throw FormatException('Invalid $key');
}

String _requiredString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is String) return value;
  throw FormatException('Invalid $key');
}

double _number(Object? value) => value is num ? value.toDouble() : 0;
