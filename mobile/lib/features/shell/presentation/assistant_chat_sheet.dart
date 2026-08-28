import 'dart:math';

import 'package:flutter/material.dart';

import '../../auth/domain/staff_session.dart';
import '../../operations/data/operations_repository.dart';
import '../../operations/presentation/report_export_actions.dart';

Future<void> showAssistantChatSheet({
  required BuildContext context,
  required StaffSession staff,
  required OperationsRepository repository,
  required ValueChanged<String> onNavigate,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (context) => _AssistantChatSheet(
      staff: staff,
      repository: repository,
      onNavigate: onNavigate,
    ),
  );
}

class _AssistantMessage {
  const _AssistantMessage({
    required this.role,
    required this.content,
    required this.includeInContext,
    this.actions = const <Map<String, dynamic>>[],
  });

  final String role;
  final String content;
  final bool includeInContext;
  final List<Map<String, dynamic>> actions;
}

class _AssistantChatSheet extends StatefulWidget {
  const _AssistantChatSheet({
    required this.staff,
    required this.repository,
    required this.onNavigate,
  });

  final StaffSession staff;
  final OperationsRepository repository;
  final ValueChanged<String> onNavigate;

  @override
  State<_AssistantChatSheet> createState() => _AssistantChatSheetState();
}

class _AssistantChatSheetState extends State<_AssistantChatSheet> {
  final _draft = TextEditingController();
  final _scroll = ScrollController();
  final _messages = <_AssistantMessage>[
    const _AssistantMessage(
      role: 'assistant',
      content:
          'สวัสดีครับ ผมช่วยอ่านข้อมูล เปิดหน้าจอ และเตรียมรายการใน PumpPOS ตามสิทธิ์ของคุณได้ ก่อนเปลี่ยนข้อมูลผมจะแสดงรายละเอียดให้ตรวจและยืนยันทุกครั้ง',
      includeInContext: false,
    ),
  ];
  bool _sending = false;
  String? _runningAction;

  List<String> get _quickPrompts {
    final prompts = <String>[];
    if (widget.staff.role == StaffRole.admin) {
      prompts.add('สรุปภาพรวมธุรกิจทุกโมดูล');
      prompts.add('ขอเอกสารทั้งหมดที่มีในระบบ');
    }
    if (widget.staff.can('dashboard') ||
        widget.staff.can('sales') ||
        widget.staff.can('reports')) {
      prompts.add('สรุปยอดขายวันนี้ให้หน่อย');
    }
    if (widget.staff.can('stock')) {
      if (widget.staff.role == StaffRole.admin) {
        prompts.add('แสดงปริมาณน้ำมันคงเหลือทุกถัง');
      }
      prompts.add('มีถังหรือสินค้าอะไรต่ำกว่าเกณฑ์บ้าง');
    }
    if (widget.staff.can('dashboard') || widget.staff.can('shifts')) {
      prompts.add('ตอนนี้มีกะเปิดอยู่หรือไม่');
    }
    prompts.add('แนะนำขั้นตอนการขายหน้าลานแบบสั้น ๆ');
    return prompts.take(6).toList();
  }

