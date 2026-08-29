import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';

Future<void> showCustomerLoyaltyQrSheet({
  required BuildContext context,
  required Uri loyaltyUri,
  required String stationName,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (context) => _CustomerLoyaltyQrSheet(
      loyaltyUri: loyaltyUri,
      stationName: stationName,
    ),
  );
}

class _CustomerLoyaltyQrSheet extends StatelessWidget {
  const _CustomerLoyaltyQrSheet({
    required this.loyaltyUri,
    required this.stationName,
  });

  final Uri loyaltyUri;
  final String stationName;

  Future<void> _share(BuildContext context) async {
    final renderBox = context.findRenderObject() as RenderBox?;
    await SharePlus.instance.share(
      ShareParams(
        title: 'ตรวจสอบแต้มสมาชิก $stationName',
        text: 'ตรวจสอบแต้มสมาชิกและประวัติการรับ–ใช้แต้มได้ที่\n$loyaltyUri',
        sharePositionOrigin: renderBox == null
            ? null
            : renderBox.localToGlobal(Offset.zero) & renderBox.size,
      ),
    );
  }

  Future<void> _copy(BuildContext context) async {
    await Clipboard.setData(ClipboardData(text: loyaltyUri.toString()));
    if (!context.mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('คัดลอกลิงก์แล้ว')));
  }

  void _openPrintPreview(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (context) => _CustomerLoyaltyPosterPreview(
          loyaltyUri: loyaltyUri,
          stationName: stationName,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.viewPaddingOf(context).bottom;
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.94,
      ),
      decoration: const BoxDecoration(
        color: Color(0xFFF8F7FC),
        borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
      ),
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(20, 12, 20, 20 + bottomInset),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 44,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFD8D5E0),
                borderRadius: BorderRadius.circular(99),
              ),
            ),
            const SizedBox(height: 18),
            Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: const Color(0xFFECE9FF),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: const Icon(
                    Icons.qr_code_2_rounded,
                    color: Color(0xFF6554D9),
                    size: 28,
                  ),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'QR ตรวจสอบแต้มสมาชิก',
                        style: TextStyle(
                          color: Color(0xFF242238),
                          fontSize: 18,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      SizedBox(height: 2),
                      Text(
                        'ลูกค้าสแกนแล้วกรอกเบอร์โทรที่สมัครสมาชิก',
                        style: TextStyle(
                          color: Color(0xFF777487),
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'ปิด',
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close_rounded),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Container(
              key: const Key('customer-loyalty-qr-card'),
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(20, 22, 20, 20),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Color(0xFF111B38), Color(0xFF243B77)],
                ),
                borderRadius: BorderRadius.circular(26),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x33243B77),
                    blurRadius: 28,
                    offset: Offset(0, 12),
                  ),
                ],
              ),
              child: Column(
                children: [
                  Text(
                    stationName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'MEMBER CLUB',
                    style: TextStyle(
                      color: Color(0xFF8FE7ED),
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 2,
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'สแกนเช็กแต้มสะสม',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 24,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 14),
                  Container(
                    width: 218,
                    height: 218,
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(22),
                    ),
                    child: QrImageView(
                      key: const Key('customer-loyalty-qr'),
                      data: loyaltyUri.toString(),
                      version: QrVersions.auto,
                      errorCorrectionLevel: QrErrorCorrectLevel.H,
                      backgroundColor: Colors.white,
                      eyeStyle: const QrEyeStyle(
                        eyeShape: QrEyeShape.square,
                        color: Color(0xFF10182F),
                      ),
                      dataModuleStyle: const QrDataModuleStyle(
                        dataModuleShape: QrDataModuleShape.square,
                        color: Color(0xFF10182F),
                      ),
                    ),
                  ),
                  const SizedBox(height: 15),
                  const Text(
                    '1. สแกน QR  •  2. กรอกเบอร์  •  3. ดูแต้ม',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Color(0xFFD7E7FF),
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(15),
                border: Border.all(color: const Color(0xFFE5E2EE)),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.link_rounded,
                    size: 18,
                    color: Color(0xFF6554D9),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      loyaltyUri.toString(),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF555166),
                        fontSize: 11,
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: () => _copy(context),
                    child: const Text('คัดลอก'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    key: const Key('share-customer-loyalty-link'),
                    onPressed: () => _share(context),
                    icon: const Icon(Icons.ios_share_rounded),
                    label: const Text('แชร์ลิงก์'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton.icon(
                    key: const Key('print-customer-loyalty-qr'),
                    onPressed: () => _openPrintPreview(context),
                    icon: const Icon(Icons.print_outlined),
                    label: const Text('พิมพ์ป้าย A5'),
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

class _CustomerLoyaltyPosterPreview extends StatelessWidget {
  const _CustomerLoyaltyPosterPreview({
    required this.loyaltyUri,
    required this.stationName,
  });

  final Uri loyaltyUri;
  final String stationName;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('พิมพ์ป้าย QR ตรวจแต้ม')),
      body: PdfPreview(
        build: (_) => buildCustomerLoyaltyPosterPdf(
          loyaltyUri: loyaltyUri,
          stationName: stationName,
        ),
        initialPageFormat: PdfPageFormat.a5,
        canChangePageFormat: false,
        canChangeOrientation: false,
        allowPrinting: true,
        allowSharing: true,
        pdfFileName: 'member-points-qr.pdf',
      ),
    );
  }
}

Future<Uint8List> buildCustomerLoyaltyPosterPdf({
  required Uri loyaltyUri,
  required String stationName,
}) async {
  final regular = await PdfGoogleFonts.sarabunRegular();
  final bold = await PdfGoogleFonts.sarabunBold();
  final document = pw.Document(
    theme: pw.ThemeData.withFont(base: regular, bold: bold),
  );
  document.addPage(
    pw.Page(
      pageFormat: PdfPageFormat.a5,
      margin: pw.EdgeInsets.zero,
      build: (context) => pw.Container(
        color: const PdfColor.fromInt(0xFF111B38),
        padding: const pw.EdgeInsets.all(28),
        child: pw.Column(
          mainAxisAlignment: pw.MainAxisAlignment.center,
          children: [
            pw.Text(
              stationName,
              textAlign: pw.TextAlign.center,
              style: pw.TextStyle(
                color: PdfColors.white,
                fontSize: 17,
                fontWeight: pw.FontWeight.bold,
              ),
            ),
            pw.SizedBox(height: 5),
            pw.Text(
              'MEMBER CLUB',
              style: const pw.TextStyle(
                color: PdfColor.fromInt(0xFF8FE7ED),
                fontSize: 10,
                letterSpacing: 2,
              ),
            ),
            pw.SizedBox(height: 22),
            pw.Text(
              'สแกนเช็กแต้มสะสม',
              textAlign: pw.TextAlign.center,
              style: pw.TextStyle(
                color: PdfColors.white,
                fontSize: 25,
                fontWeight: pw.FontWeight.bold,
              ),
            ),
            pw.SizedBox(height: 10),
            pw.Text(
              'ดูแต้มคงเหลือ พร้อมประวัติการรับและใช้แต้ม',
              textAlign: pw.TextAlign.center,
              style: const pw.TextStyle(
                color: PdfColor.fromInt(0xFFD7E7FF),
                fontSize: 11,
              ),
            ),
            pw.SizedBox(height: 24),
            pw.Container(
              width: 220,
              height: 220,
              padding: const pw.EdgeInsets.all(12),
              decoration: pw.BoxDecoration(
                color: PdfColors.white,
                borderRadius: pw.BorderRadius.circular(16),
              ),
              child: pw.BarcodeWidget(
                barcode: pw.Barcode.qrCode(
                  errorCorrectLevel: pw.BarcodeQRCorrectionLevel.high,
                ),
                data: loyaltyUri.toString(),
                color: const PdfColor.fromInt(0xFF10182F),
              ),
            ),
            pw.SizedBox(height: 22),
            pw.Text(
              '1. สแกน QR   •   2. กรอกเบอร์สมาชิก   •   3. ดูแต้ม',
              textAlign: pw.TextAlign.center,
              style: pw.TextStyle(
                color: PdfColors.white,
                fontSize: 11,
                fontWeight: pw.FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
    ),
  );
  return document.save();
}
