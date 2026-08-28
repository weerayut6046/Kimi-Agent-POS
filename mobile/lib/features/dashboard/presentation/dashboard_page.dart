import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../shared/widgets/app_page_hero.dart';
import '../../auth/domain/staff_session.dart';
import '../application/dashboard_provider.dart';
import '../domain/dashboard_summary.dart';

class DashboardPage extends ConsumerWidget {
  const DashboardPage({required this.staff, super.key});

  final StaffSession staff;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final provider = dashboardProvider(staff.branch.id);
    final dashboard = ref.watch(provider);

    return RefreshIndicator(
      onRefresh: () => ref.refresh(provider.future),
      child: dashboard.when(
        loading: () =>
            const _ScrollableState(child: CircularProgressIndicator()),
        error: (error, _) => _ScrollableState(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_rounded, size: 48),
              const SizedBox(height: 12),
              const Text('โหลดข้อมูลภาพรวมไม่สำเร็จ'),
              const SizedBox(height: 6),
              Text(
                '$error',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 16),
              FilledButton.tonalIcon(
                onPressed: () => ref.invalidate(provider),
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('ลองอีกครั้ง'),
              ),
            ],
          ),
        ),
        data: (summary) =>
            _DashboardContent(summary: summary, branchName: staff.branch.name),
      ),
    );
  }
}

class _DashboardContent extends StatelessWidget {
  const _DashboardContent({required this.summary, required this.branchName});

  final DashboardSummary summary;
  final String branchName;

  @override
  Widget build(BuildContext context) {
    final currency = NumberFormat.currency(locale: 'th_TH', symbol: '฿');
    final number = NumberFormat.decimalPattern('th_TH');

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
      children: [
        AppPageHero(
          eyebrow: 'Live overview',
          title: branchName,
          subtitle: 'ข้อมูลการขายและสถานะการทำงานวันนี้',
          icon: Icons.space_dashboard_rounded,
          status: summary.hasOpenShift ? 'กะเปิดอยู่' : 'รอเปิดกะ',
          statusColor: summary.hasOpenShift
              ? const Color(0xFF6EE7B7)
              : const Color(0xFFFBBF24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'ยอดขายวันนี้',
                style: TextStyle(color: Color(0x8CFFFFFF), fontSize: 11.5),
              ),
              const SizedBox(height: 3),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(
                  currency.format(summary.todayTotal),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 31,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -1,
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: AppHeroStat(
                      label: 'จำนวนบิล',
                      value: '${number.format(summary.todayBills)} บิล',
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: AppHeroStat(
                      label: 'ปริมาณน้ำมัน',
                      value: '${number.format(summary.litersToday)} ลิตร',
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth >= 720 ? 4 : 2;
            return GridView.count(
              crossAxisCount: columns,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              childAspectRatio: columns == 4 ? 1.45 : 1.25,
              children: [
                _MetricCard(
                  label: 'ยอดขายวันนี้',
                  value: currency.format(summary.todayTotal),
                  icon: Icons.payments_rounded,
                  color: const Color(0xFF6656E8),
                ),
                _MetricCard(
                  label: 'จำนวนบิล',
                  value: number.format(summary.todayBills),
                  icon: Icons.receipt_long_rounded,
                  color: const Color(0xFF0C91A1),
                ),
                _MetricCard(
                  label: 'ลิตรวันนี้',
                  value: number.format(summary.litersToday),
                  icon: Icons.local_gas_station_rounded,
                  color: const Color(0xFFE67E22),
                ),
                _MetricCard(
                  label: 'สถานะกะ',
                  value: summary.hasOpenShift ? 'เปิดอยู่' : 'ยังไม่เปิด',
                  icon: Icons.schedule_rounded,
                  color: summary.hasOpenShift
                      ? const Color(0xFF138A58)
                      : const Color(0xFF6B7280),
                ),
              ],
            );
          },
        ),
        if (summary.lowTankCount > 0 || summary.lowProductCount > 0) ...[
          const SizedBox(height: 14),
          _StockWarning(summary: summary),
        ],
        const SizedBox(height: 14),
        Card(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'ยอดขาย 7 วัน',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 18),
                SizedBox(
                  height: 190,
                  child: summary.chart.isEmpty
                      ? const Center(child: Text('ยังไม่มีข้อมูลยอดขาย'))
                      : _SalesChart(points: summary.chart),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 14),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'ยอดขายแยกตามน้ำมัน',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 10),
                if (summary.fuelSales.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 18),
                    child: Center(child: Text('ยังไม่มีข้อมูลการขายน้ำมัน')),
                  )
                else
                  for (final fuel in summary.fuelSales)
                    _FuelRow(fuel: fuel, currency: currency, number: number),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
      ],
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
  });

  final String label;
  final String value;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [color.withValues(alpha: 0.105), Colors.white],
        ),
        border: Border.all(color: color.withValues(alpha: 0.16)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0D211B58),
            blurRadius: 22,
            offset: Offset(0, 9),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.13),
                borderRadius: BorderRadius.circular(13),
                border: Border.all(color: Colors.white),
              ),
              child: Icon(icon, size: 20, color: color),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(
                    context,
                  ).textTheme.bodySmall?.copyWith(color: Colors.black54),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _StockWarning extends StatelessWidget {
  const _StockWarning({required this.summary});

  final DashboardSummary summary;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFFFFF7E5),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            const Icon(Icons.warning_amber_rounded, color: Color(0xFFB96A00)),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'แจ้งเตือนสต็อก: ถังน้ำมันต่ำ ${summary.lowTankCount} รายการ · สินค้าใกล้หมด ${summary.lowProductCount} รายการ',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SalesChart extends StatelessWidget {
  const _SalesChart({required this.points});

  final List<DailySalesPoint> points;

  @override
  Widget build(BuildContext context) {
    final maxValue = points.fold<double>(
      0,
      (value, point) => math.max(value, point.total),
    );

    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        for (final point in points)
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 3),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Expanded(
                    child: Align(
                      alignment: Alignment.bottomCenter,
                      child: FractionallySizedBox(
                        heightFactor: maxValue == 0
                            ? 0.03
                            : math.max(0.03, point.total / maxValue),
                        child: Container(
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(8),
                            gradient: const LinearGradient(
                              begin: Alignment.bottomCenter,
                              end: Alignment.topCenter,
                              colors: [Color(0xFF6656E8), Color(0xFF10B8C7)],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 7),
                  Text(
                    point.label,
                    maxLines: 1,
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _FuelRow extends StatelessWidget {
  const _FuelRow({
    required this.fuel,
    required this.currency,
    required this.number,
  });

  final FuelSalesSummary fuel;
  final NumberFormat currency;
  final NumberFormat number;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: Row(
        children: [
          const CircleAvatar(
            radius: 17,
            child: Icon(Icons.water_drop_rounded, size: 18),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  fuel.name,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                Text(
                  '${number.format(fuel.liters)} ลิตร',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          Text(
            currency.format(fuel.amount),
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}

class _ScrollableState extends StatelessWidget {
  const _ScrollableState({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(32),
      children: [
        SizedBox(
          height: math.max(300, MediaQuery.sizeOf(context).height * 0.55),
          child: Center(child: child),
        ),
      ],
    );
  }
}
