import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../data/operations_repository.dart';

Future<bool> updateShopLogo({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
}) async {
  final file = await FilePicker.pickFile(type: FileType.image);
  if (file == null) return false;
  late final List<int> bytes;
  try {
    bytes = await file.readAsBytes();
  } catch (_) {
    if (context.mounted) _error(context, 'ไม่สามารถอ่านไฟล์รูปภาพได้');
    return false;
  }
  if (bytes.length > 2 * 1024 * 1024) {
    if (context.mounted) _error(context, 'รูปโลโก้ต้องมีขนาดไม่เกิน 2 MB');
    return false;
  }
  final mime = switch (file.extension?.toLowerCase()) {
    'jpg' || 'jpeg' => 'image/jpeg',
    'gif' => 'image/gif',
    'webp' => 'image/webp',
    'svg' => 'image/svg+xml',
    _ => 'image/png',
  };
  try {
    await repository.mutateProcedure(
      'catalog.updateSettings',
      branchId: branchId,
      input: {
        'entries': [
          {
            'key': 'shop_logo',
            'value': 'data:$mime;base64,${base64Encode(bytes)}',
          },
        ],
      },
    );
    if (context.mounted) _message(context, 'อัปเดตโลโก้ร้านแล้ว');
    return true;
  } catch (error) {
    if (context.mounted) _error(context, error);
    return false;
  }
}

Future<bool> clearShopLogo({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
}) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('ลบโลโก้ร้าน'),
      content: const Text('ยืนยันลบโลโก้ที่ใช้บนใบเสร็จและเอกสารหรือไม่?'),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('ยกเลิก'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: const Text('ยืนยันลบ'),
        ),
      ],
    ),
  );
  if (confirmed != true || !context.mounted) return false;
  try {
    await repository.mutateProcedure(
      'catalog.updateSettings',
      branchId: branchId,
      input: {
        'entries': [
          {'key': 'shop_logo', 'value': ''},
        ],
      },
    );
    if (context.mounted) _message(context, 'ลบโลโก้ร้านแล้ว');
    return true;
  } catch (error) {
    if (context.mounted) _error(context, error);
    return false;
  }
}

Future<bool> testPaymentConnection({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
}) async {
  try {
    final data = _map(
      await repository.mutateProcedure(
        'payments.testConnection',
        branchId: branchId,
      ),
    );
    if (!context.mounted) return false;
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        icon: const Icon(Icons.verified_rounded, color: Color(0xFF138A58)),
        title: const Text('เชื่อมต่อ Slip2Go สำเร็จ'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _Info(
              label: 'ร้านค้า',
              value: _text(data['shopName'], fallback: '-'),
            ),
            _Info(
              label: 'แพ็กเกจ',
              value: _text(data['packageName'], fallback: '-'),
            ),
            _Info(
              label: 'โควตาสลิปโดยประมาณ',
              value: _text(data['estimatedQuotaSlip'], fallback: '-'),
            ),
            _Info(
              label: 'Token คงเหลือ',
              value: _text(data['tokenRemaining'], fallback: '-'),
            ),
            if (data['mockMode'] == true)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text('กำลังทำงานในโหมดจำลอง'),
              ),
          ],
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('ปิด'),
          ),
        ],
      ),
    );
    return false;
  } catch (error) {
    if (context.mounted) _error(context, error);
    return false;
  }
}

Future<bool> validateMerchantQrPayload({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
  String initialPayload = '',
}) async {
  final controller = TextEditingController(text: initialPayload);
  final submitted = await showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      icon: const Icon(Icons.qr_code_scanner_rounded),
      title: const Text('ตรวจสอบ QR ร้านค้าถุงเงิน'),
      content: SizedBox(
        width: 480,
        child: TextField(
          controller: controller,
          autofocus: initialPayload.isEmpty,
          minLines: 4,
          maxLines: 9,
          decoration: const InputDecoration(
            labelText: 'Merchant QR payload',
            hintText: 'วางข้อความ payload ที่อ่านจาก QR ร้านค้าถุงเงิน',
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('ยกเลิก'),
        ),
        FilledButton.icon(
          onPressed: () => Navigator.pop(context, controller.text.trim()),
          icon: const Icon(Icons.verified_outlined),
          label: const Text('ตรวจสอบ'),
        ),
      ],
    ),
  );
  controller.dispose();
  if (submitted == null || submitted.isEmpty || !context.mounted) return false;
  try {
    final data = _map(
      await repository.mutateProcedure(
        'payments.validateMerchantQr',
        branchId: branchId,
        input: <String, Object?>{'payload': submitted},
      ),
    );
    if (!context.mounted) return false;
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        icon: const Icon(Icons.verified_rounded, color: Color(0xFF138A58)),
        title: const Text('QR ร้านค้าถูกต้อง'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _Info(label: 'รหัสร้านค้า (Ref 1)', value: _text(data['ref1'])),
            _Info(
              label: 'ชื่อบัญชี (Ref 2)',
              value: _text(data['ref2'], fallback: '-'),
            ),
            _Info(label: 'Biller ID', value: _text(data['billerId'])),
          ],
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('ปิด'),
          ),
        ],
      ),
    );
    return false;
  } catch (error) {
    if (context.mounted) _error(context, error);
    return false;
  }
}

Future<bool> showDatabaseInfo({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
}) async {
  try {
    final data = _map(
      await repository.queryProcedure('dbadmin.dbInfo', branchId: branchId),
    );
    if (!context.mounted) return false;
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        icon: const Icon(Icons.storage_rounded, color: Color(0xFF6554D9)),
        title: const Text('ข้อมูลการสำรองฐานข้อมูล'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _Info(label: 'ฐานข้อมูล', value: _text(data['provider'])),
            _Info(label: 'รูปแบบไฟล์', value: _text(data['backupFormat'])),
            _Info(label: 'จำนวนตาราง', value: _text(data['tableCount'])),
            _Info(
              label: 'ขนาดไฟล์สูงสุด',
              value: '${_text(data['maxCompressedSizeMb'])} MB',
            ),
            const SizedBox(height: 8),
            const Text(
              'ไฟล์สำรองรวมข้อมูลตารางธุรกิจ แต่ไม่รวมบัญชี Supabase Auth และไฟล์ใน Storage',
              style: TextStyle(color: Color(0xFF686579)),
            ),
          ],
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('ปิด'),
          ),
        ],
      ),
    );
    return false;
  } catch (error) {
    if (context.mounted) _error(context, error);
    return false;
  }
}

class _Info extends StatelessWidget {
  const _Info({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(
      children: [
        Expanded(child: Text(label)),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w800)),
      ],
    ),
  );
}

Map<String, dynamic> _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return const {};
}

String _text(Object? value, {String fallback = ''}) {
  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? fallback : text;
}

void _message(BuildContext context, String message) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
}

void _error(BuildContext context, Object error) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text('$error'), backgroundColor: const Color(0xFFC94B4B)),
  );
}
