import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../data/operations_repository.dart';

Future<bool> showZReportPreview({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
  required DateTime date,
  required String printedBy,
}) async {
  final dateKey = DateFormat('yyyy-MM-dd').format(date);
  final responses = await Future.wait<Object?>([
    repository.queryProcedure(
      'reports.daily',
      branchId: branchId,
      input: <String, Object?>{'date': dateKey},
    ),
    repository.queryProcedure('catalog.getSettings', branchId: branchId),
    repository.queryProcedure('catalog.getShopLogo', branchId: branchId),
  ]);
  if (!context.mounted) return false;
  await Navigator.of(context).push<void>(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => Scaffold(
        appBar: AppBar(title: Text('Z-Report $dateKey')),
        body: PdfPreview(
          canChangeOrientation: false,
          canChangePageFormat: false,
          canDebug: false,
          allowPrinting: true,
          allowSharing: true,
          pdfFileName: 'z_report_$dateKey.pdf',
          build: (_) => _buildPdf(
            report: _map(responses[0]),
            settings: _map(responses[1]),
            logoUrl: _nullableText(responses[2]),
            printedBy: printedBy,
          ),
        ),
      ),
    ),
  );
  return false;
}

Future<Uint8List> _buildPdf({
  required Map<String, dynamic> report,
  required Map<String, dynamic> settings,
  required String? logoUrl,
  required String printedBy,
}) async {
  final regular = await PdfGoogleFonts.sarabunRegular();
  final bold = await PdfGoogleFonts.sarabunBold();
  pw.ImageProvider? logo;
  if (logoUrl != null) {
    try {
      logo = await networkImage(logoUrl);
    } catch (_) {
      logo = null;
    }
  }
  final expenses = _map(report['expenses']);
  final expenseItems = _maps(expenses['items']);
  final debts = _map(report['debtPayments']);
  final debtItems = _maps(debts['items']);
  final fuelItems = _maps(report['fuelLiters']);
  final rowCount = expenseItems.length + debtItems.length + fuelItems.length;
  final heightMm = (230 + rowCount * 8).clamp(260, 950).toDouble();
  final document = pw.Document(
    theme: pw.ThemeData.withFont(base: regular, bold: bold),
  );
  document.addPage(
    pw.Page(
      pageFormat: PdfPageFormat(
        80 * PdfPageFormat.mm,
        heightMm * PdfPageFormat.mm,
        marginAll: 5 * PdfPageFormat.mm,
      ),
      build: (_) => pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.stretch,
        children: [
          if (logo != null)
            pw.Center(
              child: pw.Image(logo, height: 36, fit: pw.BoxFit.contain),
            ),
          pw.Center(
            child: pw.Text(
              '${_text(settings['shop_name'], fallback: 'PumpPOS')}${_text(settings['shop_branch']).isEmpty ? '' : ' สาขา ${_text(settings['shop_branch'])}'}',
              style: pw.TextStyle(font: bold, fontSize: 12),
              textAlign: pw.TextAlign.center,
            ),
          ),
          if (_text(settings['shop_address']).isNotEmpty)
            pw.Center(
              child: pw.Text(
                _text(settings['shop_address']),
                style: const pw.TextStyle(fontSize: 8),
                textAlign: pw.TextAlign.center,
              ),
            ),
          if (_text(settings['shop_phone']).isNotEmpty)
            pw.Center(
              child: pw.Text(
                'โทร. ${_text(settings['shop_phone'])}',
                style: const pw.TextStyle(fontSize: 8),
              ),
            ),
          pw.SizedBox(height: 5),
          pw.Center(
            child: pw.Text(
              'รายงานปิดวัน (Z-Report)',
              style: pw.TextStyle(font: bold, fontSize: 11),
            ),
          ),
          pw.Center(
            child: pw.Text(
              'ประจำวันที่ ${_date(report['date'])}',
              style: const pw.TextStyle(fontSize: 8.5),
            ),
          ),
          _divider(),
          _pair('ยอดขายรวม', _money(_number(report['totalSales'])), bold: true),
          _pair('จำนวนบิล', '${_int(report['billCount'])} บิล'),
          _pair(
            'บิลยกเลิก',
            '${_int(report['voidedCount'])} บิล / ${_money(_number(report['voidedTotal']))}',
          ),
          _pair('ส่วนลด', _money(_number(report['discountTotal']))),
          _pair('ภาษีมูลค่าเพิ่ม (รวมใน)', _money(_number(report['vatTotal']))),
          _section('แยกตามวิธีชำระ'),
          for (final method in const [
            'cash',
            'qr',
            'card',
            'credit',
            'thungngern',
          ])
            _pair(
              '${_paymentMethod(method)} (${_int(_map(_map(report['byMethod'])[method])['count'])})',
              _money(_number(_map(_map(report['byMethod'])[method])['total'])),
            ),
          _section('ปริมาณน้ำมันขาย (ลิตร)'),
          if (fuelItems.isEmpty) pw.Text('— ไม่มีรายการ —'),
          for (final fuel in fuelItems)
            _pair(_text(fuel['name']), _decimal(_number(fuel['liters']))),
          _pair(
            'รวมลิตร',
            _decimal(_number(report['totalLiters'])),
            bold: true,
          ),
          _section('ค่าใช้จ่ายหน้าร้าน (${expenseItems.length} รายการ)'),
          for (final expense in expenseItems)
            _pair(_text(expense['title']), _money(_number(expense['amount']))),
          _pair(
            'รวมค่าใช้จ่าย',
            _money(_number(expenses['total'])),
            bold: true,
          ),
          _section('รับชำระหนี้ (${debtItems.length} รายการ)'),
          for (final debt in debtItems)
            _pair(
              '${_text(debt['customerName'])} · ${_text(debt['paymentNo'])}',
              _money(_number(debt['amount'])),
            ),
          for (final method in const ['cash', 'qr', 'transfer'])
            _pair(
              '— ${_debtMethod(method)}',
              _money(_number(_map(debts['byMethod'])[method])),
            ),
          _pair('รวมรับชำระหนี้', _money(_number(debts['total'])), bold: true),
          _divider(),
          pw.Text(
            '= ขายเงินสด + ชำระหนี้เงินสด − ค่าใช้จ่าย',
            style: const pw.TextStyle(fontSize: 7.5),
          ),
          _pair(
            'เงินสดที่ควรมีในลิ้นชัก',
            _money(_number(report['expectedCash'])),
            bold: true,
            fontSize: 10,
          ),
          _divider(),
          pw.Text('พิมพ์โดย : ${printedBy.isEmpty ? '-' : printedBy}'),
          pw.Text('เวลาพิมพ์ : ${_dateTime(DateTime.now())}'),
          pw.SizedBox(height: 8),
          pw.Center(child: pw.Text('*** สิ้นสุดรายงาน ***')),
        ],
      ),
    ),
  );
  return document.save();
}

