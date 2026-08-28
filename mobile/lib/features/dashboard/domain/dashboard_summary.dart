class DailySalesPoint {
  const DailySalesPoint({
    required this.date,
    required this.label,
    required this.total,
    required this.bills,
  });

  factory DailySalesPoint.fromJson(Map<String, dynamic> json) {
    return DailySalesPoint(
      date: json['date'] as String? ?? '',
      label: json['label'] as String? ?? '',
      total: _number(json['total']),
      bills: _integer(json['bills']),
    );
  }

  final String date;
  final String label;
  final double total;
  final int bills;
}

class FuelSalesSummary {
  const FuelSalesSummary({
    required this.code,
    required this.name,
    required this.liters,
    required this.amount,
  });

  factory FuelSalesSummary.fromJson(String code, Map<String, dynamic> json) {
    return FuelSalesSummary(
      code: code,
      name: json['name'] as String? ?? code,
      liters: _number(json['liters']),
      amount: _number(json['amount']),
    );
  }

  final String code;
  final String name;
  final double liters;
  final double amount;
}

class DashboardSummary {
  const DashboardSummary({
    required this.todayTotal,
    required this.todayBills,
    required this.litersToday,
    required this.hasOpenShift,
    required this.lowTankCount,
    required this.lowProductCount,
    required this.chart,
    required this.fuelSales,
  });

  factory DashboardSummary.fromJson(Map<String, dynamic> json) {
    final chartJson = json['chart'];
    final fuelJson = json['fuelByCode'];
    return DashboardSummary(
      todayTotal: _number(json['todayTotal']),
      todayBills: _integer(json['todayBills']),
      litersToday: _number(json['litersToday']),
      hasOpenShift: json['openShift'] != null,
      lowTankCount: json['lowTanks'] is List<dynamic>
          ? (json['lowTanks'] as List<dynamic>).length
          : 0,
      lowProductCount: json['lowProducts'] is List<dynamic>
          ? (json['lowProducts'] as List<dynamic>).length
          : 0,
      chart: chartJson is List<dynamic>
          ? List<DailySalesPoint>.unmodifiable(
              chartJson.whereType<Map<String, dynamic>>().map(
                DailySalesPoint.fromJson,
              ),
            )
          : const [],
      fuelSales: fuelJson is Map<String, dynamic>
          ? List<FuelSalesSummary>.unmodifiable(
              fuelJson.entries
                  .where((entry) => entry.value is Map)
                  .map(
                    (entry) => FuelSalesSummary.fromJson(
                      entry.key,
                      Map<String, dynamic>.from(entry.value as Map),
                    ),
                  ),
            )
          : const [],
    );
  }

  final double todayTotal;
  final int todayBills;
  final double litersToday;
  final bool hasOpenShift;
  final int lowTankCount;
  final int lowProductCount;
  final List<DailySalesPoint> chart;
  final List<FuelSalesSummary> fuelSales;
}

double _number(Object? value) => value is num ? value.toDouble() : 0;
int _integer(Object? value) => value is num ? value.toInt() : 0;
