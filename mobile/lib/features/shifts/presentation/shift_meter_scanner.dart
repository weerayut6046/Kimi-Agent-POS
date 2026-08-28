import 'dart:convert';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image/image.dart' as img;

import '../data/shift_repository.dart';
import '../domain/shift_models.dart';

class MeterScanValues {
  const MeterScanValues({this.liters, this.money});

  final String? liters;
  final String? money;
}

Future<Map<int, MeterScanValues>?> showShiftMeterScanner({
  required BuildContext context,
  required ShiftRepository repository,
  required int branchId,
  required CurrentShift shift,
}) {
  return showModalBottomSheet<Map<int, MeterScanValues>>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (context) => _MeterScannerSheet(
      repository: repository,
      branchId: branchId,
      shift: shift,
    ),
  );
}

class _ReviewRow {
  _ReviewRow({
    required this.imageName,
    required this.pumpNumber,
    required this.side,
    required this.mode,
    required this.value,
    required this.confidence,
    required this.valid,
    required this.issue,
  });

  final String imageName;
  final int? pumpNumber;
  final String side;
  String mode;
  String value;
  final double confidence;
  final bool valid;
  final String issue;
  int? nozzleId;
}

class _PreparedImage {
  const _PreparedImage({required this.name, required this.contentBase64});

  final String name;
  final String contentBase64;
}

class _MeterScannerSheet extends StatefulWidget {
  const _MeterScannerSheet({
    required this.repository,
    required this.branchId,
    required this.shift,
  });

  final ShiftRepository repository;
  final int branchId;
  final CurrentShift shift;

  @override
  State<_MeterScannerSheet> createState() => _MeterScannerSheetState();
}

class _MeterScannerSheetState extends State<_MeterScannerSheet> {
  final _rows = <_ReviewRow>[];
  bool _busy = false;
  int _done = 0;
  int _total = 0;
  String? _error;