pw.Widget _section(String title) => pw.Column(
  crossAxisAlignment: pw.CrossAxisAlignment.stretch,
  children: [
    _divider(),
    pw.Text(
      title,
      style: pw.TextStyle(fontWeight: pw.FontWeight.bold, fontSize: 8.5),
    ),
  ],
);

pw.Widget _divider() => pw.Divider(height: 7, color: PdfColors.black);

pw.Widget _pair(
  String label,
  String value, {
  bool bold = false,
  double fontSize = 8,
}) => pw.Row(
  crossAxisAlignment: pw.CrossAxisAlignment.start,
  children: [
    pw.Expanded(
      child: pw.Text(
        label,
        style: pw.TextStyle(
          fontWeight: bold ? pw.FontWeight.bold : null,
          fontSize: fontSize,
        ),
      ),
    ),
    pw.SizedBox(width: 4),
    pw.Text(
      value,
      style: pw.TextStyle(
        fontWeight: bold ? pw.FontWeight.bold : null,
        fontSize: fontSize,
      ),
    ),
  ],
);

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

String? _nullableText(Object? value) {
  final text = _text(value);
  return text.isEmpty ? null : text;
}

double _number(Object? value) => switch (value) {
  final num number => number.toDouble(),
  final String text => double.tryParse(text) ?? 0,
  _ => 0,
};

int _int(Object? value) => _number(value).round();

String _money(double value) => NumberFormat('#,##0.00', 'th_TH').format(value);
String _decimal(double value) =>
    NumberFormat('#,##0.###', 'th_TH').format(value);

String _date(Object? value) {
  final date = DateTime.tryParse(value?.toString() ?? '');
  return date == null ? '-' : DateFormat('d MMMM yyyy', 'th_TH').format(date);
}

String _dateTime(Object? value) {
  final date = value is DateTime
      ? value
      : DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  return date == null
      ? '-'
      : DateFormat('d MMM yyyy HH:mm', 'th_TH').format(date);
}

String _paymentMethod(String value) => switch (value) {
  'cash' => 'เงินสด',
  'qr' => 'QR โอนเงิน',
  'card' => 'บัตร',
  'credit' => 'ขายเชื่อ',
  'thungngern' => 'QR ถุงเงิน',
  _ => value,
};

String _debtMethod(String value) => switch (value) {
  'cash' => 'เงินสด',
  'qr' => 'QR โอนเงิน',
  'transfer' => 'โอนเงิน',
  _ => value,
};
