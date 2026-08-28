import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:archive/archive.dart';
import 'package:barcode/barcode.dart';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../data/operations_repository.dart';

Future<bool> shareMemberCardDataMerge({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
  required int batchId,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  var progressOpen = false;
  try {
    unawaited(
      showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (context) => const AlertDialog(
          content: Row(
            children: [
              CircularProgressIndicator(),
              SizedBox(width: 18),
              Expanded(child: Text('กำลังสร้างชุด Data Merge…')),
            ],
          ),
        ),
      ),
    );
    progressOpen = true;
    final payload = _map(
      await repository.queryProcedure(
        'membership.getCardBatch',
        branchId: branchId,
        input: <String, Object?>{'id': batchId},
      ),
    );
    final batch = _map(payload['batch']);
    final cards = _maps(payload['cards']);
    if (cards.isEmpty) throw StateError('ชุดบัตรนี้ไม่มีหมายเลขบัตร');

    final batchCode = _safeFileName(
      _text(batch['batchCode'], fallback: 'member-cards-$batchId'),
    );
    final archive = Archive();
    archive.addFile(
      ArchiveFile.bytes(
        'data-merge.csv',
        utf8.encode('\uFEFF${_buildCsv(cards)}'),
      ),
    );
    archive.addFile(
      ArchiveFile.bytes(
        'README-TH.txt',
        utf8.encode(_readme(batch, cards.length)),
      ),
    );

    final code128 = Barcode.code128();
    final qr = Barcode.qrCode(errorCorrectLevel: BarcodeQRCorrectionLevel.high);
    for (final card in cards) {
      final code = _text(card['memberCode']);
      if (code.isEmpty) continue;
      archive.addFile(
        ArchiveFile.bytes(
          'barcode/$code.png',
          await _barcodePng(
            barcode: code128,
            data: code,
            width: 720,
            height: 244,
            margin: 32,
          ),
        ),
      );
      archive.addFile(
        ArchiveFile.bytes(
          'qr/$code.png',
          await _barcodePng(
            barcode: qr,
            data: code,
            width: 720,
            height: 720,
            margin: 36,
          ),
        ),
      );
    }
    final bytes = ZipEncoder().encodeBytes(archive, level: 6);
    if (progressOpen && context.mounted) {
      Navigator.of(context, rootNavigator: true).pop();
      progressOpen = false;
    }
    if (!context.mounted) return false;
    final renderBox = context.findRenderObject() as RenderBox?;
    final fileName = '$batchCode-data-merge.zip';
    await SharePlus.instance.share(
      ShareParams(
        title: 'ชุดบัตรสมาชิก $batchCode',
        text: 'Data Merge สำหรับผลิตบัตรสมาชิก PumpPOS',
        files: [XFile.fromData(bytes, mimeType: 'application/zip')],
        fileNameOverrides: [fileName],
        sharePositionOrigin: renderBox == null
            ? null
            : renderBox.localToGlobal(Offset.zero) & renderBox.size,
      ),
    );
    messenger.showSnackBar(SnackBar(content: Text('สร้าง $fileName แล้ว')));
  } catch (error) {
    if (progressOpen && context.mounted) {
      Navigator.of(context, rootNavigator: true).pop();
    }
    messenger.showSnackBar(
      SnackBar(
        content: Text('สร้าง Data Merge ไม่สำเร็จ: $error'),
        backgroundColor: const Color(0xFFB42318),
      ),
    );
  }
  return false;
}

Future<Uint8List> _barcodePng({
  required Barcode barcode,
  required String data,
  required int width,
  required int height,
  required double margin,
}) async {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  canvas.drawRect(
    Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()),
    Paint()..color = Colors.white,
  );
  canvas.save();
  canvas.translate(margin, margin);
  final drawWidth = width - (margin * 2);
  final drawHeight = height - (margin * 2);
  final ink = Paint()..color = const Color(0xFF07152F);
  for (final element in barcode.make(
    data,
    width: drawWidth,
    height: drawHeight,
  )) {
    if (element is BarcodeBar && element.black) {
      canvas.drawRect(
        Rect.fromLTWH(element.left, element.top, element.width, element.height),
        ink,
      );
    }
  }
  canvas.restore();
  final picture = recorder.endRecording();
  final image = await picture.toImage(width, height);
  final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
  image.dispose();
  picture.dispose();
  if (byteData == null) throw StateError('สร้างรูปบาร์โค้ดไม่สำเร็จ');
  return byteData.buffer.asUint8List();
}

String _buildCsv(List<Map<String, dynamic>> cards) {
  final lines = <String>[
    'record_no,card_number,card_number_display,@barcode_image,@qr_image,status',
  ];
  for (var index = 0; index < cards.length; index++) {
    final code = _text(cards[index]['memberCode']);
    lines.add(
      <Object>[
        index + 1,
        code,
        _formatMemberCode(code),
        'barcode/$code.png',
        'qr/$code.png',
        'ยังไม่เปิดใช้งาน',
      ].map((value) => _csvCell('$value')).join(','),
    );
  }
  return lines.join('\r\n');
}

String _readme(Map<String, dynamic> batch, int count) => <String>[
  'ชุดบัตร: ${_text(batch['batchCode'])}',
  'ชื่อชุด: ${_text(batch['label'], fallback: '-')}',
  'จำนวน: $count ใบ',
  '',
  'วิธีใช้ Data Merge ใน Adobe InDesign',
  '1. แตกไฟล์ ZIP โดยคงโฟลเดอร์ barcode และ qr ไว้ข้างไฟล์ data-merge.csv',
  '2. เลือก data-merge.csv จากแผง Data Merge',
  '3. วาง card_number_display ลงในกรอบข้อความ',
  '4. ลาก @barcode_image และ @qr_image ลงในกรอบรูป',
  '5. Merge ตามลำดับเดิม ห้ามเรียงหน้าและหลังคนละลำดับ',
  '',
  'บัตรรุ่นนี้ใช้ Barcode และ QR เท่านั้น ไม่มีแถบแม่เหล็ก',
  'ห้ามพิมพ์เลขบัตรเดียวกันซ้ำหลายใบ',
].join('\r\n');

String _csvCell(String value) => RegExp(r'[",\r\n]').hasMatch(value)
    ? '"${value.replaceAll('"', '""')}"'
    : value;

String _formatMemberCode(String value) {
  final chunks = <String>[];
  for (var offset = 0; offset < value.length; offset += 4) {
    final end = (offset + 4).clamp(0, value.length);
    chunks.add(value.substring(offset, end));
  }
  return chunks.join(' ');
}

String _safeFileName(String value) =>
    value.replaceAll(RegExp(r'[^a-zA-Z0-9._-]'), '-');

List<Map<String, dynamic>> _maps(Object? value) {
  if (value is! List) return const <Map<String, dynamic>>[];
  return value
      .whereType<Map>()
      .map((row) => Map<String, dynamic>.from(row))
      .toList();
}

Map<String, dynamic> _map(Object? value) =>
    value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

String _text(Object? value, {String fallback = ''}) {
  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? fallback : text;
}
