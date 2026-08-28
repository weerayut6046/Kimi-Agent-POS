import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../auth/domain/staff_session.dart';
import '../data/operations_repository.dart';

Future<bool> showCustomerDocument({
  required BuildContext context,
  required OperationsRepository repository,
  required StaffSession staff,
  required String type,
  Map<String, dynamic>? customer,
}) async {
  final selected =
      customer ??
      await showModalBottomSheet<Map<String, dynamic>>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (context) => FractionallySizedBox(
          heightFactor: .88,
          child: _CustomerPicker(
            repository: repository,
            branchId: staff.branch.id,
          ),
        ),
      );
  if (selected == null || !context.mounted) return false;

  final settings = _map(
    await repository.queryProcedure(
      'catalog.getSettings',
      branchId: staff.branch.id,
    ),
  );
  if (!context.mounted) return false;
  await Navigator.of(context).push<void>(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (context) => _DocumentPreview(
        type: type,
        customer: selected,
        settings: settings,
        staffName: staff.name,
      ),
    ),
  );
  return false;
}

class _CustomerPicker extends StatefulWidget {
  const _CustomerPicker({required this.repository, required this.branchId});

  final OperationsRepository repository;
  final int branchId;

  @override
  State<_CustomerPicker> createState() => _CustomerPickerState();
}

class _CustomerPickerState extends State<_CustomerPicker> {
  final _search = TextEditingController();
  late final Future<List<Map<String, dynamic>>> _customers;
  String _query = '';

