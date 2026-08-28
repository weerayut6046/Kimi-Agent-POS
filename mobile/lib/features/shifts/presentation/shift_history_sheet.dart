import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../auth/domain/staff_session.dart';
import '../data/shift_repository.dart';

Future<void> showShiftHistorySheet({
  required BuildContext context,
  required StaffSession staff,
  required ShiftRepository repository,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (context) => FractionallySizedBox(
      heightFactor: .96,
      child: _ShiftHistorySheet(staff: staff, repository: repository),
    ),
  );
}

class _ShiftHistorySheet extends StatefulWidget {
  const _ShiftHistorySheet({required this.staff, required this.repository});

  final StaffSession staff;
  final ShiftRepository repository;

  @override
  State<_ShiftHistorySheet> createState() => _ShiftHistorySheetState();
}

class _ShiftHistorySheetState extends State<_ShiftHistorySheet> {
  late DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String? _error;

  bool get _isAdmin => widget.staff.role == StaffRole.admin;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final month = DateFormat('yyyy-MM').format(_month);
      final result = await widget.repository.queryProcedure(
        _isAdmin ? 'pos.searchShiftHistory' : 'pos.shiftHistory',
        branchId: widget.staff.branch.id,
        input: <String, Object?>{'month': month, 'limit': 200},
      );
      if (!mounted) return;
      setState(() => _rows = _maps(result));
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _changeMonth(int offset) {
    setState(() => _month = DateTime(_month.year, _month.month + offset));
    unawaited(_load());
  }

  Future<void> _create() async {
    final now = DateTime.now();
    final changed = await _showHistoryForm(
      context: context,
      repository: widget.repository,
      staff: widget.staff,
      initial: <String, dynamic>{
        'staffName': widget.staff.name,
        'openedAt': now.subtract(const Duration(hours: 8)).toIso8601String(),
        'closedAt': now.toIso8601String(),
        'totalLiters': 0,
        'totalAmount': 0,
        'totalMoneyMeter': 0,
        'posAmount': 0,
        'openingFloat': 0,
      },
    );
    if (changed == true) unawaited(_load());
  }

