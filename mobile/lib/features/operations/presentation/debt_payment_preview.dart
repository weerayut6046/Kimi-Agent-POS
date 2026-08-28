import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../data/operations_repository.dart';

Future<void> showDebtPaymentPreview({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
  required Map<String, dynamic> payment,
  required String customerName,
}) async {
  final responses = await Future.wait<Object?>([
    repository.queryProcedure('catalog.getSettings', branchId: branchId),
    repository.queryProcedure('catalog.getShopLogo', branchId: branchId),
  ]);
  if (!context.mounted) return;
  final paymentNo = _text(payment['paymentNo'], fallback: 'debt-payment');
  await Navigator.of(context).push<void>(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => Scaffold(
        appBar: AppBar(title: Text('ใบรับชำระหนี้ $paymentNo')),
        body: PdfPreview(
          canChangeOrientation: false,
          canChangePageFormat: false,
          canDebug: false,
          allowPrinting: true,
          allowSharing: true,
          pdfFileName: 'debt_payment_${_safeFileName(paymentNo)}.pdf',
          build: (_) => _buildPdf(
            payment: payment,
            customerName: customerName,
            settings: _map(responses[0]),
            logoUrl: _nullableText(responses[1]),
          ),
        ),
      ),
    ),
  );
}

Future<Uint8List> _buildPdf({
  required Map<String, dynamic> payment,
  required String customerName,
  required Map<String, dynamic> settings,
  required String? logoUrl,
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
  final document = pw.Document(
    theme: pw.ThemeData.withFont(base: regular, bold: bold),
  );
  document.addPage(
    pw.Page(
      pageFormat: PdfPageFormat(
        80 * PdfPageFormat.mm,
        150 * PdfPageFormat.mm,
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
          pw.SizedBox(height: 6),
          pw.Center(
            child: pw.Text(
              'ใบรับชำระหนี้',
              style: pw.TextStyle(font: bold, fontSize: 12),
            ),
          ),
          pw.SizedBox(height: 8),
          pw.Text('เลขที่ : ${_text(payment['paymentNo'])}'),
          pw.Text('วันที่ : ${_dateTime(payment['createdAt'])}'),
          pw.Text('ลูกค้า : $customerName'),
          if (_text(payment['staffName']).isNotEmpty)
            pw.Text('พนักงาน : ${_text(payment['staffName'])}'),
          pw.SizedBox(height: 5),
          pw.Divider(color: PdfColors.black),
          _pair('ยอดรับชำระ', _money(_number(payment['amount'])), bold: true),
          _pair('ชำระโดย', _method(payment['method'])),
          if (_text(payment['note']).isNotEmpty)
            pw.Text(
              'หมายเหตุ : ${_text(payment['note'])}',
              style: const pw.TextStyle(fontSize: 8.5),
            ),
          pw.SizedBox(height: 10),
          pw.Center(
            child: pw.Text(
              'ขอบคุณที่ใช้บริการ',
              style: const pw.TextStyle(fontSize: 9),
            ),
          ),
        ],
      ),
    ),
  );
  return document.save();
}

pw.Widget _pair(String label, String value, {bool bold = false}) => pw.Row(
  children: [
    pw.Expanded(
      child: pw.Text(
        label,
        style: pw.TextStyle(
          fontWeight: bold ? pw.FontWeight.bold : null,
          fontSize: bold ? 10.5 : 9,
        ),
      ),
    ),
    pw.Text(
      value,
      style: pw.TextStyle(
        fontWeight: bold ? pw.FontWeight.bold : null,
        fontSize: bold ? 10.5 : 9,
      ),
    ),
  ],
);

Map<String, dynamic> _map(Object? value) =>
    value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

String _text(Object? value, {String fallback = ''}) {
  final valueText = value?.toString().trim() ?? '';
  return valueText.isEmpty ? fallback : valueText;
}

String? _nullableText(Object? value) {
  final valueText = _text(value);
  return valueText.isEmpty ? null : valueText;
}

double _number(Object? value) => switch (value) {
  final num number => number.toDouble(),
  final String valueText => double.tryParse(valueText) ?? 0,
  _ => 0,
};

String _money(double value) => NumberFormat('#,##0.00', 'th_TH').format(value);

String _dateTime(Object? value) {
  final date = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  return date == null
      ? '-'
      : DateFormat('d MMM yyyy HH:mm', 'th_TH').format(date);
}

String _method(Object? value) => switch (_text(value)) {
  'cash' => 'เงินสด',
  'qr' => 'QR โอนเงิน',
  'transfer' => 'โอนเงิน',
  final other => other.isEmpty ? '-' : other,
};

String _safeFileName(String value) =>
    value.replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '_');
