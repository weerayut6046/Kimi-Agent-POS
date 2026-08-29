import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../shared/widgets/app_page_hero.dart';
import '../../auth/domain/staff_session.dart';
import '../../dashboard/application/dashboard_provider.dart';
import '../../pos/application/pos_provider.dart';
import '../application/shift_provider.dart';
import '../data/shift_repository.dart';
import '../domain/shift_models.dart';
import 'shift_history_sheet.dart';
import 'shift_meter_scanner.dart';

class ShiftPage extends ConsumerStatefulWidget {
  const ShiftPage({required this.staff, super.key});

  final StaffSession staff;

  @override
  ConsumerState<ShiftPage> createState() => _ShiftPageState();
}

class _ShiftPageState extends ConsumerState<ShiftPage> {
  final _openingFloat = TextEditingController();
  final _countedCash = TextEditingController();
  final _transferAmount = TextEditingController();
  final _note = TextEditingController();
  final Map<int, String> _openMeters = {};
  final Map<int, String> _openMoney = {};
  final Map<int, String> _closeMeters = {};
  final Map<int, String> _closeMoney = {};
  final Map<String, String> _cashCounts = {};
  bool _submitting = false;
  String? _error;
  String? _notice;

  @override
  void dispose() {
    _openingFloat.dispose();
    _countedCash.dispose();
    _transferAmount.dispose();
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final provider = shiftBootstrapProvider(widget.staff.branch.id);
    final state = ref.watch(provider);

    return RefreshIndicator(
      onRefresh: () => ref.refresh(provider.future),
      child: state.when(
        loading: () =>
            const _ScrollableCenter(child: CircularProgressIndicator()),
        error: (error, _) => _ScrollableCenter(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_rounded, size: 48),
              const SizedBox(height: 10),
              Text('$error', textAlign: TextAlign.center),
              const SizedBox(height: 14),
              FilledButton.tonalIcon(
                onPressed: () => ref.invalidate(provider),
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('ลองอีกครั้ง'),
              ),
            ],
          ),
        ),
        data: (data) => ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
          children: [
            AppPageHero(
              eyebrow: 'Shift control',
              title: 'จัดการกะ',
              subtitle: widget.staff.branch.name,
              icon: Icons.schedule_rounded,
              status: data.currentShift == null
                  ? 'ยังไม่เปิดกะ'
                  : 'กะกำลังทำงาน',
              statusColor: data.currentShift == null
                  ? const Color(0xFFFBBF24)
                  : const Color(0xFF6EE7B7),
              child: Row(
                children: [
                  Expanded(
                    child: AppHeroStat(
                      label: data.currentShift == null
                          ? 'หัวจ่ายพร้อมใช้'
                          : 'หมายเลขกะ',
                      value: data.currentShift == null
                          ? '${data.nozzles.length} หัวจ่าย'
                          : '#${data.currentShift!.id}',
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: AppHeroStat(
                      label: data.currentShift == null
                          ? 'ผู้เปิดกะ'
                          : 'พนักงานประจำกะ',
                      value: data.currentShift == null
                          ? widget.staff.name
                          : data.currentShift!.staffName,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              key: const ValueKey('shift-history-button'),
              onPressed: () => showShiftHistorySheet(
                context: context,
                staff: widget.staff,
                repository: ref.read(shiftRepositoryProvider),
              ),
              icon: const Icon(Icons.history_rounded),
              label: const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Text('ดูประวัติการตัดกะ'),
              ),
            ),
            if (_notice != null) ...[
              const SizedBox(height: 12),
              _StatusMessage(message: _notice!, success: true),
            ],
            if (_error != null) ...[
              const SizedBox(height: 12),
              _StatusMessage(message: _error!, success: false),
            ],
            const SizedBox(height: 15),
            if (data.currentShift == null)
              _OpenShiftForm(
                nozzles: data.nozzles,
                openingFloat: _openingFloat,
                openMeters: _openMeters,
                openMoney: _openMoney,
                submitting: _submitting,
                onOpen: () => _openShift(data),
              )
            else
              _CloseShiftForm(
                shift: data.currentShift!,
                countedCash: _countedCash,
                transferAmount: _transferAmount,
                note: _note,
                closeMeters: _closeMeters,
                closeMoney: _closeMoney,
                cashCounts: _cashCounts,
                submitting: _submitting,
                onCashCountChanged: (denomination, count) {
                  setState(() {
                    _cashCounts[denomination] = count;
                    _countedCash.text = _cashCountTotal(
                      _cashCounts,
                    ).toStringAsFixed(2);
                  });
                },
                onScanMeters: () => _scanMeters(data.currentShift!),
                onClose: () => _closeShift(data.currentShift!),
              ),
            const SizedBox(height: 18),
          ],
        ),
      ),
    );
  }