  Future<void> _open(Map<String, dynamic> row) async {
    final id = _int(row['id']);
    if (id <= 0) return;
    final changed = await _showShiftDetail(
      context: context,
      repository: widget.repository,
      staff: widget.staff,
      id: id,
    );
    if (changed == true) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: const Color(0xFFF7F6FB),
      borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(18, 12, 10, 15),
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [Color(0xFF17133D), Color(0xFF4433A5)],
              ),
            ),
            child: Row(
              children: [
                const CircleAvatar(
                  backgroundColor: Color(0x22FFFFFF),
                  foregroundColor: Colors.white,
                  child: Icon(Icons.history_rounded),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'ประวัติการตัดกะ',
                        style: theme.textTheme.titleLarge?.copyWith(
                          color: Colors.white,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      Text(
                        'ตรวจสอบยอดขาย มิเตอร์ และเงินสดของแต่ละกะ',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: const Color(0xFFD9D4FF),
                        ),
                      ),
                    ],
                  ),
                ),
                if (_isAdmin)
                  IconButton.filledTonal(
                    tooltip: 'เพิ่มประวัติกะ',
                    onPressed: _create,
                    icon: const Icon(Icons.add_rounded),
                  ),
                IconButton(
                  tooltip: 'ปิด',
                  color: Colors.white,
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close_rounded),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 6),
            child: Row(
              children: [
                IconButton.filledTonal(
                  onPressed: () => _changeMonth(-1),
                  icon: const Icon(Icons.chevron_left_rounded),
                ),
                Expanded(
                  child: Text(
                    DateFormat('MMMM yyyy', 'th_TH').format(_month),
                    textAlign: TextAlign.center,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                IconButton.filledTonal(
                  onPressed: () => _changeMonth(1),
                  icon: const Icon(Icons.chevron_right_rounded),
                ),
              ],
            ),
          ),
          Expanded(child: _buildBody(theme)),
        ],
      ),
    );
  }

  Widget _buildBody(ThemeData theme) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_rounded, size: 44),
              const SizedBox(height: 10),
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton.tonalIcon(
                onPressed: _load,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('ลองอีกครั้ง'),
              ),
            ],
          ),
        ),
      );
    }
    if (_rows.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text('ยังไม่มีประวัติกะในเดือนนี้'),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
        itemCount: _rows.length,
        separatorBuilder: (_, _) => const SizedBox(height: 9),
        itemBuilder: (context, index) {
          final row = _rows[index];
          final closed = _text(row['status']) == 'closed';
          return Card(
            margin: EdgeInsets.zero,
            child: InkWell(
              borderRadius: BorderRadius.circular(18),
              onTap: () => _open(row),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: closed
                          ? const Color(0xFFE5F8EF)
                          : const Color(0xFFFFF3D6),
                      foregroundColor: closed
                          ? const Color(0xFF087443)
                          : const Color(0xFF9A6100),
                      child: Icon(
                        closed ? Icons.check_rounded : Icons.schedule_rounded,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '#${_int(row['id'])} · ${_text(row['staffName'], fallback: 'ไม่ระบุพนักงาน')}',
                            style: const TextStyle(fontWeight: FontWeight.w900),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            '${_dateTime(row['openedAt'])} – ${_dateTime(row['closedAt'])}',
                            style: theme.textTheme.bodySmall,
                          ),
                          const SizedBox(height: 5),
                          Wrap(
                            spacing: 12,
                            runSpacing: 3,
                            children: [
                              Text(
                                'ยอดกะ ${_money(_num(row['totalMoneyMeter']) > 0 ? _num(row['totalMoneyMeter']) : _num(row['totalAmount']))}',
                              ),
                              Text(
                                '${_quantity(_num(row['totalLiters']))} ลิตร',
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.chevron_right_rounded),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

Future<bool?> _showShiftDetail({
  required BuildContext context,
  required ShiftRepository repository,
  required StaffSession staff,
  required int id,
}) async {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (context) => FractionallySizedBox(
      heightFactor: .92,
      child: _ShiftDetailSheet(repository: repository, staff: staff, id: id),
    ),
  );
}

class _ShiftDetailSheet extends StatefulWidget {
  const _ShiftDetailSheet({
    required this.repository,
    required this.staff,
    required this.id,
  });

  final ShiftRepository repository;
  final StaffSession staff;
  final int id;

  @override
  State<_ShiftDetailSheet> createState() => _ShiftDetailSheetState();
}

class _ShiftDetailSheetState extends State<_ShiftDetailSheet> {
  Map<String, dynamic>? _detail;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final result = await widget.repository.queryProcedure(
        'pos.shiftDetail',
        branchId: widget.staff.branch.id,
        input: {'id': widget.id},
      );
      if (mounted) setState(() => _detail = _map(result));
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  Future<void> _edit() async {
    final detail = _detail;
    if (detail == null) return;
    final changed = await _showHistoryForm(
      context: context,
      repository: widget.repository,
      staff: widget.staff,
      initial: detail,
    );
    if (changed == true && mounted) {
      await _load();
      if (mounted) Navigator.pop(context, true);
    }
  }

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('ลบประวัติกะ #${widget.id}?'),
        content: const Text(
          'รายการขายและเอกสารการเงินจะยังอยู่ แต่จะไม่ผูกกับกะนี้อีก',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('ยกเลิก'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFB42318),
            ),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('ลบประวัติ'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await widget.repository.mutateProcedure(
        'pos.deleteShiftHistory',
        branchId: widget.staff.branch.id,
        input: {'id': widget.id},
      );
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = '$error';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    return Scaffold(
      appBar: AppBar(
        title: Text('รายละเอียดกะ #${widget.id}'),
        actions: [
          if (widget.staff.role == StaffRole.admin && detail != null) ...[
            IconButton(
              tooltip: 'แก้ไข',
              onPressed: _busy ? null : _edit,
              icon: const Icon(Icons.edit_outlined),
            ),
            IconButton(
              tooltip: 'ลบ',
              onPressed: _busy ? null : _delete,
              icon: const Icon(Icons.delete_outline_rounded),
            ),
          ],
        ],
      ),
      body: _error != null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(_error!),
              ),
            )
          : detail == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(14, 8, 14, 28),
              children: [
                _DetailCard(
                  title: 'ข้อมูลกะ',
                  icon: Icons.badge_outlined,
                  children: [
                    _InfoRow('พนักงาน', _text(detail['staffName'])),
                    _InfoRow('เปิดกะ', _dateTime(detail['openedAt'])),
                    _InfoRow('ปิดกะ', _dateTime(detail['closedAt'])),
                    _InfoRow('สถานะ', _text(detail['status'])),
                  ],
                ),
                _DetailCard(
                  title: 'สรุปยอด',
                  icon: Icons.analytics_outlined,
                  children: [
                    _InfoRow(
                      'รวมลิตร',
                      '${_quantity(_num(detail['totalLiters']))} ลิตร',
                    ),
                    _InfoRow('ยอดจากลิตร', _money(_num(detail['totalAmount']))),
                    _InfoRow(
                      'ยอดจากมิเตอร์ P',
                      _money(_num(detail['totalMoneyMeter'])),
                    ),
                    _InfoRow('ยอด POS', _money(_num(detail['posAmount']))),
                    _InfoRow(
                      'น้ำมันเครื่อง',
                      _money(_num(detail['lubricantAmount'])),
                    ),
                  ],
                ),
                _DetailCard(
                  title: 'เงินสดและเงินโอน',
                  icon: Icons.payments_outlined,
                  children: [
                    _InfoRow(
                      'เงินทอนเริ่มกะ',
                      _money(_num(detail['openingFloat'])),
                    ),
                    _InfoRow(
                      'เงินสดที่ควรมี',
                      _nullableMoney(detail['expectedCash']),
                    ),
                    _InfoRow(
                      'เงินสดที่นับได้',
                      _nullableMoney(detail['countedCash']),
                    ),
                    if (_mapOrEmpty(detail['cashCounts']).isNotEmpty) ...[
                      const Divider(height: 22),
                      for (final denomination in _cashDenominations)
                        if (_int(
                              _mapOrEmpty(detail['cashCounts'])[denomination],
                            ) >
                            0)
                          _InfoRow(
                            '${_cashDenominationLabel(denomination)} × '
                            '${_int(_mapOrEmpty(detail['cashCounts'])[denomination])}',
                            _money(
                              double.parse(denomination) *
                                  _int(
                                    _mapOrEmpty(
                                      detail['cashCounts'],
                                    )[denomination],
                                  ),
                            ),
                          ),
                    ],
                    _InfoRow(
                      'ยอดเงินโอน',
                      _nullableMoney(detail['transferAmount']),
                    ),
                    _InfoRow(
                      'ผลต่างเทียบ P',
                      _nullableMoney(detail['cashDiffP']),
                    ),
                  ],
                ),
                if (_maps(detail['readings']).isNotEmpty)
                  _DetailCard(
                    title: 'มิเตอร์หัวจ่าย',
                    icon: Icons.speed_rounded,
                    children: [
                      for (final reading in _maps(detail['readings']))
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            _text(
                              _mapOrEmpty(reading['nozzle'])['label'],
                              fallback: 'หัวจ่าย #${_int(reading['nozzleId'])}',
                            ),
                            style: const TextStyle(fontWeight: FontWeight.w800),
                          ),
                          subtitle: Text(
                            'L ${_quantity(_num(reading['openMeter']))} → ${_quantity(_num(reading['closeMeter']))}\n'
                            'P ${_money(_num(reading['openMoney']))} → ${_money(_num(reading['closeMoney']))}',
                          ),
                          trailing: Text(
                            '${_quantity(_num(reading['liters']))} L\n${_money(_num(reading['money']))}',
                            textAlign: TextAlign.right,
                          ),
                        ),
                    ],
                  ),
                if (_maps(detail['sales']).isNotEmpty)
                  _DetailCard(
                    title: 'รายการขายในกะ',
                    icon: Icons.receipt_long_outlined,
                    children: [
                      for (final sale in _maps(detail['sales']))
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            _text(
                              sale['receiptNo'],
                              fallback: 'บิล #${_int(sale['id'])}',
                            ),
                          ),
                          subtitle: Text(
                            '${_text(sale['paymentMethod'])} · ${_dateTime(sale['createdAt'])}',
                          ),
                          trailing: Text(
                            _money(_num(sale['total'])),
                            style: const TextStyle(fontWeight: FontWeight.w900),
                          ),
                        ),
                    ],
                  ),
                if (_text(detail['note']).isNotEmpty)
                  _DetailCard(
                    title: 'หมายเหตุ',
                    icon: Icons.note_alt_outlined,
                    children: [Text(_text(detail['note']))],
                  ),
              ],
            ),
    );
  }
}