  @override
  void initState() {
    super.initState();
    _customers = widget.repository
        .queryProcedure(
          'customers.list',
          branchId: widget.branchId,
          input: {'limit': 200},
        )
        .then(_maps);
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('เลือกลูกค้าที่จะออกเอกสาร')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 8, 14, 10),
            child: TextField(
              controller: _search,
              autofocus: true,
              onChanged: (value) => setState(() => _query = value),
              decoration: const InputDecoration(
                labelText: 'ชื่อ / เลขผู้เสียภาษี / ทะเบียนรถ',
                prefixIcon: Icon(Icons.search_rounded),
              ),
            ),
          ),
          Expanded(
            child: FutureBuilder<List<Map<String, dynamic>>>(
              future: _customers,
              builder: (context, snapshot) {
                if (!snapshot.hasData && !snapshot.hasError) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        '${snapshot.error}',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  );
                }
                final query = _query.trim().toLowerCase();
                final rows = snapshot.data!
                    .where(
                      (row) =>
                          query.isEmpty ||
                          [
                            row['name'],
                            row['taxId'],
                            row['phone'],
                            row['vehiclePlate'],
                          ].any(
                            (value) =>
                                value.toString().toLowerCase().contains(query),
                          ),
                    )
                    .toList();
                if (rows.isEmpty) {
                  return const Center(child: Text('ไม่พบลูกค้า'));
                }
                return ListView.separated(
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 24),
                  itemCount: rows.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 7),
                  itemBuilder: (context, index) {
                    final row = rows[index];
                    return Card(
                      margin: EdgeInsets.zero,
                      child: ListTile(
                        leading: const CircleAvatar(
                          child: Icon(Icons.business_outlined),
                        ),
                        title: Text(
                          _text(row['name'], fallback: 'ไม่ระบุชื่อ'),
                          style: const TextStyle(fontWeight: FontWeight.w900),
                        ),
                        subtitle: Text(
                          [
                            _text(row['taxId']),
                            _text(row['branch']),
                            _text(row['vehiclePlate']),
                          ].where((value) => value.isNotEmpty).join(' · '),
                        ),
                        trailing: const Icon(Icons.chevron_right_rounded),
                        onTap: () => Navigator.pop(context, row),
                      ),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _DocumentPreview extends StatelessWidget {
  const _DocumentPreview({
    required this.type,
    required this.customer,
    required this.settings,
    required this.staffName,
  });

  final String type;
  final Map<String, dynamic> customer;
  final Map<String, dynamic> settings;
  final String staffName;

  @override
  Widget build(BuildContext context) {
    final title = type == 'vehicle-fleet'
        ? 'รายการรถบรรทุก / เครื่องจักร'
        : 'ใบขอเปิดบัญชีลูกค้าเครดิต';
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: PdfPreview(
        canChangeOrientation: false,
        canChangePageFormat: false,
        canDebug: false,
        allowPrinting: true,
        allowSharing: true,
        pdfFileName:
            '${type}_${_text(customer['name'], fallback: 'customer')}.pdf',
        build: (_) => _buildDocumentPdf(
          type: type,
          customer: customer,
          settings: settings,
          staffName: staffName,
        ),
      ),
    );
  }
}

Future<Uint8List> _buildDocumentPdf({
  required String type,
  required Map<String, dynamic> customer,
  required Map<String, dynamic> settings,
  required String staffName,
}) async {
  final regular = await PdfGoogleFonts.sarabunRegular();
  final bold = await PdfGoogleFonts.sarabunBold();
  final document = pw.Document(
    theme: pw.ThemeData.withFont(base: regular, bold: bold),
  );
  if (type == 'vehicle-fleet') {
    document.addPage(
      pw.Page(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(24),
        build: (context) => _vehicleFleetPage(
          customer: customer,
          settings: settings,
          staffName: staffName,
        ),
      ),
    );
  } else {
    document.addPage(
      pw.Page(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(24),
        build: (context) => _creditRequestPage(
          customer: customer,
          settings: settings,
          staffName: staffName,
        ),
      ),
    );
  }
  return document.save();
}

pw.Widget _header({
  required String title,
  required String subtitle,
  required Map<String, dynamic> settings,
}) {
  final shopName = _text(settings['shop_name'], fallback: 'PumpPOS');
  return pw.Column(
    children: [
      pw.Container(
        width: double.infinity,
        padding: const pw.EdgeInsets.symmetric(vertical: 8, horizontal: 12),
        decoration: pw.BoxDecoration(
          color: const PdfColor.fromInt(0xFF243B6B),
          borderRadius: pw.BorderRadius.circular(8),
        ),
        child: pw.Column(
          children: [
            pw.Text(
              shopName,
              style: pw.TextStyle(
                color: PdfColors.white,
                fontSize: 16,
                fontWeight: pw.FontWeight.bold,
              ),
            ),
            pw.Text(
              title,
              style: pw.TextStyle(
                color: PdfColors.white,
                fontSize: 14,
                fontWeight: pw.FontWeight.bold,
              ),
            ),
            pw.Text(
              subtitle,
              style: const pw.TextStyle(color: PdfColors.white, fontSize: 9),
            ),
          ],
        ),
      ),
      pw.SizedBox(height: 6),
      pw.Text(
        [
          _text(settings['shop_address']),
          _text(settings['shop_phone']),
          if (_text(settings['shop_tax_id']).isNotEmpty)
            'เลขผู้เสียภาษี ${_text(settings['shop_tax_id'])}',
        ].where((value) => value.isNotEmpty).join(' · '),
        style: const pw.TextStyle(fontSize: 8),
      ),
    ],
  );
}

pw.Widget _creditRequestPage({
  required Map<String, dynamic> customer,
  required Map<String, dynamic> settings,
  required String staffName,
}) {
  final shopName = _text(settings['shop_name'], fallback: 'สถานีบริการ');
  return pw.Column(
    crossAxisAlignment: pw.CrossAxisAlignment.stretch,
    children: [
      _header(
        title: 'แบบฟอร์มการขอเปิดเครดิต',
        subtitle: 'เติมน้ำมันสำหรับลูกค้าธุรกิจ',
        settings: settings,
      ),
      pw.SizedBox(height: 8),
      _section('1. ข้อมูลสถานประกอบการ', [
        _line('ชื่อกิจการ / บริษัท', _text(customer['name'])),
        _line('ชื่อผู้ประกอบการ / ผู้มีอำนาจลงนาม', ''),
        _line('ที่อยู่สำนักงาน', _text(customer['address'])),
        _line('โทรศัพท์ / มือถือ', _text(customer['phone'])),
        _line('เลขประจำตัวผู้เสียภาษี', _text(customer['taxId'])),
        _line('สาขา', _text(customer['branch'])),
        _line('ประเภทธุรกิจ', '□ รับเหมา  □ ขนส่ง  □ ก่อสร้าง  □ อื่น ๆ'),
      ]),
      pw.SizedBox(height: 6),
      pw.Row(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Expanded(
            child: _section('2. ผู้ติดต่อ / ผู้ดูแลบัญชี', [
              _line('ชื่อ-สกุล', ''),
              _line('ตำแหน่ง', ''),
              _line('โทรศัพท์', ''),
              _line('E-mail', ''),
            ]),
          ),
          pw.SizedBox(width: 6),
          pw.Expanded(
            child: _section('3. ข้อมูลการดำเนินงาน', [
              _line('ลักษณะงาน', ''),
              _line('พื้นที่ดำเนินงาน', ''),
              _line('จำนวนรถ / เครื่องจักร', '____________ คัน/เครื่อง'),
              _line('วงเงินเครดิตที่ขอ', '____________ บาท'),
            ]),
          ),
        ],
      ),
      pw.SizedBox(height: 6),
      _section('เอกสารประกอบการขอเปิดเครดิต', [
        pw.Text(
          '□ หนังสือขอเปิดเครดิต  □ สำเนาบัตรประชาชนผู้มีอำนาจ  □ หนังสือรับรองนิติบุคคลไม่เกิน 6 เดือน',
          style: const pw.TextStyle(fontSize: 8),
        ),
        pw.Text(
          '□ ภ.พ.20 / บัตรผู้เสียภาษี  □ สำเนาบัญชีธนาคารย้อนหลัง 6 เดือน  □ รายการรถ/เครื่องจักร  □ ใบสั่งซื้อ/สัญญางาน',
          style: const pw.TextStyle(fontSize: 8),
        ),
        pw.Text(
          'หมายเหตุ: เอกสารทุกฉบับต้องเซ็นรับรองสำเนาถูกต้องและประทับตราบริษัท (ถ้ามี)',
          style: const pw.TextStyle(fontSize: 7),
        ),
      ]),
      pw.SizedBox(height: 6),
      _section('เงื่อนไขการชำระเงินและการใช้เครดิต', [
        pw.Text(
          '1. กำหนดชำระตามรอบวางบิลที่บริษัทอนุมัติ หากชำระล่าช้าอาจมีค่าใช้จ่ายตามเงื่อนไขของบริษัท',
          style: const pw.TextStyle(fontSize: 8),
        ),
        pw.Text(
          '2. ใช้สิทธิ์เติมน้ำมันที่ $shopName เท่านั้น และไม่สามารถโอนสิทธิ์ให้บุคคลอื่น',
          style: const pw.TextStyle(fontSize: 8),
        ),
        pw.Text(
          '3. บริษัทขอสงวนสิทธิ์พิจารณา/ปรับวงเงิน และระงับเครดิตเมื่อผิดนัดชำระ',
          style: const pw.TextStyle(fontSize: 8),
        ),
      ]),
      pw.Spacer(),
      _signatures(staffName),
      pw.SizedBox(height: 4),
      pw.Text(
        'พิมพ์จาก PumpPOS Mobile · ${DateFormat('d MMMM yyyy', 'th_TH').format(DateTime.now())}',
        textAlign: pw.TextAlign.center,
        style: const pw.TextStyle(fontSize: 7, color: PdfColors.grey700),
      ),
    ],
  );
}

