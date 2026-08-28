import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../data/operations_repository.dart';

Future<bool> showSaleReceiptPreview({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
  required int saleId,
}) async {
  final responses = await Future.wait<Object?>([
    repository.queryProcedure(
      'pos.saleDetail',
      branchId: branchId,
      input: {'id': saleId},
    ),
    repository.queryProcedure('catalog.getSettings', branchId: branchId),
    repository.queryProcedure('catalog.getShopLogo', branchId: branchId),
  ]);
  final detail = _map(responses[0]);
  final sale = _map(detail['sale']);
  String? paymentQr;
  if (_text(sale['paymentMethod']) == 'qr' &&
      _text(sale['transactionType']) != 'return' &&
      _number(sale['total']).abs() > 0) {
    final qr = _map(
      await repository.queryProcedure(
        'payments.promptpayQr',
        branchId: branchId,
        input: {'amount': _round2(_number(sale['total']).abs())},
      ),
    );
    paymentQr = _nullableText(qr['payload']);
  }
  if (!context.mounted) return false;
  await Navigator.of(context).push<void>(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => _PdfDocumentPreview(
        title: _text(sale['transactionType']) == 'return'
            ? 'เอกสารคืนสินค้า ${_text(sale['receiptNo'])}'
            : 'ใบเสร็จ ${_text(sale['receiptNo'])}',
        fileName: 'receipt_${_safeFileName(_text(sale['receiptNo']))}.pdf',
        buildPdf: () => _buildReceiptPdf(
          detail: detail,
          settings: _map(responses[1]),
          logoUrl: _nullableText(responses[2]),
          paymentQr: paymentQr,
        ),
      ),
    ),
  );
  return false;
}

Future<bool> showTaxInvoicePreview({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
  required int saleId,
}) async {
  final responses = await Future.wait<Object?>([
    repository.queryProcedure(
      'pos.saleDetail',
      branchId: branchId,
      input: {'id': saleId},
    ),
    repository.queryProcedure(
      'taxInvoice.bySale',
      branchId: branchId,
      input: {'saleId': saleId},
    ),
    repository.queryProcedure('catalog.getSettings', branchId: branchId),
    repository.queryProcedure('catalog.getShopLogo', branchId: branchId),
  ]);
  final detail = _map(responses[0]);
  final invoice = _map(responses[1]);
  if (invoice.isEmpty) {
    throw StateError('ยังไม่มีใบกำกับภาษีสำหรับบิลนี้');
  }
  if (!context.mounted) return false;
  await Navigator.of(context).push<void>(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => _PdfDocumentPreview(
        title: 'ใบกำกับภาษี ${_text(invoice['taxInvoiceNo'])}',
        fileName:
            'tax_invoice_${_safeFileName(_text(invoice['taxInvoiceNo']))}.pdf',
        buildPdf: () => _buildTaxInvoicePdf(
          detail: detail,
          invoice: invoice,
          settings: _map(responses[2]),
          logoUrl: _nullableText(responses[3]),
        ),
      ),
    ),
  );
  return false;
}

class _PdfDocumentPreview extends StatelessWidget {
  const _PdfDocumentPreview({
    required this.title,
    required this.fileName,
    required this.buildPdf,
  });

  final String title;
  final String fileName;
  final Future<Uint8List> Function() buildPdf;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: PdfPreview(
        canChangeOrientation: false,
        canChangePageFormat: false,
        canDebug: false,
        allowPrinting: true,
        allowSharing: true,
        pdfFileName: fileName,
        build: (_) => buildPdf(),
      ),
    );
  }
}

