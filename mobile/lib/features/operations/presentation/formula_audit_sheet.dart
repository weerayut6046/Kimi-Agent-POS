import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../auth/domain/staff_session.dart';
import '../data/operations_repository.dart';

Future<bool> showFormulaAuditSheet({
  required BuildContext context,
  required OperationsRepository repository,
  required StaffSession staff,
}) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (context) => FractionallySizedBox(
      heightFactor: .96,
      child: _FormulaAuditSheet(repository: repository, staff: staff),
    ),
  );
  return false;
}

class _FormulaAuditSheet extends StatefulWidget {
  const _FormulaAuditSheet({required this.repository, required this.staff});

  final OperationsRepository repository;
  final StaffSession staff;

  @override
  State<_FormulaAuditSheet> createState() => _FormulaAuditSheetState();
}

class _FormulaAuditSheetState extends State<_FormulaAuditSheet> {
  int _days = 30;
  Map<String, dynamic>? _report;
  Map<String, dynamic>? _analysis;
  Map<String, dynamic>? _plan;
  Map<String, dynamic>? _workOrder;
  bool _loading = true;
  bool _busy = false;
  String? _error;

  int get _branchId => widget.staff.branch.id;

  @override
  void initState() {
    super.initState();
    _loadReport();
  }

  Future<void> _loadReport() async {
    setState(() {
      _loading = true;
      _error = null;
      _analysis = null;
      _plan = null;
      _workOrder = null;
    });
    try {
      final result = await widget.repository.queryProcedure(
        'audit.formulaAudit',
        branchId: _branchId,
        input: {'days': _days},
      );
      if (mounted) setState(() => _report = _map(result));
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<Map<String, dynamic>?> _mutate(
    String procedure,
    Map<String, Object?> input,
  ) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      return _map(
        await widget.repository.mutateProcedure(
          procedure,
          branchId: _branchId,
          input: input,
        ),
      );
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
      return null;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _analyze() async {
    final result = await _mutate('audit.analyzeFormulaAudit', {'days': _days});
    if (result != null && mounted) setState(() => _analysis = result);
  }

  Future<void> _createPlan() async {
    final result = await _mutate('audit.createFormulaAuditFixPlan', {
      'days': _days,
      'requestId': _uuidV4(),
    });
    if (result != null && mounted) {
      setState(() {
        _plan = result;
        _workOrder = null;
      });
    }
  }

  Future<void> _approvePlan() async {
    final proposalId = _text(_plan?['proposalId']);
    if (proposalId.isEmpty) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('อนุมัติแผนตรวจแก้?'),
        content: const Text(
          'การอนุมัตินี้รับรองขอบเขตแผนเท่านั้น ยังไม่แก้ข้อมูลหรือโค้ดโดยอัตโนมัติ',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('ยกเลิก'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('อนุมัติแผน'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final result = await _mutate('audit.approveFormulaAuditFixPlan', {
      'proposalId': proposalId,
    });
    if (result != null && mounted) {
      setState(() => _plan = {...?_plan, 'approved': true, ...result});
    }
  }

  Future<void> _createWorkOrder() async {
    final sourceProposalId = _text(_plan?['proposalId']);
    if (sourceProposalId.isEmpty) return;
    final result = await _mutate(
      'audit.createFormulaAuditRemediationWorkOrder',
      {'sourceProposalId': sourceProposalId},
    );
    if (result != null && mounted) setState(() => _workOrder = result);
  }

  Future<void> _startWorkOrder() async {
    final id = _text(_workOrder?['workOrderId']);
    if (id.isEmpty) return;
    final result = await _mutate(
      'audit.startFormulaAuditRemediationWorkOrder',
      {'workOrderId': id},
    );
    if (result != null && mounted) setState(() => _workOrder = result);
  }

  Future<void> _verifyWorkOrder() async {
    final id = _text(_workOrder?['workOrderId']);
    if (id.isEmpty) return;
    final result = await _mutate(
      'audit.verifyFormulaAuditRemediationWorkOrder',
      {'workOrderId': id},
    );
    if (result != null && mounted) setState(() => _workOrder = result);
  }

  Future<void> _copyHandoff() async {
    final prompt = _text(_workOrder?['developerPrompt']);
    if (prompt.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: prompt));
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('คัดลอก Developer Handoff แล้ว')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final report = _report;
    final counts = _mapOrEmpty(report?['counts']);
    final scanned = _mapOrEmpty(report?['scanned']);
    final status = _text(report?['status']);
    final total = _int(counts['total']);
    final scannedTotal = scanned.values.fold<int>(
      0,
      (sum, value) => sum + _int(value),
    );
    return Material(
      color: const Color(0xFFF7F6FB),
      borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      clipBehavior: Clip.antiAlias,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('AI Auditor ตรวจสอบสูตร'),
          actions: [
            IconButton(
              tooltip: 'ตรวจใหม่',
              onPressed: _loading || _busy ? null : _loadReport,
              icon: const Icon(Icons.refresh_rounded),
            ),
          ],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.fromLTRB(14, 10, 14, 28),
                children: [
                  if (_error != null) _ErrorCard(message: _error!),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              CircleAvatar(
                                backgroundColor: _statusColor(
                                  status,
                                ).withValues(alpha: .12),
                                foregroundColor: _statusColor(status),
                                child: const Icon(Icons.rule_folder_outlined),
                              ),
                              const SizedBox(width: 11),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text(
                                      'ตรวจซ้ำด้วยกฎคำนวณอิสระ',
                                      style: TextStyle(
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                    Text(
                                      _statusLabel(status),
                                      style: TextStyle(
                                        color: _statusColor(status),
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              DropdownButton<int>(
                                value: _days,
                                onChanged: _busy
                                    ? null
                                    : (value) {
                                        if (value == null) return;
                                        setState(() => _days = value);
                                        _loadReport();
                                      },
                                items: const [
                                  DropdownMenuItem(
                                    value: 7,
                                    child: Text('7 วัน'),
                                  ),
                                  DropdownMenuItem(
                                    value: 30,
                                    child: Text('30 วัน'),
                                  ),
                                  DropdownMenuItem(
                                    value: 90,
                                    child: Text('90 วัน'),
                                  ),
                                  DropdownMenuItem(
                                    value: 365,
                                    child: Text('1 ปี'),
                                  ),
                                ],
                              ),
                            ],
                          ),
                          const SizedBox(height: 14),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              _StatChip(
                                label: 'ตรวจข้อมูล',
                                value: '$scannedTotal รายการ',
                              ),
                              _StatChip(
                                label: 'กฎ',
                                value: '${_int(report?['ruleCount'])} กฎ',
                              ),
                              _StatChip(label: 'ผิดปกติ', value: '$total จุด'),
                              _StatChip(
                                label: 'วิกฤต',
                                value: '${_int(counts['critical'])}',
                              ),
                            ],
                          ),
                          const SizedBox(height: 14),
                          FilledButton.icon(
                            onPressed: total > 0 && !_busy ? _analyze : null,
                            icon: const Icon(Icons.auto_awesome_rounded),
                            label: Text(
                              _busy ? 'กำลังประมวลผล...' : 'ให้ AI วิเคราะห์',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  if (_maps(report?['issues']).isNotEmpty)
                    _Panel(
                      title: 'จุดที่ควรตรวจสอบ',
                      icon: Icons.warning_amber_rounded,
                      children: [
                        for (final issue in _maps(report?['issues']))
                          ListTile(
                            contentPadding: EdgeInsets.zero,
                            leading: Icon(
                              _text(issue['severity']) == 'critical'
                                  ? Icons.error_rounded
                                  : Icons.warning_rounded,
                              color: _text(issue['severity']) == 'critical'
                                  ? const Color(0xFFB42318)
                                  : const Color(0xFFB96A00),
                            ),
                            title: Text(
                              _text(
                                issue['title'],
                                fallback: _text(issue['rule']),
                              ),
                              style: const TextStyle(
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            subtitle: Text(
                              '${_text(issue['detail'])}\nข้อเสนอ: ${_text(issue['suggestion'])}',
                            ),
                          ),
                      ],
                    ),
                  if (_analysis != null)
                    _Panel(
                      title: 'คำวิเคราะห์และแนวทางตรวจแก้',
                      icon: Icons.auto_awesome_rounded,
                      children: [
                        Text(_text(_analysis?['answer'])),
                        const SizedBox(height: 12),
                        OutlinedButton.icon(
                          onPressed: _busy ? null : _createPlan,
                          icon: const Icon(Icons.fact_check_outlined),
                          label: const Text('สร้างแผนแก้ไข'),
                        ),
                      ],
                    ),
                  if (_plan != null) _buildPlan(),
                  if (_workOrder != null) _buildWorkOrder(),
                ],
              ),
      ),
    );
  }

  Widget _buildPlan() {
    final plan = _mapOrEmpty(_plan?['plan']);
    final approved =
        _plan?['approved'] == true || _text(_plan?['status']) == 'succeeded';
    return _Panel(
      title: 'แผนตรวจแก้ที่ AI เสนอ',
      icon: Icons.playlist_add_check_rounded,
      children: [
        Text(
          _text(plan['summary']),
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
        if (_text(plan['risk']).isNotEmpty)
          Text('ระดับความเสี่ยง: ${_text(plan['risk'])}'),
        const SizedBox(height: 8),
        for (final step in _maps(plan['steps']))
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.task_alt_rounded),
            title: Text(
              _text(step['title']),
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
            subtitle: Text(
              '${_text(step['reason'])}\nไฟล์: ${_strings(step['sourceFiles']).join(', ')}',
            ),
          ),
        if (!approved)
          FilledButton.icon(
            onPressed: _busy ? null : _approvePlan,
            icon: const Icon(Icons.approval_outlined),
            label: const Text('ตรวจและอนุมัติแผน'),
          )
        else
          FilledButton.tonalIcon(
            onPressed: _busy ? null : _createWorkOrder,
            icon: const Icon(Icons.work_outline_rounded),
            label: const Text('สร้างใบงานสำหรับนักพัฒนา'),
          ),
      ],
    );
  }

  Widget _buildWorkOrder() {
    final status = _text(_workOrder?['status']);
    return _Panel(
      title: 'ใบงานแก้ไข ${_text(_workOrder?['workOrderId'])}',
      icon: Icons.engineering_outlined,
      children: [
        Text('สถานะ: ${status.isEmpty ? '-' : status}'),
        const SizedBox(height: 8),
        for (final rule in _maps(_workOrder?['targetRules']))
          Text('• ${_text(rule['rule'])} (${_int(rule['baselineCount'])} จุด)'),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          onPressed: _copyHandoff,
          icon: const Icon(Icons.copy_all_outlined),
          label: const Text('คัดลอก Developer Handoff'),
        ),
        if (status == 'pending')
          FilledButton.icon(
            onPressed: _busy ? null : _startWorkOrder,
            icon: const Icon(Icons.play_arrow_rounded),
            label: const Text('เริ่มใบงาน'),
          ),
        if (status == 'processing')
          FilledButton.icon(
            onPressed: _busy ? null : _verifyWorkOrder,
            icon: const Icon(Icons.verified_outlined),
            label: const Text('ตรวจยืนยันจาก Audit ล่าสุด'),
          ),
        if (_workOrder?['passed'] != null)
          Text(
            _workOrder?['passed'] == true
                ? 'ผลตรวจผ่านเกณฑ์ของใบงานแล้ว'
                : 'ผลตรวจยังไม่ผ่านเกณฑ์ กรุณาดำเนินการแก้ไขต่อ',
            style: TextStyle(
              fontWeight: FontWeight.w900,
              color: _workOrder?['passed'] == true
                  ? const Color(0xFF087443)
                  : const Color(0xFFB42318),
            ),
          ),
      ],
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({
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
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(icon, color: const Color(0xFF6554D9)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    title,
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
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

class _StatChip extends StatelessWidget {
  const _StatChip({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: const Color(0xFFF0EDFF),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        '$label $value',
        style: const TextStyle(fontWeight: FontWeight.w800),
      ),
    );
  }
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFFFFEEEE),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Text(message, style: const TextStyle(color: Color(0xFFB42318))),
      ),
    );
  }
}

Color _statusColor(String status) => switch (status) {
  'critical' => const Color(0xFFB42318),
  'warning' => const Color(0xFFB96A00),
  _ => const Color(0xFF087443),
};

String _statusLabel(String status) => switch (status) {
  'critical' => 'พบจุดผิดปกติ',
  'warning' => 'ควรตรวจสอบ',
  _ => 'ไม่พบความผิดปกติ',
};

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
          .map((row) => Map<String, dynamic>.from(row))
          .toList()
    : const [];

List<String> _strings(Object? value) =>
    value is List ? value.map((item) => item.toString()).toList() : const [];

String _text(Object? value, {String fallback = ''}) {
  final result = value?.toString().trim() ?? '';
  return result.isEmpty || result == 'null' ? fallback : result;
}

int _int(Object? value) =>
    value is num ? value.toInt() : int.tryParse('$value') ?? 0;

String _uuidV4() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes
      .map((value) => value.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