class _DetailCard extends StatelessWidget {
  const _DetailCard({
    required this.title,
    required this.icon,
    required this.children,
  });

  final String title;
  final IconData icon;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(15),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(icon, color: const Color(0xFF6554D9)),
                const SizedBox(width: 8),
                Text(
                  title,
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
              ],
            ),
            const Divider(height: 22),
            ...children,
          ],
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(label, style: Theme.of(context).textTheme.bodySmall),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
    );
  }
}

Future<bool?> _showHistoryForm({
  required BuildContext context,
  required ShiftRepository repository,
  required StaffSession staff,
  required Map<String, dynamic> initial,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (context) => FractionallySizedBox(
      heightFactor: .94,
      child: _HistoryForm(
        repository: repository,
        staff: staff,
        initial: initial,
      ),
    ),
  );
}

class _HistoryForm extends StatefulWidget {
  const _HistoryForm({
    required this.repository,
    required this.staff,
    required this.initial,
  });

  final ShiftRepository repository;
  final StaffSession staff;
  final Map<String, dynamic> initial;

  @override
  State<_HistoryForm> createState() => _HistoryFormState();
}

class _HistoryFormState extends State<_HistoryForm> {
  final _formKey = GlobalKey<FormState>();
  late final Map<String, TextEditingController> _controllers;
  late final Map<String, TextEditingController> _cashCountControllers;
  late final bool _hadCashCounts;
  late DateTime _openedAt;
  late DateTime _closedAt;
  bool _cashCountsEdited = false;
  bool _busy = false;
  String? _error;