pw.Widget _vehicleFleetPage({
  required Map<String, dynamic> customer,
  required Map<String, dynamic> settings,
  required String staffName,
}) {
  const rowCount = 15;
  final vehiclePlate = _text(customer['vehiclePlate']);
  return pw.Column(
    crossAxisAlignment: pw.CrossAxisAlignment.stretch,
    children: [
      _header(
        title: 'แบบฟอร์มรายการรถบรรทุก / เครื่องจักรที่ใช้งาน',
        subtitle: 'สำหรับขอเปิดเครดิตเติมน้ำมัน',
        settings: settings,
      ),
      pw.SizedBox(height: 8),
      _section('ข้อมูลกิจการ', [
        _line('ชื่อกิจการ / บริษัท', _text(customer['name'])),
        _line('เลขประจำตัวผู้เสียภาษี', _text(customer['taxId'])),
        _line('เบอร์โทรศัพท์', _text(customer['phone'])),
        _line(
          'วันที่ยื่นเอกสาร',
          DateFormat('d MMMM yyyy', 'th_TH').format(DateTime.now()),
        ),
      ]),
      pw.SizedBox(height: 7),
      pw.Text(
        'กรุณากรอกรายการรถบรรทุก/เครื่องจักรที่ใช้ในกิจการ เพื่อใช้เติมน้ำมันภายใต้เงื่อนไขเครดิตของสถานี',
        style: const pw.TextStyle(fontSize: 8),
      ),
      pw.SizedBox(height: 6),
      pw.Table(
        border: pw.TableBorder.all(color: PdfColors.grey600, width: .6),
        columnWidths: const {
          0: pw.FixedColumnWidth(28),
          1: pw.FlexColumnWidth(1.4),
          2: pw.FlexColumnWidth(1),
          3: pw.FlexColumnWidth(1.2),
          4: pw.FixedColumnWidth(42),
          5: pw.FlexColumnWidth(1.1),
          6: pw.FlexColumnWidth(1.1),
        },
        children: [
          pw.TableRow(
            decoration: const pw.BoxDecoration(
              color: PdfColor.fromInt(0xFF243B6B),
            ),
            children: [
              for (final title in const [
                'ลำดับ',
                'ประเภทรถ / เครื่องจักร',
                'ยี่ห้อ / รุ่น',
                'ทะเบียน / เลขตัวถัง',
                'จำนวน',
                'ชื่อผู้ขับ / ผู้ควบคุม',
                'โทรศัพท์',
              ])
                pw.Padding(
                  padding: const pw.EdgeInsets.all(3),
                  child: pw.Text(
                    title,
                    textAlign: pw.TextAlign.center,
                    style: pw.TextStyle(
                      color: PdfColors.white,
                      fontSize: 7,
                      fontWeight: pw.FontWeight.bold,
                    ),
                  ),
                ),
            ],
          ),
          for (var index = 0; index < rowCount; index++)
            pw.TableRow(
              children: [
                _cell('${index + 1}', center: true),
                _cell(''),
                _cell(''),
                _cell(index == 0 ? vehiclePlate : '', center: true),
                _cell(
                  index == 0 && vehiclePlate.isNotEmpty ? '1' : '',
                  center: true,
                ),
                _cell(''),
                _cell(''),
              ],
            ),
        ],
      ),
      pw.SizedBox(height: 5),
      pw.Text(
        'หมายเหตุ: หากมีมากกว่า $rowCount รายการ กรุณาแนบเอกสารเพิ่มเติม',
        style: const pw.TextStyle(fontSize: 7),
      ),
      pw.Spacer(),
      _signatures(staffName),
    ],
  );
}