Future<Uint8List> _buildReceiptPdf({
  required Map<String, dynamic> detail,
  required Map<String, dynamic> settings,
  required String? logoUrl,
  required String? paymentQr,
}) async {
  final regular = await PdfGoogleFonts.sarabunRegular();
  final bold = await PdfGoogleFonts.sarabunBold();
  final logo = await _loadLogo(logoUrl);
  final sale = _map(detail['sale']);
  final items = _maps(detail['items']);
  final isReturn = _text(sale['transactionType']) == 'return';
  final heightMm = (130 + items.length * 15).clamp(170, 800).toDouble();
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
              child: pw.Image(logo, height: 42, fit: pw.BoxFit.contain),
            ),
          pw.Center(
            child: pw.Text(
              _text(settings['shop_name'], fallback: 'PumpPOS'),
              style: pw.TextStyle(font: bold, fontSize: 15),
            ),
          ),
          if (_text(settings['shop_branch']).isNotEmpty)
            pw.Center(child: pw.Text('สาขา ${_text(settings['shop_branch'])}')),
          if (_text(settings['shop_address']).isNotEmpty)
            pw.Center(
              child: pw.Text(
                _text(settings['shop_address']),
                textAlign: pw.TextAlign.center,
                style: const pw.TextStyle(fontSize: 8),
              ),
            ),
          if (_text(settings['shop_phone']).isNotEmpty)
            pw.Center(
              child: pw.Text(
                'โทร. ${_text(settings['shop_phone'])}',
                style: const pw.TextStyle(fontSize: 8),
              ),
            ),
          pw.SizedBox(height: 7),
          pw.Container(
            padding: const pw.EdgeInsets.symmetric(vertical: 4),
            decoration: const pw.BoxDecoration(
              border: pw.Border.symmetric(
                horizontal: pw.BorderSide(width: 1.2),
              ),
            ),
            child: pw.Center(
              child: pw.Text(
                isReturn
                    ? 'ใบรับคืนสินค้า / ใบคืนเงิน'
                    : 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ',
                style: pw.TextStyle(font: bold, fontSize: 10),
              ),
            ),
          ),
          if (_text(settings['tax_id']).isNotEmpty)
            pw.Center(
              child: pw.Text(
                'เลขประจำตัวผู้เสียภาษี ${_text(settings['tax_id'])}',
                style: const pw.TextStyle(fontSize: 7.5),
              ),
            ),
          pw.SizedBox(height: 7),
          _pdfPair('เลขที่บิล', _text(sale['receiptNo']), bold: true),
          if (isReturn && _map(detail['originalSale']).isNotEmpty)
            _pdfPair(
              'อ้างอิงบิล',
              _text(_map(detail['originalSale'])['receiptNo']),
            ),
          _pdfPair('วันที่', _dateTime(sale['createdAt'])),
          if (_text(sale['staffName']).isNotEmpty)
            _pdfPair('พนักงาน', _text(sale['staffName'])),
          if (_text(detail['memberName']).isNotEmpty)
            _pdfPair('สมาชิก', _text(detail['memberName'])),
          if (_text(detail['customerName']).isNotEmpty)
            _pdfPair('ลูกค้า', _text(detail['customerName'])),
          pw.Divider(borderStyle: pw.BorderStyle.dashed),
          for (final item in items) ...[
            pw.Row(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Expanded(
                  child: pw.Text(
                    _text(item['name'], fallback: 'สินค้า'),
                    style: pw.TextStyle(font: bold, fontSize: 8.5),
                  ),
                ),
                pw.SizedBox(width: 4),
                pw.Text(
                  _money(_number(item['amount']).abs()),
                  style: pw.TextStyle(font: bold, fontSize: 8.5),
                ),
              ],
            ),
            pw.Text(
              '${_decimal(_number(item['qty']).abs())} ${_text(item['unit'])} × ${_money(_number(item['unitPrice']))}',
              style: const pw.TextStyle(
                fontSize: 7.5,
                color: PdfColors.grey700,
              ),
            ),
            pw.SizedBox(height: 3),
          ],
          pw.Divider(borderStyle: pw.BorderStyle.dashed),
          _pdfPair(
            isReturn ? 'มูลค่าสินค้าคืน' : 'รวม',
            _money(_number(sale['subtotal']).abs()),
          ),
          if (_number(sale['discount']).abs() > 0)
            _pdfPair('ส่วนลด', _money(_number(sale['discount']).abs())),
          _pdfPair(
            'ภาษีมูลค่าเพิ่ม ${_decimal(_number(sale['vatRate']))}% (รวมใน)',
            _money(_number(sale['vatAmount']).abs()),
          ),
          pw.Container(
            margin: const pw.EdgeInsets.symmetric(vertical: 5),
            padding: const pw.EdgeInsets.symmetric(vertical: 5),
            decoration: const pw.BoxDecoration(
              border: pw.Border.symmetric(
                horizontal: pw.BorderSide(width: 1.2),
              ),
            ),
            child: _pdfPair(
              isReturn ? 'ยอดคืนเงิน' : 'ยอดสุทธิ',
              '฿${_money(_number(sale['total']).abs())}',
              bold: true,
              fontSize: 11,
            ),
          ),
          _pdfPair(
            isReturn ? 'คืนเงินโดย' : 'ชำระโดย',
            _paymentLabel(sale['paymentMethod']),
            bold: true,
          ),
          if (!isReturn && _text(sale['paymentMethod']) == 'cash') ...[
            _pdfPair('รับเงิน', _money(_number(sale['received']))),
            _pdfPair('เงินทอน', _money(_number(sale['changeAmt']))),
          ],
          if (_number(sale['pointsEarned']) != 0)
            _pdfPair(
              'แต้มที่ได้รับ',
              _signedInt(_number(sale['pointsEarned'])),
            ),
          if (_number(sale['pointsRedeemed']) != 0)
            _pdfPair(
              'แต้มที่ใช้',
              _signedInt(-_number(sale['pointsRedeemed'])),
            ),
          if (paymentQr != null) ...[
            pw.SizedBox(height: 8),
            pw.Center(
              child: pw.BarcodeWidget(
                barcode: pw.Barcode.qrCode(),
                data: paymentQr,
                width: 92,
                height: 92,
              ),
            ),
            pw.Center(
              child: pw.Text(
                'สแกนเพื่อชำระเงินตามยอดในบิล',
                style: const pw.TextStyle(fontSize: 7.5),
              ),
            ),
          ],
          if (_text(sale['status']) == 'voided') ...[
            pw.SizedBox(height: 10),
            pw.Center(
              child: pw.Text(
                'ยกเลิก',
                style: pw.TextStyle(
                  font: bold,
                  fontSize: 24,
                  color: PdfColors.red,
                ),
              ),
            ),
          ],
          pw.SizedBox(height: 9),
          pw.Center(
            child: pw.Text(
              isReturn
                  ? 'โปรดเก็บเอกสารนี้ไว้เป็นหลักฐาน'
                  : 'ขอบคุณที่ใช้บริการ',
              style: pw.TextStyle(font: bold, fontSize: 8.5),
            ),
          ),
        ],
      ),
    ),
  );
  return document.save();
}