  Future<void> _openShift(ShiftBootstrap data) async {
    if (data.nozzles.isEmpty) {
      setState(() => _error = 'ไม่พบหัวจ่ายที่เปิดใช้งาน');
      return;
    }
    final openingFloat = _optionalNumber(_openingFloat.text) ?? 0;
    if (openingFloat < 0) {
      setState(() => _error = 'เงินทอนเริ่มกะต้องไม่ติดลบ');
      return;
    }
    final readings = <ShiftOpeningReading>[];
    for (final nozzle in data.nozzles) {
      final meter = double.tryParse(
        _openMeters[nozzle.id] ?? '${nozzle.currentMeter}',
      );
      final money = double.tryParse(
        _openMoney[nozzle.id] ?? '${nozzle.currentMoney}',
      );
      if (meter == null || money == null || meter < 0 || money < 0) {
        setState(() => _error = 'กรุณาตรวจเลขมิเตอร์ตั้งต้นให้ครบทุกหัวจ่าย');
        return;
      }
      readings.add(
        ShiftOpeningReading(
          nozzleId: nozzle.id,
          openMeter: meter,
          openMoney: money,
        ),
      );
    }

    setState(() {
      _submitting = true;
      _error = null;
      _notice = null;
    });
    try {
      await ref
          .read(shiftRepositoryProvider)
          .openShift(
            branchId: widget.staff.branch.id,
            staffId: widget.staff.id,
            staffName: widget.staff.name,
            openingFloat: openingFloat,
            readings: readings,
          );
      _openMeters.clear();
      _openMoney.clear();
      _openingFloat.clear();
      _refreshRelated();
      if (mounted) setState(() => _notice = 'เปิดกะเรียบร้อยแล้ว');
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _closeShift(CurrentShift shift) async {
    final readings = <ShiftClosingReading>[];
    for (final reading in shift.readings) {
      final meter = double.tryParse(_closeMeters[reading.nozzleId] ?? '');
      final money = double.tryParse(_closeMoney[reading.nozzleId] ?? '');
      if (meter == null || money == null) {
        setState(() => _error = 'กรุณากรอกเลขมิเตอร์ปิดกะให้ครบทุกหัวจ่าย');
        return;
      }
      if (meter < reading.openMeter || money < reading.openMoney) {
        setState(() {
          _error = 'เลขมิเตอร์ปลายทางต้องไม่น้อยกว่าเลขตั้งต้น';
        });
        return;
      }
      readings.add(
        ShiftClosingReading(
          nozzleId: reading.nozzleId,
          closeMeter: meter,
          closeMoney: money,
        ),
      );
    }
    final countedCash = _optionalNumber(_countedCash.text);
    final transfer = _optionalNumber(_transferAmount.text);
    final cashCounts = <String, int>{};
    for (final entry in _cashCounts.entries) {
      if (entry.value.trim().isEmpty) continue;
      final count = int.tryParse(entry.value.trim());
      if (count == null || count < 0) {
        setState(
          () => _error = 'จำนวนแบงก์และเหรียญต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป',
        );
        return;
      }
      if (count > 0) cashCounts[entry.key] = count;
    }
    if ((countedCash != null && countedCash < 0) ||
        (transfer != null && transfer < 0)) {
      setState(() => _error = 'ยอดเงินต้องไม่ติดลบ');
      return;
    }

    final preview = _ClosePreview.calculate(shift, _closeMeters, _closeMoney);
    final countedTotal = _shiftCountedTotal(
      countedCash: countedCash ?? 0,
      transferAmount: transfer ?? 0,
      posAmount: shift.posSales,
      expensesTotal: shift.expensesTotal,
    );
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('ยืนยันปิดกะ'),
        content: Text(
          'ยอดจากมิเตอร์เงิน ${_money(preview.money)}\n'
          'ยอด POS ทั้งหมด ${_money(shift.posSales)}\n'
          'รวมยอดกะ (P + POS ทั้งหมด) '
          '${_money(_shiftSalesTotal(preview, shift.posSales))}\n'
          'ปริมาณรวม ${_quantity(preview.liters)} ลิตร\n\n'
          'ยอดนับได้รวม ${_money(countedTotal)}\n'
          '= เงินสด + โอน + POS − ค่าใช้จ่าย\n\n'
          'เมื่อปิดกะแล้ว ระบบจะปรับมิเตอร์และสต็อกถังอัตโนมัติ',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('กลับไปตรวจ'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('ยืนยันปิดกะ'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() {
      _submitting = true;
      _error = null;
      _notice = null;
    });
    try {
      await ref
          .read(shiftRepositoryProvider)
          .closeShift(
            branchId: widget.staff.branch.id,
            shiftId: shift.id,
            readings: readings,
            countedCash: countedCash,
            transferAmount: transfer,
            cashCounts: cashCounts.isEmpty ? null : cashCounts,
            note: _note.text,
          );
      _closeMeters.clear();
      _closeMoney.clear();
      _countedCash.clear();
      _transferAmount.clear();
      _note.clear();
      _cashCounts.clear();
      _refreshRelated();
      if (mounted) setState(() => _notice = 'ปิดกะเรียบร้อยแล้ว');
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _scanMeters(CurrentShift shift) async {
    final values = await showShiftMeterScanner(
      context: context,
      repository: ref.read(shiftRepositoryProvider),
      branchId: widget.staff.branch.id,
      shift: shift,
    );
    if (values == null || !mounted) return;
    setState(() {
      for (final entry in values.entries) {
        if (entry.value.liters case final liters?) {
          _closeMeters[entry.key] = liters;
        }
        if (entry.value.money case final money?) {
          _closeMoney[entry.key] = money;
        }
      }
      _notice = 'นำค่าจากภาพมาใส่แล้ว กรุณาตรวจเทียบกับหน้าตู้ก่อนปิดกะ';
      _error = null;
    });
  }

  void _refreshRelated() {
    ref.invalidate(shiftBootstrapProvider(widget.staff.branch.id));
    ref.invalidate(posBootstrapProvider(widget.staff.branch.id));
    ref.invalidate(dashboardProvider(widget.staff.branch.id));
  }
}

class _OpenShiftForm extends StatelessWidget {
  const _OpenShiftForm({
    required this.nozzles,
    required this.openingFloat,
    required this.openMeters,
    required this.openMoney,
    required this.submitting,
    required this.onOpen,
  });

  final List<ShiftNozzle> nozzles;
  final TextEditingController openingFloat;
  final Map<int, String> openMeters;
  final Map<int, String> openMoney;
  final bool submitting;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const CircleAvatar(
                  backgroundColor: Color(0xFFE5F8EF),
                  foregroundColor: Color(0xFF138A58),
                  child: Icon(Icons.play_arrow_rounded),
                ),
                const SizedBox(width: 11),
                Expanded(
                  child: Text(
                    'เปิดกะใหม่',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            const Text(
              'ตรวจเลขสะสมหน้าตู้ก่อนเปิดกะ: L คือปริมาณลิตร และ P คือยอดเงิน',
            ),
            const SizedBox(height: 15),
            if (nozzles.isEmpty)
              const _StatusMessage(
                message: 'ไม่พบหัวจ่ายที่เปิดใช้งาน กรุณาตั้งค่าหัวจ่ายก่อน',
                success: false,
              )
            else
              LayoutBuilder(
                builder: (context, constraints) {
                  final columns = constraints.maxWidth >= 760 ? 2 : 1;
                  return GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: nozzles.length,
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: columns,
                      mainAxisSpacing: 10,
                      crossAxisSpacing: 10,
                      childAspectRatio: columns == 2 ? 2.2 : 1.75,
                    ),
                    itemBuilder: (context, index) {
                      final nozzle = nozzles[index];
                      return _OpeningNozzleCard(
                        nozzle: nozzle,
                        openMeters: openMeters,
                        openMoney: openMoney,
                      );
                    },
                  );
                },
              ),
            const SizedBox(height: 14),
            TextField(
              controller: openingFloat,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'เงินทอนเริ่มกะ (บาท)',
                prefixIcon: Icon(Icons.payments_outlined),
              ),
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: submitting || nozzles.isEmpty ? null : onOpen,
              icon: submitting
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.play_circle_outline_rounded),
              label: Padding(
                padding: const EdgeInsets.symmetric(vertical: 13),
                child: Text(submitting ? 'กำลังเปิดกะ...' : 'เปิดกะ'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OpeningNozzleCard extends StatelessWidget {
  const _OpeningNozzleCard({
    required this.nozzle,
    required this.openMeters,
    required this.openMoney,
  });

  final ShiftNozzle nozzle;
  final Map<int, String> openMeters;
  final Map<int, String> openMoney;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: const Color(0xFFE4E0EF)),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Padding(
        padding: const EdgeInsets.all(13),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              nozzle.label,
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
            Text(
              '${nozzle.pumpName} · ${nozzle.productName}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 9),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    key: ValueKey('open-l-${nozzle.id}-${nozzle.currentMeter}'),
                    initialValue: '${nozzle.currentMeter}',
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    onChanged: (value) => openMeters[nozzle.id] = value,
                    decoration: const InputDecoration(
                      labelText: 'L ตั้งต้น',
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextFormField(
                    key: ValueKey('open-p-${nozzle.id}-${nozzle.currentMoney}'),
                    initialValue: '${nozzle.currentMoney}',
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    onChanged: (value) => openMoney[nozzle.id] = value,
                    decoration: const InputDecoration(
                      labelText: 'P ตั้งต้น',
                      isDense: true,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _CloseShiftForm extends StatelessWidget {
  const _CloseShiftForm({
    required this.shift,
    required this.countedCash,
    required this.transferAmount,
    required this.note,
    required this.closeMeters,
    required this.closeMoney,
    required this.cashCounts,
    required this.submitting,
    required this.onCashCountChanged,
    required this.onScanMeters,
    required this.onClose,
  });

  final CurrentShift shift;
  final TextEditingController countedCash;
  final TextEditingController transferAmount;
  final TextEditingController note;
  final Map<int, String> closeMeters;
  final Map<int, String> closeMoney;
  final Map<String, String> cashCounts;
  final bool submitting;
  final void Function(String denomination, String count) onCashCountChanged;
  final VoidCallback onScanMeters;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const CircleAvatar(
                  backgroundColor: Color(0xFFFFEEEE),
                  foregroundColor: Color(0xFFB42318),
                  child: Icon(Icons.stop_rounded),
                ),
                const SizedBox(width: 11),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'กะ #${shift.id} กำลังเปิดอยู่',
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      Text(
                        'เปิดโดย ${shift.staffName}${shift.openedAt == null ? '' : ' · ${DateFormat('d MMM y HH:mm', 'th_TH').format(shift.openedAt!.toLocal())}'}',
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 13),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF7E5),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Row(
                children: [
                  const Icon(Icons.account_balance_wallet_outlined),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'เงินทอนเริ่มกะ ${_money(shift.openingFloat)} · เงินสดที่ควรมี ${_money(shift.expectedCash)}',
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            AnimatedBuilder(
              animation: Listenable.merge([countedCash, transferAmount]),
              builder: (context, _) {
                final cash = _optionalNumber(countedCash.text) ?? 0;
                final transfer = _optionalNumber(transferAmount.text) ?? 0;
                final total = _shiftCountedTotal(
                  countedCash: cash,
                  transferAmount: transfer,
                  posAmount: shift.posSales,
                  expensesTotal: shift.expensesTotal,
                );
                return Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEAF8EF),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: const Color(0xFFB8E2C8)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'เงินสด ${_money(cash)} + โอน ${_money(transfer)} '
                        '+ POS ${_money(shift.posSales)} − ค่าใช้จ่าย ${_money(shift.expensesTotal)}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'ยอดนับได้รวม ${_money(total)}',
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(
                              color: const Color(0xFF087443),
                              fontWeight: FontWeight.w900,
                            ),
                      ),
                    ],
                  ),
                );
              },
            ),
            const SizedBox(height: 14),
            OutlinedButton.icon(
              onPressed: submitting ? null : onScanMeters,
              icon: const Icon(Icons.document_scanner_outlined),
              label: const Padding(
                padding: EdgeInsets.symmetric(vertical: 11),
                child: Text('อ่านมิเตอร์ L/P จากรูปภาพด้วย AI'),
              ),
            ),
            const SizedBox(height: 12),
            for (final reading in shift.readings)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _ClosingNozzleCard(
                  reading: reading,
                  closeMeters: closeMeters,
                  closeMoney: closeMoney,
                ),
              ),
            const SizedBox(height: 4),
            ExpansionTile(
              tilePadding: EdgeInsets.zero,
              childrenPadding: const EdgeInsets.only(bottom: 12),
              leading: const Icon(Icons.account_balance_wallet_outlined),
              title: const Text(
                'นับเงินสดแยกแบงก์ / เหรียญ',
                style: TextStyle(fontWeight: FontWeight.w800),
              ),
              subtitle: Text('รวม ${_money(_cashCountTotal(cashCounts))}'),
              children: [
                for (final denomination in _cashDenominations)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 7),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 116,
                          child: Text(_cashDenominationLabel(denomination)),
                        ),
                        SizedBox(
                          width: 92,
                          child: TextFormField(
                            key: ValueKey('cash-count-$denomination'),
                            initialValue: cashCounts[denomination],
                            keyboardType: TextInputType.number,
                            textAlign: TextAlign.right,
                            decoration: const InputDecoration(
                              hintText: '0',
                              isDense: true,
                            ),
                            onChanged: (value) =>
                                onCashCountChanged(denomination, value),
                          ),
                        ),
                        const SizedBox(width: 8),
                        const Text('×'),
                        const Spacer(),
                        Text(
                          _money(
                            (double.tryParse(denomination) ?? 0) *
                                (int.tryParse(cashCounts[denomination] ?? '') ??
                                    0),
                          ),
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            LayoutBuilder(
              builder: (context, constraints) {
                final wide = constraints.maxWidth >= 620;
                final fields = [
                  TextField(
                    controller: countedCash,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(
                      labelText: 'เงินสดที่นับได้ (บาท)',
                      prefixIcon: Icon(Icons.payments_outlined),
                    ),
                  ),
                  TextField(
                    controller: transferAmount,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(
                      labelText: 'ยอดเงินโอน (บาท)',
                      prefixIcon: Icon(Icons.account_balance_outlined),
                    ),
                  ),
                ];
                return wide
                    ? Row(
                        children: [
                          Expanded(child: fields[0]),
                          const SizedBox(width: 10),
                          Expanded(child: fields[1]),
                        ],
                      )
                    : Column(
                        children: [
                          fields[0],
                          const SizedBox(height: 10),
                          fields[1],
                        ],
                      );
              },
            ),
            const SizedBox(height: 10),
            TextField(
              controller: note,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'หมายเหตุ (ไม่บังคับ)',
                prefixIcon: Icon(Icons.note_alt_outlined),
              ),
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFB42318),
              ),
              onPressed: submitting ? null : onClose,
              icon: submitting
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.stop_circle_outlined),
              label: Padding(
                padding: const EdgeInsets.symmetric(vertical: 13),
                child: Text(submitting ? 'กำลังปิดกะ...' : 'ตรวจสอบและปิดกะ'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ClosingNozzleCard extends StatelessWidget {
  const _ClosingNozzleCard({
    required this.reading,
    required this.closeMeters,
    required this.closeMoney,
  });

  final ShiftReading reading;
  final Map<int, String> closeMeters;
  final Map<int, String> closeMoney;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(
          color: reading.priceChangedDuringShift
              ? const Color(0xFFF2C66D)
              : const Color(0xFFE4E0EF),
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Padding(
        padding: const EdgeInsets.all(13),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              reading.label,
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
            Text(
              '${reading.pumpName} · ${reading.productName} · ${_money(reading.pricePerLiter)}/ลิตร',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 9),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    key: ValueKey(
                      'close-l-${reading.nozzleId}-${closeMeters[reading.nozzleId]}',
                    ),
                    initialValue: closeMeters[reading.nozzleId],
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    onChanged: (value) => closeMeters[reading.nozzleId] = value,
                    decoration: InputDecoration(
                      labelText: 'L ปลายทาง',
                      hintText: 'เริ่ม ${_quantity(reading.openMeter)}',
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextFormField(
                    key: ValueKey(
                      'close-p-${reading.nozzleId}-${closeMoney[reading.nozzleId]}',
                    ),
                    initialValue: closeMoney[reading.nozzleId],
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    onChanged: (value) => closeMoney[reading.nozzleId] = value,
                    decoration: InputDecoration(
                      labelText: 'P ปลายทาง',
                      hintText: 'เริ่ม ${_quantity(reading.openMoney)}',
                      isDense: true,
                    ),
                  ),
                ),
              ],
            ),
            if (reading.priceChangedDuringShift) ...[
              const SizedBox(height: 7),
              const Text(
                'ราคามีการเปลี่ยนระหว่างกะ โปรดตรวจค่า P เป็นพิเศษ',
                style: TextStyle(
                  color: Color(0xFF9A6100),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ClosePreview {
  const _ClosePreview({
    required this.liters,
    required this.amount,
    required this.money,
  });

  factory _ClosePreview.calculate(
    CurrentShift shift,
    Map<int, String> closeMeters,
    Map<int, String> closeMoney,
  ) {
    var liters = 0.0;
    var amount = 0.0;
    var money = 0.0;
    for (final reading in shift.readings) {
      final meter = double.tryParse(closeMeters[reading.nozzleId] ?? '');
      final pValue = double.tryParse(closeMoney[reading.nozzleId] ?? '');
      if (meter != null) {
        final readingLiters = meter - reading.openMeter;
        liters += readingLiters;
        amount += readingLiters * reading.pricePerLiter;
      }
      if (pValue != null) money += pValue - reading.openMoney;
    }
    return _ClosePreview(liters: liters, amount: amount, money: money);
  }

  final double liters;
  final double amount;
  final double money;
}

class _StatusMessage extends StatelessWidget {
  const _StatusMessage({required this.message, required this.success});

  final String message;
  final bool success;

  @override
  Widget build(BuildContext context) {
    final foreground = success
        ? const Color(0xFF087443)
        : const Color(0xFFB42318);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: success ? const Color(0xFFEAF8F1) : const Color(0xFFFFEEEE),
        borderRadius: BorderRadius.circular(13),
      ),
      child: Row(
        children: [
          Icon(
            success ? Icons.check_circle_outline_rounded : Icons.error_outline,
            color: foreground,
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Text(message, style: TextStyle(color: foreground)),
          ),
        ],
      ),
    );
  }
}

class _ScrollableCenter extends StatelessWidget {
  const _ScrollableCenter({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.65,
          child: Center(child: child),
        ),
      ],
    );
  }
}

const _cashDenominations = <String>[
  '1000',
  '500',
  '100',
  '50',
  '20',
  '10',
  '5',
  '2',
  '1',
  '0.5',
  '0.25',
];

double _cashCountTotal(Map<String, String> counts) {
  var total = 0.0;
  for (final denomination in _cashDenominations) {
    total +=
        (double.tryParse(denomination) ?? 0) *
        (int.tryParse(counts[denomination] ?? '') ?? 0);
  }
  return (total * 100).roundToDouble() / 100;
}

double _shiftCountedTotal({
  required double countedCash,
  required double transferAmount,
  required double posAmount,
  required double expensesTotal,
}) {
  final total = countedCash + transferAmount + posAmount - expensesTotal;
  return (total * 100).roundToDouble() / 100;
}

double _shiftSalesTotal(_ClosePreview preview, double posAmount) {
  final meterAmount = preview.money > 0 ? preview.money : preview.amount;
  return ((meterAmount + posAmount) * 100).roundToDouble() / 100;
}

String _cashDenominationLabel(String denomination) {
  final value = double.tryParse(denomination) ?? 0;
  if (value >= 20) return 'แบงก์ ${_quantity(value)}';
  if (value >= 1) return 'เหรียญ ${_quantity(value)}';
  return 'เหรียญ ${_quantity(value * 100)} สต.';
}

double? _optionalNumber(String value) {
  final trimmed = value.trim();
  return trimmed.isEmpty ? null : double.tryParse(trimmed);
}

String _money(double value) =>
    NumberFormat.currency(locale: 'th_TH', symbol: '฿').format(value);

String _quantity(double value) => NumberFormat('0.###', 'th_TH').format(value);