  bool get _editing => _int(widget.initial['id']) > 0;

  @override
  void initState() {
    super.initState();
    _openedAt =
        _date(widget.initial['openedAt']) ??
        DateTime.now().subtract(const Duration(hours: 8));
    _closedAt = _date(widget.initial['closedAt']) ?? DateTime.now();
    _controllers = {
      for (final key in const [
        'staffName',
        'totalLiters',
        'totalAmount',
        'totalMoneyMeter',
        'posAmount',
        'openingFloat',
        'countedCash',
        'transferAmount',
        'expectedCash',
        'note',
      ])
        key: TextEditingController(text: _initialText(widget.initial[key])),
    };
    final initialCashCounts = _mapOrEmpty(widget.initial['cashCounts']);
    _hadCashCounts = initialCashCounts.isNotEmpty;
    _cashCountControllers = {
      for (final denomination in _cashDenominations)
        denomination: TextEditingController(
          text: _int(initialCashCounts[denomination]) == 0
              ? ''
              : '${_int(initialCashCounts[denomination])}',
        ),
    };
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    for (final controller in _cashCountControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Map<String, int> get _cashCounts => {
    for (final entry in _cashCountControllers.entries)
      if ((int.tryParse(entry.value.text.trim()) ?? 0) > 0)
        entry.key: int.parse(entry.value.text.trim()),
  };

  double get _cashCountTotal => _cashCounts.entries.fold(
    0,
    (total, entry) => total + double.parse(entry.key) * entry.value,
  );

  void _cashCountChanged() {
    _cashCountsEdited = true;
    final total = _cashCountTotal;
    _controllers['countedCash']!.text = total == 0
        ? ''
        : total.toStringAsFixed(2);
    setState(() {});
  }

  Future<void> _pickDateTime(bool opening) async {
    final current = opening ? _openedAt : _closedAt;
    final date = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 366)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(current),
    );
    if (time == null) return;
    setState(() {
      final value = DateTime(
        date.year,
        date.month,
        date.day,
        time.hour,
        time.minute,
      );
      if (opening) {
        _openedAt = value;
      } else {
        _closedAt = value;
      }
    });
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_closedAt.isBefore(_openedAt)) {
      setState(() => _error = 'เวลาปิดกะต้องไม่ก่อนเวลาเปิดกะ');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final input = <String, Object?>{
        if (_editing) 'id': _int(widget.initial['id']),
        'staffId': widget.initial['staffId'] == null
            ? null
            : _int(widget.initial['staffId']),
        'staffName': _controllers['staffName']!.text.trim(),
        'openedAt': _openedAt.toUtc().toIso8601String(),
        'closedAt': _closedAt.toUtc().toIso8601String(),
        for (final key in const [
          'totalLiters',
          'totalAmount',
          'totalMoneyMeter',
          'posAmount',
          'openingFloat',
        ])
          key: double.parse(_controllers[key]!.text.trim()),
        for (final key in const [
          'countedCash',
          'transferAmount',
          'expectedCash',
        ])
          key: _optionalNumber(_controllers[key]!.text),
        'note': _controllers['note']!.text.trim().isEmpty
            ? null
            : _controllers['note']!.text.trim(),
        if (_hadCashCounts || _cashCountsEdited)
          'cashCounts': _cashCounts.isEmpty ? null : _cashCounts,
      };
      await widget.repository.mutateProcedure(
        _editing ? 'pos.updateShiftHistory' : 'pos.createShiftHistory',
        branchId: widget.staff.branch.id,
        input: input,
      );
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_editing ? 'แก้ไขประวัติกะ' : 'เพิ่มประวัติกะ'),
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: EdgeInsets.fromLTRB(
            16,
            10,
            16,
            24 + MediaQuery.viewInsetsOf(context).bottom,
          ),
          children: [
            if (_error != null)
              Container(
                margin: const EdgeInsets.only(bottom: 12),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFEEEE),
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Text(
                  _error!,
                  style: const TextStyle(color: Color(0xFFB42318)),
                ),
              ),
            TextFormField(
              controller: _controllers['staffName'],
              decoration: const InputDecoration(
                labelText: 'ชื่อพนักงาน *',
                prefixIcon: Icon(Icons.person_outline_rounded),
              ),
              validator: (value) => value == null || value.trim().isEmpty
                  ? 'กรุณากรอกชื่อพนักงาน'
                  : null,
            ),
            const SizedBox(height: 10),
            _DateTimeTile(
              label: 'เวลาเปิดกะ',
              value: _openedAt,
              onTap: () => _pickDateTime(true),
            ),
            const SizedBox(height: 8),
            _DateTimeTile(
              label: 'เวลาปิดกะ',
              value: _closedAt,
              onTap: () => _pickDateTime(false),
            ),
            const SizedBox(height: 18),
            Text(
              'สรุปยอดกะ',
              style: Theme.of(
                context,
              ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 10),
            for (final entry in const <(String, String)>[
              ('totalLiters', 'รวมลิตร'),
              ('totalAmount', 'ยอดจากลิตร'),
              ('totalMoneyMeter', 'ยอดจากมิเตอร์ P'),
              ('posAmount', 'ยอด POS'),
              ('openingFloat', 'เงินทอนเริ่มกะ'),
              ('countedCash', 'เงินสดที่นับได้ (เว้นว่างได้)'),
              ('transferAmount', 'ยอดเงินโอน (เว้นว่างได้)'),
              ('expectedCash', 'เงินสดที่ควรมี (เว้นว่างได้)'),
            ]) ...[
              TextFormField(
                controller: _controllers[entry.$1],
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: InputDecoration(
                  labelText: entry.$2,
                  prefixIcon: Icon(
                    entry.$1 == 'totalLiters'
                        ? Icons.water_drop_outlined
                        : Icons.payments_outlined,
                  ),
                ),
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return const {
                          'countedCash',
                          'transferAmount',
                          'expectedCash',
                        }.contains(entry.$1)
                        ? null
                        : 'กรุณากรอกตัวเลข';
                  }
                  final parsed = double.tryParse(value.trim());
                  return parsed == null || parsed < 0
                      ? 'ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'
                      : null;
                },
              ),
              const SizedBox(height: 10),
            ],
            Card(
              margin: const EdgeInsets.only(bottom: 12),
              child: ExpansionTile(
                leading: const Icon(Icons.calculate_outlined),
                title: const Text(
                  'นับเงินสดแยกธนบัตรและเหรียญ',
                  style: TextStyle(fontWeight: FontWeight.w800),
                ),
                subtitle: Text(
                  _cashCountTotal == 0
                      ? 'แตะเพื่อกรอกจำนวนแต่ละชนิด'
                      : 'รวม ${_money(_cashCountTotal)}',
                ),
                childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
                children: [
                  const Text(
                    'เมื่อกรอก ระบบจะคำนวณช่อง “เงินสดที่นับได้” ให้อัตโนมัติ',
                  ),
                  const SizedBox(height: 10),
                  for (final denomination in _cashDenominations) ...[
                    TextFormField(
                      controller: _cashCountControllers[denomination],
                      keyboardType: TextInputType.number,
                      decoration: InputDecoration(
                        labelText: _cashDenominationLabel(denomination),
                        suffixText: 'ใบ/เหรียญ',
                      ),
                      onChanged: (_) => _cashCountChanged(),
                      validator: (value) {
                        final text = value?.trim() ?? '';
                        if (text.isEmpty) return null;
                        final count = int.tryParse(text);
                        return count == null || count < 0
                            ? 'กรอกจำนวนเต็มตั้งแต่ 0 ขึ้นไป'
                            : null;
                      },
                    ),
                    const SizedBox(height: 8),
                  ],
                ],
              ),
            ),
            TextFormField(
              controller: _controllers['note'],
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'หมายเหตุ',
                prefixIcon: Icon(Icons.note_alt_outlined),
              ),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _busy ? null : _save,
              icon: _busy
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.save_outlined),
              label: Padding(
                padding: const EdgeInsets.symmetric(vertical: 13),
                child: Text(_busy ? 'กำลังบันทึก...' : 'บันทึกประวัติกะ'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DateTimeTile extends StatelessWidget {
  const _DateTimeTile({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final DateTime value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      shape: RoundedRectangleBorder(
        side: const BorderSide(color: Color(0xFFE2DFEA)),
        borderRadius: BorderRadius.circular(14),
      ),
      leading: const Icon(Icons.event_outlined),
      title: Text(label),
      subtitle: Text(DateFormat('d MMM yyyy HH:mm', 'th_TH').format(value)),
      trailing: const Icon(Icons.edit_calendar_outlined),
      onTap: onTap,
    );
  }
}

Map<String, dynamic> _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  throw const FormatException('Invalid JSON object');
}

Map<String, dynamic> _mapOrEmpty(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return const {};
}

List<Map<String, dynamic>> _maps(Object? value) => value is List
    ? value
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList()
    : const [];

String _text(Object? value, {String fallback = ''}) {
  final result = value?.toString().trim() ?? '';
  return result.isEmpty || result == 'null' ? fallback : result;
}

int _int(Object? value) =>
    value is num ? value.toInt() : int.tryParse('$value') ?? 0;

double _num(Object? value) =>
    value is num ? value.toDouble() : double.tryParse('$value') ?? 0;

double? _optionalNumber(String value) {
  final text = value.trim();
  return text.isEmpty ? null : double.tryParse(text);
}

DateTime? _date(Object? value) {
  if (value is DateTime) return value.toLocal();
  return DateTime.tryParse('$value')?.toLocal();
}

String _dateTime(Object? value) {
  final date = _date(value);
  return date == null
      ? '-'
      : DateFormat('d MMM yy HH:mm', 'th_TH').format(date);
}

String _initialText(Object? value) {
  if (value == null) return '';
  if (value is num) return NumberFormat('0.###').format(value);
  return '$value';
}

String _money(double value) => NumberFormat.currency(
  locale: 'th_TH',
  symbol: '฿',
  decimalDigits: 2,
).format(value);

String _nullableMoney(Object? value) =>
    value == null ? '-' : _money(_num(value));

String _quantity(double value) => NumberFormat('0.###', 'th_TH').format(value);

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

String _cashDenominationLabel(String value) {
  final amount = double.parse(value);
  if (amount >= 20) return 'ธนบัตร ${amount.toStringAsFixed(0)} บาท';
  if (amount >= 1) return 'เหรียญ ${amount.toStringAsFixed(0)} บาท';
  return 'เหรียญ ${(amount * 100).toStringAsFixed(0)} สตางค์';
}
