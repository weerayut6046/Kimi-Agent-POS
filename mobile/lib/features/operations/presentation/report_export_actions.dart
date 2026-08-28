import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:share_plus/share_plus.dart';

import '../data/operations_repository.dart';

Future<bool> shareExcelReport({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
  required String procedure,
  required Map<String, Object?> input,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    final payload = _map(
      await repository.queryProcedure(
        procedure,
        branchId: branchId,
        input: input,
      ),
    );
    if (!context.mounted) return false;
    final fileName = _text(payload['fileName'], fallback: 'report.xlsx');
    final bytes = base64Decode(_text(payload['contentBase64']));
    final renderBox = context.findRenderObject() as RenderBox?;
    await SharePlus.instance.share(
      ShareParams(
        title: 'รายงาน PumpPOS',
        files: [
          XFile.fromData(
            bytes,
            mimeType:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          ),
        ],
        fileNameOverrides: [fileName],
        sharePositionOrigin: renderBox == null
            ? null
            : renderBox.localToGlobal(Offset.zero) & renderBox.size,
      ),
    );
    messenger.showSnackBar(SnackBar(content: Text('สร้าง $fileName แล้ว')));
  } catch (error) {
    messenger.showSnackBar(
      SnackBar(
        content: Text('$error'),
        backgroundColor: const Color(0xFFB42318),
      ),
    );
  }
  return false;
}

Future<bool> shareRangeExcelReport({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
  required DateTime initialDate,
}) async {
  var from = initialDate.subtract(const Duration(days: 6));
  var to = initialDate;
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, setDialogState) => AlertDialog(
        title: const Text('ส่งออกยอดขายช่วงเวลา'),
        content: SizedBox(
          width: 420,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _DateTile(
                label: 'ตั้งแต่วันที่',
                date: from,
                onTap: () async {
                  final picked = await _pick(context, from);
                  if (picked != null) setDialogState(() => from = picked);
                },
              ),
              const SizedBox(height: 8),
              _DateTile(
                label: 'ถึงวันที่',
                date: to,
                onTap: () async {
                  final picked = await _pick(context, to);
                  if (picked != null) setDialogState(() => to = picked);
                },
              ),
              const SizedBox(height: 9),
              const Text('ช่วงเวลาสูงสุด 92 วัน'),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('ยกเลิก'),
          ),
          FilledButton(
            onPressed: !to.isBefore(from) && to.difference(from).inDays < 92
                ? () => Navigator.pop(context, true)
                : null,
            child: const Text('สร้าง Excel'),
          ),
        ],
      ),
    ),
  );
  if (confirmed != true || !context.mounted) return false;
  return shareExcelReport(
    context: context,
    repository: repository,
    branchId: branchId,
    procedure: 'reports.exportRangeExcel',
    input: {'from': _day(from), 'to': _day(to)},
  );
}

class _DateTile extends StatelessWidget {
  const _DateTile({
    required this.label,
    required this.date,
    required this.onTap,
  });

  final String label;
  final DateTime date;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: Color(0xFFE4E0EF)),
      ),
      leading: const Icon(Icons.event_outlined),
      title: Text(label),
      subtitle: Text(DateFormat('d MMMM yyyy', 'th_TH').format(date)),
      onTap: onTap,
    );
  }
}

Future<DateTime?> _pick(BuildContext context, DateTime initial) =>
    showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2020),
      lastDate: DateTime.now(),
      locale: const Locale('th', 'TH'),
    );

Map<String, dynamic> _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  throw const FormatException('Invalid JSON object');
}

String _text(Object? value, {String fallback = ''}) {
  final result = value?.toString().trim() ?? '';
  return result.isEmpty || result == 'null' ? fallback : result;
}

String _day(DateTime date) =>
    '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
