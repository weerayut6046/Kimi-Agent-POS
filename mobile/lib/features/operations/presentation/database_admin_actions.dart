import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../data/operations_repository.dart';

Future<bool> backupDatabase({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  final busy = showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (context) => const AlertDialog(
      content: Row(
        children: [
          CircularProgressIndicator(),
          SizedBox(width: 18),
          Expanded(child: Text('กำลังสร้างไฟล์สำรองข้อมูล...')),
        ],
      ),
    ),
  );
  try {
    final result = _map(
      await repository.mutateProcedure('dbadmin.backup', branchId: branchId),
    );
    final backup = _map(result['backup']);
    final fileName = _text(backup['fileName'], fallback: 'pumppos.posbackup');
    final bytes = base64Decode(_text(backup['contentBase64']));
    if (context.mounted) Navigator.of(context, rootNavigator: true).pop();
    await busy;
    if (!context.mounted) return false;
    final renderBox = context.findRenderObject() as RenderBox?;
    await SharePlus.instance.share(
      ShareParams(
        title: 'สำรองฐานข้อมูล PumpPOS',
        text:
            'ไฟล์สำรอง $fileName · ${_int(backup['totalRows'])} แถว · เก็บไฟล์นี้ในที่ปลอดภัย',
        files: [XFile.fromData(bytes, mimeType: 'application/gzip')],
        fileNameOverrides: [fileName],
        sharePositionOrigin: renderBox == null
            ? null
            : renderBox.localToGlobal(Offset.zero) & renderBox.size,
      ),
    );
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          'สร้าง $fileName แล้ว (${_int(backup['totalRows'])} แถว)',
        ),
      ),
    );
  } catch (error) {
    if (context.mounted) {
      Navigator.of(context, rootNavigator: true).pop();
      await busy;
      messenger.showSnackBar(
        SnackBar(
          content: Text('$error'),
          backgroundColor: const Color(0xFFB42318),
        ),
      );
    }
  }
  return false;
}

Future<bool> restoreDatabase({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
}) async {
  final file = await FilePicker.pickFile(
    dialogTitle: 'เลือกไฟล์สำรอง PumpPOS',
    type: FileType.custom,
    allowedExtensions: const ['posbackup'],
  );
  if (file == null || !context.mounted) return false;
  if (!file.name.toLowerCase().endsWith('.posbackup')) {
    _message(context, 'กรุณาเลือกไฟล์นามสกุล .posbackup');
    return false;
  }
  final length = await file.length();
  if (!context.mounted) return false;
  if (length > 32 * 1024 * 1024) {
    _message(context, 'ไฟล์สำรองข้อมูลมีขนาดใหญ่เกิน 32 MB');
    return false;
  }
  final bytes = await file.readAsBytes();
  if (!context.mounted) return false;
  final controller = TextEditingController();
  final confirmed = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setDialogState) => AlertDialog(
        icon: const Icon(
          Icons.warning_amber_rounded,
          color: Color(0xFFB42318),
          size: 42,
        ),
        title: const Text('กู้คืนฐานข้อมูลทั้งระบบ'),
        content: SizedBox(
          width: 440,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                '${file.name}\nขนาด ${_fileSize(length)}',
                style: const TextStyle(fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 10),
              const Text(
                'ข้อมูลในฐานข้อมูลจะถูกแทนที่แบบ atomic ด้วยข้อมูลจากไฟล์นี้ การทำงานนี้มีผลกับทุกสาขาและย้อนกลับไม่ได้หากไม่มีไฟล์สำรองปัจจุบัน',
              ),
              const SizedBox(height: 12),
              TextField(
                controller: controller,
                autofocus: true,
                onChanged: (_) => setDialogState(() {}),
                decoration: const InputDecoration(
                  labelText: 'พิมพ์ “กู้คืนข้อมูล” เพื่อยืนยัน',
                  prefixIcon: Icon(Icons.shield_outlined),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('ยกเลิก'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFB42318),
            ),
            onPressed: controller.text.trim() == 'กู้คืนข้อมูล'
                ? () => Navigator.pop(dialogContext, true)
                : null,
            child: const Text('กู้คืนฐานข้อมูล'),
          ),
        ],
      ),
    ),
  );
  controller.dispose();
  if (confirmed != true || !context.mounted) return false;

  final busy = showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (context) => const AlertDialog(
      content: Row(
        children: [
          CircularProgressIndicator(),
          SizedBox(width: 18),
          Expanded(child: Text('กำลังกู้คืนข้อมูล ห้ามปิดแอป...')),
        ],
      ),
    ),
  );
  try {
    final result = _map(
      await repository.mutateProcedure(
        'dbadmin.restoreUpload',
        branchId: branchId,
        input: {
          'fileName': file.name,
          'contentBase64': base64Encode(bytes),
          'confirmation': 'กู้คืนข้อมูล',
        },
      ),
    );
    final restored = _map(result['restored']);
    if (context.mounted) Navigator.of(context, rootNavigator: true).pop();
    await busy;
    if (!context.mounted) return true;
    _message(
      context,
      'กู้คืน ${_int(restored['totalRows'])} แถวจาก ${_text(restored['fileName'])} สำเร็จ',
    );
    return true;
  } catch (error) {
    if (context.mounted) {
      Navigator.of(context, rootNavigator: true).pop();
      await busy;
      if (context.mounted) _message(context, '$error', error: true);
    }
    return false;
  }
}

void _message(BuildContext context, String text, {bool error = false}) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(text),
      backgroundColor: error ? const Color(0xFFB42318) : null,
    ),
  );
}

Map<String, dynamic> _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  throw const FormatException('Invalid JSON object');
}

String _text(Object? value, {String fallback = ''}) {
  final result = value?.toString().trim() ?? '';
  return result.isEmpty || result == 'null' ? fallback : result;
}

int _int(Object? value) =>
    value is num ? value.toInt() : int.tryParse('$value') ?? 0;

String _fileSize(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
  return '${(bytes / 1024 / 1024).toStringAsFixed(1)} MB';
}