pw.Widget _section(String title, List<pw.Widget> children) => pw.Container(
  width: double.infinity,
  padding: const pw.EdgeInsets.all(7),
  decoration: pw.BoxDecoration(
    border: pw.Border.all(color: PdfColors.grey600, width: .7),
    borderRadius: pw.BorderRadius.circular(6),
  ),
  child: pw.Column(
    crossAxisAlignment: pw.CrossAxisAlignment.stretch,
    children: [
      pw.Text(
        title,
        style: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold),
      ),
      pw.SizedBox(height: 4),
      ...children,
    ],
  ),
);

pw.Widget _line(String label, String value) => pw.Padding(
  padding: const pw.EdgeInsets.symmetric(vertical: 2),
  child: pw.Row(
    children: [
      pw.Text('$label: ', style: const pw.TextStyle(fontSize: 8)),
      pw.Expanded(
        child: pw.Container(
          padding: const pw.EdgeInsets.only(bottom: 1),
          decoration: const pw.BoxDecoration(
            border: pw.Border(bottom: pw.BorderSide(width: .5)),
          ),
          child: pw.Text(value, style: const pw.TextStyle(fontSize: 8)),
        ),
      ),
    ],
  ),
);

pw.Widget _cell(String value, {bool center = false}) => pw.Container(
  height: 24,
  alignment: center ? pw.Alignment.center : pw.Alignment.centerLeft,
  padding: const pw.EdgeInsets.all(2),
  child: pw.Text(value, style: const pw.TextStyle(fontSize: 7)),
);

pw.Widget _signatures(String staffName) => pw.Row(
  children: [
    pw.Expanded(child: _signatureBox('ผู้ยื่นคำขอ', '')),
    pw.SizedBox(width: 10),
    pw.Expanded(child: _signatureBox('ผู้รับเรื่อง / ตรวจสอบโดย', staffName)),
  ],
);

pw.Widget _signatureBox(String role, String name) => pw.Container(
  height: 74,
  padding: const pw.EdgeInsets.all(7),
  decoration: pw.BoxDecoration(
    border: pw.Border.all(color: PdfColors.grey600, width: .7),
    borderRadius: pw.BorderRadius.circular(6),
  ),
  child: pw.Column(
    mainAxisAlignment: pw.MainAxisAlignment.end,
    children: [
      pw.Text(
        'ลงชื่อ __________________________________',
        style: const pw.TextStyle(fontSize: 8),
      ),
      pw.Text(
        '(${name.isEmpty ? '__________________________________' : name})',
        style: const pw.TextStyle(fontSize: 8),
      ),
      pw.Text(
        '$role  วันที่ ____ / ____ / ______',
        style: const pw.TextStyle(fontSize: 8),
      ),
    ],
  ),
);

Map<String, dynamic> _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  throw const FormatException('Invalid JSON object');
}

List<Map<String, dynamic>> _maps(Object? value) => value is List
    ? value
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList()
    : const [];

String _text(Object? value, {String fallback = ''}) {
  final result = value?.toString().trim() ?? '';
  return result.isEmpty || result == 'null' ? fallback : result;
}
