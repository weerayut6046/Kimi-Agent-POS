class ShiftNozzle {
  const ShiftNozzle({
    required this.id,
    required this.label,
    required this.pumpName,
    required this.productName,
    required this.currentMeter,
    required this.currentMoney,
    required this.active,
  });

  factory ShiftNozzle.fromJson(
    Map<String, dynamic> json, {
    required String pumpName,
  }) {
    final product = _optionalMap(json['product']);
    return ShiftNozzle(
      id: _requiredInt(json, 'id'),
      label: _requiredString(json, 'label'),
      pumpName: pumpName,
      productName: product?['name'] as String? ?? 'ไม่ทราบชนิดน้ำมัน',
      currentMeter: _number(json['currentMeter']),
      currentMoney: _number(json['currentMoney']),
      active: json['active'] == true,
    );
  }

  final int id;
  final String label;
  final String pumpName;
  final String productName;
  final double currentMeter;
  final double currentMoney;
  final bool active;
}

class ShiftReading {
  const ShiftReading({
    required this.nozzleId,
    required this.label,
    required this.pumpName,
    required this.productName,
    required this.openMeter,
    required this.openMoney,
    required this.pricePerLiter,
    required this.priceChangedDuringShift,
  });

  factory ShiftReading.fromJson(Map<String, dynamic> json) {
    final nozzle = _optionalMap(json['nozzle']);
    final pump = _optionalMap(json['pump']);
    final product = _optionalMap(json['product']);
    final nozzleId = _requiredInt(json, 'nozzleId');
    return ShiftReading(
      nozzleId: nozzleId,
      label: nozzle?['label'] as String? ?? 'หัวจ่าย #$nozzleId',
      pumpName: pump?['name'] as String? ?? 'ไม่ทราบตู้',
      productName: product?['name'] as String? ?? 'ไม่ทราบชนิดน้ำมัน',
      openMeter: _number(json['openMeter']),
      openMoney: _number(json['openMoney']),
      pricePerLiter: _number(json['pricePerLiter']),
      priceChangedDuringShift: json['priceChangedDuringShift'] == true,
    );
  }

  final int nozzleId;
  final String label;
  final String pumpName;
  final String productName;
  final double openMeter;
  final double openMoney;
  final double pricePerLiter;
  final bool priceChangedDuringShift;
}

class CurrentShift {
  const CurrentShift({
    required this.id,
    required this.staffName,
    required this.openedAt,
    required this.openingFloat,
    required this.expectedCash,
    required this.readings,
  });

  factory CurrentShift.fromJson(Map<String, dynamic> json) {
    final readings = json['readings'];
    if (readings is! List<dynamic>) {
      throw const FormatException('Invalid shift readings');
    }
    final cash = _optionalMap(json['cash']);
    return CurrentShift(
      id: _requiredInt(json, 'id'),
      staffName: _requiredString(json, 'staffName'),
      openedAt: DateTime.tryParse(_requiredString(json, 'openedAt')),
      openingFloat: _number(json['openingFloat']),
      expectedCash: _number(cash?['expectedCash']),
      readings: List<ShiftReading>.unmodifiable(
        readings.map((item) => ShiftReading.fromJson(_requiredMap(item))),
      ),
    );
  }

  final int id;
  final String staffName;
  final DateTime? openedAt;
  final double openingFloat;
  final double expectedCash;
  final List<ShiftReading> readings;
}

class ShiftBootstrap {
  const ShiftBootstrap({required this.currentShift, required this.nozzles});

  final CurrentShift? currentShift;
  final List<ShiftNozzle> nozzles;
}

Map<String, dynamic> _requiredMap(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  throw const FormatException('Invalid JSON object');
}

Map<String, dynamic>? _optionalMap(Object? value) {
  if (value == null) return null;
  return _requiredMap(value);
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