Future<Uint8List> _buildTaxInvoicePdf({
  required Map<String, dynamic> detail,
  required Map<String, dynamic> invoice,
  required Map<String, dynamic> settings,
  required String? logoUrl,
}) async {
  final regular = await PdfGoogleFonts.sarabunRegular();
  final bold = await PdfGoogleFonts.sarabunBold();
  final logo = await _loadLogo(logoUrl);
  final sale = _map(detail['sale']);
  final items = _maps(detail['items']);
  final a5 = _text(settings['tax_invoice_paper_size']).toLowerCase() == 'a5';
  final pageFormat = a5 ? PdfPageFormat.a5 : PdfPageFormat.a4;
  final document = pw.Document(
    theme: pw.ThemeData.withFont(base: regular, bold: bold),
  );
  document.addPage(
    pw.MultiPage(
      pageFormat: pageFormat,
      margin: pw.EdgeInsets.all(a5 ? 18 : 28),
      header: (_) => pw.Column(
        children: [
          pw.Row(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              if (logo != null) ...[
                pw.Image(logo, width: a5 ? 42 : 58, height: a5 ? 42 : 58),
                pw.SizedBox(width: 9),
              ],
              pw.Expanded(
                child: pw.Column(
                  crossAxisAlignment: pw.CrossAxisAlignment.start,
                  children: [
                    pw.Text(
                      _text(settings['shop_name'], fallback: 'PumpPOS'),
                      style: pw.TextStyle(font: bold, fontSize: a5 ? 12 : 15),
                    ),
                    pw.Text(
                      'เลขประจำตัวผู้เสียภาษี ${_text(settings['tax_id'], fallback: '-')}',
                      style: pw.TextStyle(fontSize: a5 ? 7.5 : 9),
                    ),
                    pw.Text(
                      'สาขาที่ ${_text(settings['shop_branch'], fallback: '-')}',
                      style: pw.TextStyle(fontSize: a5 ? 7.5 : 9),
                    ),
                    if (_text(settings['shop_address']).isNotEmpty)
                      pw.Text(
                        _text(settings['shop_address']),
                        style: pw.TextStyle(fontSize: a5 ? 7.5 : 9),
                      ),
                    if (_text(settings['shop_phone']).isNotEmpty)
                      pw.Text(
                        'โทร. ${_text(settings['shop_phone'])}',
                        style: pw.TextStyle(fontSize: a5 ? 7.5 : 9),
                      ),
                  ],
                ),
              ),
              pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.end,
                children: [
                  pw.Text(
                    'ใบเสร็จรับเงิน / ใบกำกับภาษี',
                    style: pw.TextStyle(font: bold, fontSize: a5 ? 13 : 19),
                  ),
                  pw.Text(
                    'RECEIPT / TAX INVOICE',
                    style: pw.TextStyle(fontSize: a5 ? 8 : 10),
                  ),
                ],
              ),
            ],
          ),
          pw.SizedBox(height: a5 ? 10 : 18),
        ],
      ),
      build: (_) => [
        pw.Row(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Expanded(
              child: pw.Container(
                padding: const pw.EdgeInsets.all(7),
                decoration: pw.BoxDecoration(border: pw.Border.all(width: .5)),
                child: pw.Column(
                  crossAxisAlignment: pw.CrossAxisAlignment.start,
                  children: [
                    _pdfLabel(
                      'ข้อมูลลูกค้า',
                      _text(invoice['customerName']),
                      bold,
                    ),
                    _pdfLabel(
                      'เลขประจำตัวผู้เสียภาษี',
                      '${_text(invoice['customerTaxId'], fallback: '-')}${_text(invoice['customerBranch']).isEmpty ? '' : ' ${_text(invoice['customerBranch'])}'}',
                      bold,
                    ),
                    if (_text(invoice['customerAddress']).isNotEmpty)
                      _pdfLabel(
                        'ที่อยู่',
                        _text(invoice['customerAddress']),
                        bold,
                      ),
                    if (_text(invoice['customerPhone']).isNotEmpty)
                      _pdfLabel(
                        'โทรศัพท์',
                        _text(invoice['customerPhone']),
                        bold,
                      ),
                    if (_text(invoice['vehiclePlate']).isNotEmpty)
                      _pdfLabel(
                        'ทะเบียนรถ',
                        _text(invoice['vehiclePlate']),
                        bold,
                      ),
                  ],
                ),
              ),
            ),
            pw.SizedBox(width: 8),
            pw.Expanded(
              child: pw.Container(
                padding: const pw.EdgeInsets.all(7),
                decoration: pw.BoxDecoration(border: pw.Border.all(width: .5)),
                child: pw.Column(
                  crossAxisAlignment: pw.CrossAxisAlignment.start,
                  children: [
                    _pdfLabel(
                      'เลขที่ใบกำกับ',
                      _text(invoice['taxInvoiceNo']),
                      bold,
                    ),
                    _pdfLabel(
                      'เลขที่ใบเสร็จย่อ',
                      _text(sale['receiptNo']),
                      bold,
                    ),
                    _pdfLabel('วันที่ขาย', _dateTime(sale['createdAt']), bold),
                    _pdfLabel('วันที่พิมพ์', _dateTime(DateTime.now()), bold),
                    _pdfLabel(
                      'พนักงาน',
                      _text(
                        sale['staffName'],
                        fallback: _text(invoice['issuedBy'], fallback: '-'),
                      ),
                      bold,
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
        pw.SizedBox(height: 12),
        pw.Table(
          border: const pw.TableBorder(
            top: pw.BorderSide(width: 1),
            bottom: pw.BorderSide(width: 1),
            horizontalInside: pw.BorderSide(width: .25),
          ),
          columnWidths: const {
            0: pw.FixedColumnWidth(26),
            1: pw.FlexColumnWidth(3),
            2: pw.FlexColumnWidth(1.2),
            3: pw.FlexColumnWidth(1.1),
            4: pw.FlexColumnWidth(1.3),
          },
          children: [
            _taxTableRow(
              ['ลำดับ', 'รายการ', 'ราคา/หน่วย', 'จำนวน', 'จำนวนเงิน'],
              bold,
              header: true,
            ),
            for (var index = 0; index < items.length; index++)
              _taxTableRow([
                '${index + 1}',
                _text(items[index]['name'], fallback: 'สินค้า'),
                _money(_number(items[index]['unitPrice'])),
                '${_decimal(_number(items[index]['qty']).abs())} ${_text(items[index]['unit'])}',
                _money(_number(items[index]['amount']).abs()),
              ], bold),
          ],
        ),
        pw.SizedBox(height: 10),
        pw.Row(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Expanded(
              child: pw.Text(
                'ชำระโดย ${_paymentLabel(sale['paymentMethod'])}',
                style: pw.TextStyle(fontSize: a5 ? 8 : 9),
              ),
            ),
            pw.SizedBox(width: 16),
            pw.SizedBox(
              width: a5 ? 175 : 225,
              child: pw.Column(
                children: [
                  if (_number(sale['discount']) > 0) ...[
                    _pdfPair('รวม', _money(_number(sale['subtotal']))),
                    _pdfPair('ส่วนลด', '-${_money(_number(sale['discount']))}'),
                  ],
                  _pdfPair(
                    'มูลค่าสินค้า',
                    _money(_number(sale['total']) - _number(sale['vatAmount'])),
                  ),
                  _pdfPair(
                    'ภาษีมูลค่าเพิ่ม ${_decimal(_number(sale['vatRate']))}%',
                    _money(_number(sale['vatAmount'])),
                  ),
                  pw.Divider(height: 5),
                  _pdfPair(
                    'รวมเป็นเงิน',
                    _money(_number(sale['total'])),
                    bold: true,
                    fontSize: a5 ? 10 : 12,
                  ),
                ],
              ),
            ),
          ],
        ),
        if (_text(sale['status']) == 'voided')
          pw.Center(
            child: pw.Text(
              'ยกเลิก',
              style: pw.TextStyle(
                font: bold,
                fontSize: 38,
                color: PdfColors.red,
              ),
            ),
          ),
        pw.SizedBox(height: a5 ? 24 : 40),
        pw.Divider(color: PdfColors.black),
        pw.Text(
          'ได้รับสินค้าตามรายการข้างต้นนี้ไว้ถูกต้องและเรียบร้อยทุกประการ',
          style: pw.TextStyle(fontSize: a5 ? 8 : 9),
        ),
        pw.SizedBox(height: a5 ? 12 : 20),
        pw.Text(
          'ลงชื่อผู้รับสินค้า/ผู้รับเงิน ........................................................................',
          style: pw.TextStyle(fontSize: a5 ? 8 : 9),
        ),
      ],
    ),
  );
  return document.save();
}

pw.TableRow _taxTableRow(
  List<String> cells,
  pw.Font bold, {
  bool header = false,
}) {
  return pw.TableRow(
    children: [
      for (var index = 0; index < cells.length; index++)
        pw.Padding(
          padding: const pw.EdgeInsets.symmetric(horizontal: 3, vertical: 4),
          child: pw.Text(
            cells[index],
            textAlign: index == 1
                ? pw.TextAlign.left
                : index == 0
                ? pw.TextAlign.center
                : pw.TextAlign.right,
            style: pw.TextStyle(
              font: header ? bold : null,
              fontSize: header ? 8.5 : 8,
            ),
          ),
        ),
    ],
  );
}

pw.Widget _pdfLabel(String label, String value, pw.Font bold) {
  return pw.Padding(
    padding: const pw.EdgeInsets.only(bottom: 2),
    child: pw.RichText(
      text: pw.TextSpan(
        style: const pw.TextStyle(fontSize: 8),
        children: [
          pw.TextSpan(
            text: '$label: ',
            style: pw.TextStyle(font: bold),
          ),
          pw.TextSpan(text: value),
        ],
      ),
    ),
  );
}

pw.Widget _pdfPair(
  String label,
  String value, {
  bool bold = false,
  double fontSize = 8.5,
}) {
  return pw.Row(
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
      pw.SizedBox(width: 5),
      pw.Text(
        value,
        textAlign: pw.TextAlign.right,
        style: pw.TextStyle(
          fontWeight: bold ? pw.FontWeight.bold : null,
          fontSize: fontSize,
        ),
      ),
    ],
  );
}

Future<pw.ImageProvider?> _loadLogo(String? url) async {
  if (url == null || url.isEmpty) return null;
  try {
    return await networkImage(url);
  } catch (_) {
    return null;
  }
}

Map<String, dynamic> _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) {
    return value.map((key, item) => MapEntry(key.toString(), item));
  }
  return const {};
}

List<Map<String, dynamic>> _maps(Object? value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
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

double _round2(double value) => (value * 100).roundToDouble() / 100;

String _money(double value) => NumberFormat('#,##0.00', 'th_TH').format(value);

String _decimal(double value) =>
    NumberFormat('#,##0.###', 'th_TH').format(value);

String _signedInt(double value) =>
    value >= 0 ? '+${value.round()}' : '${value.round()}';

String _dateTime(Object? value) {
  final date = value is DateTime
      ? value
      : DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  return date == null
      ? '-'
      : DateFormat('d MMM yyyy HH:mm', 'th_TH').format(date);
}

String _paymentLabel(Object? value) => switch (_text(value)) {
  'cash' => 'เงินสด',
  'qr' => 'QR โอนเงิน',
  'card' => 'บัตร',
  'credit' => 'ขายเชื่อ',
  'thungngern' => 'QR ถุงเงิน',
  final other => other.isEmpty ? '-' : other,
};

String _safeFileName(String value) =>
    value.replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '_');