  Future<void> _pickAndAnalyze() async {
    final result = await FilePicker.pickFiles(type: FileType.image);
    if (result.isEmpty || !mounted) return;
    final files = result.take(20).toList();
    setState(() {
      _busy = true;
      _done = 0;
      _total = files.length;
      _error = result.length > files.length
          ? 'เลือกได้สูงสุด 20 ภาพต่อครั้ง ระบบจะตรวจ 20 ภาพแรก'
          : null;
      _rows.clear();
    });
    try {
      final prepared = <_PreparedImage>[];
      for (final file in files) {
        prepared.add(await _prepareImage(file));
      }
      for (var offset = 0; offset < prepared.length; offset += 2) {
        final batch = prepared.skip(offset).take(2).toList();
        final response = _map(
          await widget.repository.mutateProcedure(
            'pos.shiftMeterVerify',
            branchId: widget.branchId,
            input: <String, Object?>{
              'shiftId': widget.shift.id,
              'images': [
                for (final image in batch)
                  <String, Object?>{
                    'mimeType': 'image/jpeg',
                    'contentBase64': image.contentBase64,
                  },
              ],
            },
          ),
        );
        final results = _maps(response['results']);
        for (final imageResult in results) {
          final imageIndex = _int(imageResult['imageIndex']);
          if (imageIndex < 0 || imageIndex >= batch.length) continue;
          final pumpNumber = imageResult['pumpNumber'] == null
              ? null
              : _int(imageResult['pumpNumber']);
          final mode = _text(imageResult['mode'], fallback: 'unknown');
          final issue = _text(imageResult['issue']);
          for (final screen in _maps(imageResult['screens'])) {
            final combined = _text(screen['combinedText']);
            final row = _ReviewRow(
              imageName: batch[imageIndex].name,
              pumpNumber: pumpNumber,
              side: _text(screen['side'], fallback: 'unknown'),
              mode: mode,
              value: combined,
              confidence: _number(screen['confidence']),
              valid: screen['valid'] == true,
              issue: issue,
            );
            row.nozzleId = _suggestNozzle(row);
            _rows.add(row);
          }
        }
        if (mounted) {
          setState(() => _done = (offset + batch.length).clamp(0, _total));
        }
      }
      if (_rows.isEmpty) {
        throw StateError(
          'AI ยังอ่านเลขมิเตอร์จากภาพไม่ได้ กรุณาใช้ภาพที่เห็นจอชัดขึ้น',
        );
      }
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  int? _suggestNozzle(_ReviewRow row) {
    if (row.pumpNumber == null) return null;
    final candidates = widget.shift.readings.where((reading) {
      final digits = RegExp(r'\d+').firstMatch(reading.pumpName)?.group(0);
      return digits != null && int.tryParse(digits) == row.pumpNumber;
    }).toList()..sort((a, b) => a.nozzleId.compareTo(b.nozzleId));
    if (candidates.isEmpty) return null;
    if (candidates.length == 1) return candidates.first.nozzleId;
    return row.side == 'right'
        ? candidates[1].nozzleId
        : candidates.first.nozzleId;
  }

  void _apply() {
    final values = <int, MeterScanValues>{};
    final usedKeys = <String>{};
    for (final row in _rows) {
      final nozzleId = row.nozzleId;
      final number = double.tryParse(row.value);
      if (nozzleId == null ||
          (row.mode != 'L' && row.mode != 'P') ||
          number == null ||
          number < 0) {
        setState(() => _error = 'กรุณาตรวจหัวจ่าย โหมด L/P และตัวเลขให้ครบ');
        return;
      }
      final key = '$nozzleId:${row.mode}';
      if (!usedKeys.add(key)) {
        setState(() => _error = 'มีค่า ${row.mode} ของหัวจ่ายเดียวกันซ้ำ');
        return;
      }
      final reading = widget.shift.readings.firstWhere(
        (item) => item.nozzleId == nozzleId,
      );
      final opening = row.mode == 'L' ? reading.openMeter : reading.openMoney;
      if (number < opening) {
        setState(() => _error = '${row.mode} ปิดกะต้องไม่น้อยกว่าค่าเปิดกะ');
        return;
      }
      final current = values[nozzleId] ?? const MeterScanValues();
      values[nozzleId] = MeterScanValues(
        liters: row.mode == 'L' ? row.value : current.liters,
        money: row.mode == 'P' ? row.value : current.money,
      );
    }
    Navigator.pop(context, values);
  }

  @override
  Widget build(BuildContext context) {
    return FractionallySizedBox(
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
                padding: const EdgeInsets.fromLTRB(14, 14, 14, 24),
                children: [
                  if (_error case final error?) ...[
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFEEEE),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Text(
                        error,
                        style: const TextStyle(color: Color(0xFFB42318)),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (_busy) ...[
                    LinearProgressIndicator(
                      value: _total == 0 ? null : _done / _total,
                    ),
                    const SizedBox(height: 10),
                    Text('กำลังตรวจภาพ $_done/$_total ด้วย AI…'),
                  ] else if (_rows.isEmpty) ...[
                    const Icon(
                      Icons.add_photo_alternate_outlined,
                      size: 64,
                      color: Color(0xFF6554D9),
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'เลือกภาพหน้าตู้ที่เห็นเลขมิเตอร์ L หรือ P ชัดเจน\nรองรับ JPG, PNG และ WebP สูงสุด 20 ภาพ',
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 18),
                    FilledButton.icon(
                      onPressed: _pickAndAnalyze,
                      icon: const Icon(Icons.photo_library_outlined),
                      label: const Text('เลือกรูปและตรวจด้วย AI'),
                    ),
                  ] else ...[
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            'ผลที่อ่านได้ ${_rows.length} จอ',
                            style: Theme.of(context).textTheme.titleMedium
                                ?.copyWith(fontWeight: FontWeight.w900),
                          ),
                        ),
                        TextButton.icon(
                          onPressed: _pickAndAnalyze,
                          icon: const Icon(Icons.refresh_rounded),
                          label: const Text('เลือกใหม่'),
                        ),
                      ],
                    ),
                    const Text(
                      'กรุณาเทียบเลขกับภาพจริง แล้วเลือกหัวจ่ายและโหมดให้ถูกต้องก่อนนำไปใช้',
                      style: TextStyle(color: Color(0xFF686579)),
                    ),
                    const SizedBox(height: 12),
                    for (var index = 0; index < _rows.length; index++)
                      _reviewCard(_rows[index], index),
                  ],
                ],
              ),
            ),
            if (_rows.isNotEmpty && !_busy)
              Container(
                padding: const EdgeInsets.fromLTRB(14, 10, 14, 14),
                decoration: const BoxDecoration(
                  color: Colors.white,
                  border: Border(top: BorderSide(color: Color(0xFFE5E2EB))),
                ),
                child: SafeArea(
                  top: false,
                  child: SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _apply,
                      icon: const Icon(Icons.check_circle_outline_rounded),
                      label: const Padding(
                        padding: EdgeInsets.symmetric(vertical: 12),
                        child: Text('นำค่าไปกรอกหน้าปิดกะ'),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _header() => Container(
    padding: const EdgeInsets.fromLTRB(18, 16, 8, 14),
    decoration: const BoxDecoration(
      borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      gradient: LinearGradient(
        colors: [Color(0xFF1A1742), Color(0xFF4A3297), Color(0xFF126072)],
      ),
    ),
    child: Row(
      children: [
        const Icon(Icons.document_scanner_outlined, color: Colors.white),
        const SizedBox(width: 10),
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'อ่านมิเตอร์จากรูปภาพ',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 17,
                  fontWeight: FontWeight.w900,
                ),
              ),
              Text(
                'AI ตรวจภาพ · ผู้ใช้ทบทวนก่อนบันทึก',
                style: TextStyle(color: Color(0xBFFFFFFF), fontSize: 11),
              ),
            ],
          ),
        ),
        IconButton(
          onPressed: _busy ? null : () => Navigator.pop(context),
          icon: const Icon(Icons.close_rounded, color: Colors.white),
        ),
      ],
    ),
  );

  Widget _reviewCard(_ReviewRow row, int index) {
    final confidence = (row.confidence * 100).round();
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              row.imageName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
            Text(
              'ตู้ ${row.pumpNumber ?? '-'} · จอ ${row.side} · ความมั่นใจ $confidence%${row.valid ? '' : ' · ต้องตรวจทาน'}',
              style: TextStyle(
                fontSize: 10.5,
                color: row.valid
                    ? const Color(0xFF138A58)
                    : const Color(0xFFB42318),
              ),
            ),
            if (row.issue.isNotEmpty)
              Text(
                row.issue,
                style: const TextStyle(
                  fontSize: 10.5,
                  color: Color(0xFF8A6100),
                ),
              ),
            const SizedBox(height: 9),
            DropdownButtonFormField<int>(
              key: ValueKey('meter-nozzle-$index-${row.nozzleId}'),
              initialValue: row.nozzleId,
              decoration: const InputDecoration(labelText: 'หัวจ่าย'),
              items: widget.shift.readings
                  .map(
                    (reading) => DropdownMenuItem(
                      value: reading.nozzleId,
                      child: Text('${reading.pumpName} · ${reading.label}'),
                    ),
                  )
                  .toList(),
              onChanged: (value) => setState(() => row.nozzleId = value),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                SizedBox(
                  width: 105,
                  child: DropdownButtonFormField<String>(
                    key: ValueKey('meter-mode-$index-${row.mode}'),
                    initialValue: row.mode == 'L' || row.mode == 'P'
                        ? row.mode
                        : null,
                    decoration: const InputDecoration(labelText: 'โหมด'),
                    items: const [
                      DropdownMenuItem(value: 'L', child: Text('L ลิตร')),
                      DropdownMenuItem(value: 'P', child: Text('P เงิน')),
                    ],
                    onChanged: (value) {
                      if (value != null) setState(() => row.mode = value);
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextFormField(
                    key: ValueKey('meter-value-$index-${row.value}'),
                    initialValue: row.value,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(labelText: 'เลขมิเตอร์'),
                    onChanged: (value) => row.value = value,
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

Future<_PreparedImage> _prepareImage(PlatformFile file) async {
  final source = await file.readAsBytes();
  var decoded = img.decodeImage(source);
  if (decoded == null) throw StateError('อ่านไฟล์ ${file.name} ไม่สำเร็จ');
  decoded = img.bakeOrientation(decoded);
  if (decoded.width > 1600 || decoded.height > 1600) {
    decoded = img.copyResize(
      decoded,
      width: decoded.width >= decoded.height ? 1600 : null,
      height: decoded.height > decoded.width ? 1600 : null,
      interpolation: img.Interpolation.average,
    );
  }
  Uint8List bytes = Uint8List.fromList(img.encodeJpg(decoded, quality: 86));
  if (base64Encode(bytes).length > 1250000) {
    bytes = Uint8List.fromList(img.encodeJpg(decoded, quality: 70));
  }
  if (base64Encode(bytes).length > 1250000) {
    decoded = img.copyResize(
      decoded,
      width: decoded.width >= decoded.height ? 1200 : null,
      height: decoded.height > decoded.width ? 1200 : null,
      interpolation: img.Interpolation.average,
    );
    bytes = Uint8List.fromList(img.encodeJpg(decoded, quality: 68));
  }
  final content = base64Encode(bytes);
  if (content.length > 1250000) {
    throw StateError('ไฟล์ ${file.name} มีขนาดใหญ่เกินไปหลังบีบอัด');
  }
  return _PreparedImage(name: file.name, contentBase64: content);
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

double _number(Object? value) => switch (value) {
  final num number => number.toDouble(),
  final String text => double.tryParse(text) ?? 0,
  _ => 0,
};

int _int(Object? value) => _number(value).round();