  @override
  void dispose() {
    _draft.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _send([String? preset]) async {
    final content = (preset ?? _draft.text).trim();
    if (content.isEmpty || _sending) return;
    setState(() {
      _sending = true;
      _draft.clear();
      _messages.add(
        _AssistantMessage(
          role: 'user',
          content: content.length > 2000 ? content.substring(0, 2000) : content,
          includeInContext: true,
        ),
      );
    });
    _scrollToEnd();
    try {
      final contextMessages = _messages
          .where((message) => message.includeInContext)
          .toList()
          .reversed
          .take(12)
          .toList()
          .reversed
          .map(
            (message) => <String, Object?>{
              'role': message.role,
              'content': message.content,
            },
          )
          .toList();
      final result = _map(
        await widget.repository.mutateProcedure(
          'assistant.chat',
          branchId: widget.staff.branch.id,
          input: <String, Object?>{
            'requestId': _uuidV4(),
            'messages': contextMessages,
          },
        ),
      );
      if (!mounted) return;
      setState(() {
        _messages.add(
          _AssistantMessage(
            role: 'assistant',
            content: _text(
              result['answer'],
              fallback: 'AI ไม่ได้ส่งคำตอบกลับมา',
            ),
            includeInContext: result['includeInModelContext'] == true,
            actions: _maps(result['actions']),
          ),
        );
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _messages.add(
          _AssistantMessage(
            role: 'assistant',
            content: '$error',
            includeInContext: false,
          ),
        );
      });
    } finally {
      if (mounted) setState(() => _sending = false);
      _scrollToEnd();
    }
  }

  Future<void> _runAction(Map<String, dynamic> action) async {
    if (_runningAction != null) return;
    final kind = _text(action['kind']);
    final actionId = '$kind:${_text(action['proposalId'] ?? action['label'])}';
    if (kind == 'navigate') {
      final path = _text(action['path']);
      if (path.isEmpty) return;
      Navigator.pop(context);
      widget.onNavigate(path);
      return;
    }
    if (kind == 'confirm_agent_action') {
      await _confirmAgentAction(action, actionId);
      return;
    }
    setState(() => _runningAction = actionId);
    try {
      if (kind == 'download_daily_report') {
        await shareExcelReport(
          context: context,
          repository: widget.repository,
          branchId: widget.staff.branch.id,
          procedure: 'reports.exportDailyExcel',
          input: <String, Object?>{'date': _text(action['date'])},
        );
      } else if (kind == 'download_sales_range') {
        await shareExcelReport(
          context: context,
          repository: widget.repository,
          branchId: widget.staff.branch.id,
          procedure: 'reports.exportRangeExcel',
          input: <String, Object?>{
            'from': _text(action['from']),
            'to': _text(action['to']),
          },
        );
      }
    } finally {
      if (mounted) setState(() => _runningAction = null);
    }
  }

  Future<void> _confirmAgentAction(
    Map<String, dynamic> action,
    String actionId,
  ) async {
    final requiresPin = action['requiresPin'] == true;
    final pin = TextEditingController();
    String? dialogError;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          icon: Icon(
            _text(action['risk']) == 'sensitive'
                ? Icons.shield_outlined
                : Icons.auto_awesome_rounded,
            color: const Color(0xFF6554D9),
          ),
          title: Text(_text(action['title'], fallback: 'ยืนยันการทำงาน')),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(_text(action['summary'])),
              if (requiresPin) ...[
                const SizedBox(height: 14),
                TextField(
                  controller: pin,
                  obscureText: true,
                  decoration: InputDecoration(
                    labelText: 'PIN ของบัญชี',
                    errorText: dialogError,
                  ),
                ),
              ],
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('ยกเลิก'),
            ),
            FilledButton(
              onPressed: () {
                if (requiresPin && pin.text.trim().isEmpty) {
                  setDialogState(() => dialogError = 'กรุณากรอก PIN');
                  return;
                }
                Navigator.pop(dialogContext, true);
              },
              child: const Text('ยืนยันและดำเนินการ'),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true || !mounted) {
      pin.dispose();
      return;
    }
    setState(() => _runningAction = actionId);
    try {
      final result = _map(
        await widget.repository.mutateProcedure(
          'assistant.executeAction',
          branchId: widget.staff.branch.id,
          input: <String, Object?>{
            'proposalId': _text(action['proposalId']),
            if (requiresPin) 'pin': pin.text.trim(),
          },
        ),
      );
      if (!mounted) return;
      final proposalId = _text(action['proposalId']);
      setState(() {
        for (var index = 0; index < _messages.length; index++) {
          final message = _messages[index];
          _messages[index] = _AssistantMessage(
            role: message.role,
            content: message.content,
            includeInContext: message.includeInContext,
            actions: message.actions
                .where(
                  (item) =>
                      _text(item['proposalId']) != proposalId ||
                      _text(item['kind']) != 'confirm_agent_action',
                )
                .toList(),
          );
        }
        _messages.add(
          _AssistantMessage(
            role: 'assistant',
            content: _text(result['summary'], fallback: 'ดำเนินการแล้ว'),
            includeInContext: false,
          ),
        );
      });
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('$error'),
            backgroundColor: const Color(0xFFB42318),
          ),
        );
      }
    } finally {
      pin.dispose();
      if (mounted) setState(() => _runningAction = null);
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    return AnimatedPadding(
      duration: const Duration(milliseconds: 160),
      padding: EdgeInsets.only(bottom: keyboard),
      child: FractionallySizedBox(
        heightFactor: .94,
        child: Container(
          decoration: const BoxDecoration(
            color: Color(0xFFF7F7FB),
            borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          ),
          child: Column(
            children: [
              _header(),
              Expanded(
                child: ListView(
                  controller: _scroll,
                  padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
                  children: [
                    if (_messages.length == 1) ...[
                      Wrap(
                        spacing: 7,
                        runSpacing: 7,
                        children: _quickPrompts
                            .map(
                              (prompt) => ActionChip(
                                label: Text(prompt),
                                onPressed: _sending
                                    ? null
                                    : () => _send(prompt),
                              ),
                            )
                            .toList(),
                      ),
                      const SizedBox(height: 14),
                    ],
                    for (final message in _messages) _messageBubble(message),
                    if (_sending)
                      const Align(
                        alignment: Alignment.centerLeft,
                        child: Padding(
                          padding: EdgeInsets.all(12),
                          child: SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(strokeWidth: 2.5),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              _composer(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _header() => Container(
    padding: const EdgeInsets.fromLTRB(16, 14, 8, 12),
    decoration: const BoxDecoration(
      borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      gradient: LinearGradient(
        colors: [Color(0xFFF0EBFF), Colors.white, Color(0xFFE7FAFC)],
      ),
      border: Border(bottom: BorderSide(color: Color(0xFFE6E3ED))),
    ),
    child: Row(
      children: [
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(15),
            gradient: const LinearGradient(
              colors: [Color(0xFF7457F0), Color(0xFF10A9B8)],
            ),
          ),
          child: const Icon(Icons.smart_toy_outlined, color: Colors.white),
        ),
        const SizedBox(width: 11),
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'ผู้ช่วย PumpPOS',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
              ),
              Text(
                'จำกัดตามสิทธิ์ · เปลี่ยนข้อมูลต้องยืนยัน',
                style: TextStyle(fontSize: 10.5, color: Color(0xFF777487)),
              ),
            ],
          ),
        ),
        IconButton(
          tooltip: 'ล้างแชต',
          onPressed: () => setState(() {
            _messages
              ..clear()
              ..add(
                const _AssistantMessage(
                  role: 'assistant',
                  content: 'สวัสดีครับ ผมพร้อมช่วยงาน PumpPOS ตามสิทธิ์ของคุณ',
                  includeInContext: false,
                ),
              );
          }),
          icon: const Icon(Icons.delete_sweep_outlined),
        ),
        IconButton(
          onPressed: () => Navigator.pop(context),
          icon: const Icon(Icons.close_rounded),
        ),
      ],
    ),
  );

  Widget _messageBubble(_AssistantMessage message) {
    final user = message.role == 'user';
    return Align(
      alignment: user ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 340),
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.fromLTRB(13, 10, 13, 10),
        decoration: BoxDecoration(
          color: user ? const Color(0xFF6554D9) : Colors.white,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(18),
            topRight: const Radius.circular(18),
            bottomLeft: Radius.circular(user ? 18 : 5),
            bottomRight: Radius.circular(user ? 5 : 18),
          ),
          border: user ? null : Border.all(color: const Color(0xFFE5E2EB)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              message.content,
              style: TextStyle(
                color: user ? Colors.white : const Color(0xFF343146),
                height: 1.45,
              ),
            ),
            if (message.actions.isNotEmpty) ...[
              const SizedBox(height: 9),
              const Divider(height: 1),
              const SizedBox(height: 7),
              for (final action in message.actions)
                Padding(
                  padding: const EdgeInsets.only(top: 5),
                  child: OutlinedButton.icon(
                    onPressed: _runningAction == null
                        ? () => _runAction(action)
                        : null,
                    icon: Icon(
                      _text(action['kind']) == 'navigate'
                          ? Icons.open_in_new_rounded
                          : _text(action['kind']) == 'confirm_agent_action'
                          ? Icons.auto_fix_high_rounded
                          : Icons.download_outlined,
                      size: 17,
                    ),
                    label: Text(_text(action['label'], fallback: 'ดำเนินการ')),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _composer() => Container(
    padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
    decoration: const BoxDecoration(
      color: Colors.white,
      border: Border(top: BorderSide(color: Color(0xFFE6E3ED))),
    ),
    child: SafeArea(
      top: false,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: TextField(
              controller: _draft,
              minLines: 1,
              maxLines: 4,
              maxLength: 2000,
              buildCounter:
                  (
                    _, {
                    required currentLength,
                    required isFocused,
                    maxLength,
                  }) => null,
              textInputAction: TextInputAction.newline,
              decoration: const InputDecoration(
                hintText: 'ถามข้อมูลหรือสั่งให้เตรียมรายการ…',
                prefixIcon: Icon(Icons.auto_awesome_outlined),
              ),
            ),
          ),
          const SizedBox(width: 8),
          IconButton.filled(
            tooltip: 'ส่งข้อความ',
            onPressed: _sending ? null : _send,
            icon: const Icon(Icons.send_rounded),
          ),
        ],
      ),
    ),
  );
}

String _uuidV4() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes
      .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

Map<String, dynamic> _map(Object? value) =>
    value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

List<Map<String, dynamic>> _maps(Object? value) {
  if (value is! List) return const <Map<String, dynamic>>[];
  return value
      .whereType<Map>()
      .map((row) => Map<String, dynamic>.from(row))
      .toList();
}

String _text(Object? value, {String fallback = ''}) {
  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? fallback : text;
}
