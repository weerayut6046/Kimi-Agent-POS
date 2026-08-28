import 'pos_cart.dart';

class PromotionSummary {
  const PromotionSummary({
    required this.discount,
    required this.labels,
    required this.blocksLoyalty,
  });

  factory PromotionSummary.calculate(
    Map<String, String> settings,
    PosCart cart, {
    DateTime? now,
  }) {
    final dateKey = _bangkokDateKey(now ?? DateTime.now());
    final labels = <String>[];
    var discount = 0.0;
    final perLiterActive = _active(settings, 'promotion', dateKey);

    if (perLiterActive &&
        settings['promotion_per_liter_feature_enabled'] == '1') {
      final perLiter = _positive(settings['promotion_discount']);
      final name = settings['promotion_name']?.trim() ?? '';
      if (perLiter != null &&
          _hasAtMostTwoDecimals(perLiter) &&
          name.isNotEmpty &&
          cart.fuelLiters > 0) {
        final amount = _round2(
          (perLiter * cart.fuelLiters).clamp(0, cart.subtotal),
        );
        if (amount > 0) {
          discount += amount;
          labels.add('$name −฿${amount.toStringAsFixed(2)}');
        }
      }
    }

    final billPromotionActive = _active(settings, 'bill_promotion', dateKey);
    var billPromotionApplied = false;
    if (billPromotionActive) {
      final minimum = _positive(settings['bill_promotion_min_fuel_spend']);
      final billDiscount = _positive(settings['bill_promotion_discount']);
      final name = settings['bill_promotion_name']?.trim() ?? '';
      if (minimum != null &&
          billDiscount != null &&
          _hasAtMostTwoDecimals(minimum) &&
          _hasAtMostTwoDecimals(billDiscount) &&
          billDiscount <= minimum &&
          name.isNotEmpty &&
          cart.fuelSpend >= minimum) {
        final remaining = (cart.subtotal - discount).clamp(0, cart.subtotal);
        final amount = _round2(billDiscount.clamp(0, remaining));
        if (amount > 0) {
          discount += amount;
          billPromotionApplied = true;
          labels.add('$name −฿${amount.toStringAsFixed(2)}');
        }
      }
    }

    return PromotionSummary(
      discount: _round2(discount.clamp(0, cart.subtotal)),
      labels: List<String>.unmodifiable(labels),
      blocksLoyalty: perLiterActive || billPromotionApplied,
    );
  }

  final double discount;
  final List<String> labels;
  final bool blocksLoyalty;
}

bool _active(Map<String, String> settings, String prefix, String dateKey) {
  if (settings['${prefix}_enabled'] != '1') return false;
  final start = settings['${prefix}_start_date'] ?? '';
  final end = settings['${prefix}_end_date'] ?? '';
  return _isDateKey(start) &&
      _isDateKey(end) &&
      start.compareTo(end) <= 0 &&
      dateKey.compareTo(start) >= 0 &&
      dateKey.compareTo(end) <= 0;
}

bool _isDateKey(String value) {
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value)) return false;
  final parts = value.split('-').map(int.tryParse).toList();
  if (parts.any((part) => part == null)) return false;
  final parsed = DateTime.utc(parts[0]!, parts[1]!, parts[2]!);
  return parsed.year == parts[0] &&
      parsed.month == parts[1] &&
      parsed.day == parts[2];
}

double? _positive(String? value) {
  final parsed = double.tryParse(value ?? '');
  return parsed != null && parsed.isFinite && parsed > 0 ? parsed : null;
}

bool _hasAtMostTwoDecimals(double value) {
  return ((value * 100).round() - value * 100).abs() <= 1e-8;
}

String _bangkokDateKey(DateTime value) {
  final bangkok = value.toUtc().add(const Duration(hours: 7));
  String two(int part) => part.toString().padLeft(2, '0');
  return '${bangkok.year}-${two(bangkok.month)}-${two(bangkok.day)}';
}

double _round2(num value) => (value.toDouble() * 100).round() / 100;
