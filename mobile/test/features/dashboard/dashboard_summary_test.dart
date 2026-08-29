import 'package:flutter_test/flutter_test.dart';
import 'package:pumppos/features/dashboard/domain/dashboard_summary.dart';

void main() {
  test('parses totals from closed shifts and POS sales', () {
    final summary = DashboardSummary.fromJson({
      'todayTotal': 22645,
      'todayPosTotal': 2645,
      'todayShiftTotal': 20000,
      'todayShiftCount': 2,
      'todayBills': 5,
      'litersToday': 650.5,
      'shiftLitersToday': 650.5,
      'fuelSource': 'shift',
      'openShift': {'id': 9},
      'lowTanks': <Object>[],
      'lowProducts': <Object>[],
      'chart': [
        {
          'date': '2026-08-29',
          'label': '29 ส.ค.',
          'total': 22645,
          'posTotal': 2645,
          'shiftTotal': 20000,
          'bills': 5,
          'shifts': 2,
        },
      ],
      'fuelByCode': {
        'GSH95': {'name': 'แก๊สโซฮอล์ 95', 'liters': 650.5, 'amount': 20000},
      },
    });

    expect(summary.todayTotal, 22645);
    expect(summary.todayPosTotal, 2645);
    expect(summary.todayShiftTotal, 20000);
    expect(summary.todayShiftCount, 2);
    expect(summary.shiftLitersToday, 650.5);
    expect(summary.fuelSource, 'shift');
    expect(summary.hasOpenShift, isTrue);
    expect(summary.chart.single.posTotal, 2645);
    expect(summary.chart.single.shiftTotal, 20000);
    expect(summary.chart.single.shifts, 2);
  });

  test('falls back safely when the API still returns the legacy shape', () {
    final summary = DashboardSummary.fromJson({
      'todayTotal': 1200,
      'todayBills': 3,
      'litersToday': 30,
      'chart': [
        {'date': '2026-08-29', 'label': '29 ส.ค.', 'total': 1200, 'bills': 3},
      ],
    });

    expect(summary.todayPosTotal, 1200);
    expect(summary.todayShiftTotal, 0);
    expect(summary.todayShiftCount, 0);
    expect(summary.shiftLitersToday, 0);
    expect(summary.fuelSource, 'pos');
    expect(summary.chart.single.posTotal, 1200);
    expect(summary.chart.single.shiftTotal, 0);
    expect(summary.chart.single.shifts, 0);
  });
}
