import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../auth/domain/staff_session.dart';
import '../data/operations_repository.dart';
import '../domain/operations_models.dart';
import 'catalog_reorder_sheet.dart';
import 'customer_document_sheet.dart';
import 'database_admin_actions.dart';
import 'debt_payment_preview.dart';
import 'formula_audit_sheet.dart';
import 'manual_sale_sheet.dart';
import 'member_card_export.dart';
import 'report_export_actions.dart';
import 'sale_document_preview.dart';
import 'settings_admin_actions.dart';
import 'z_report_preview.dart';

bool hasOperationCreateActions(OperationsModule module, StaffSession staff) =>
    switch (module) {
      OperationsModule.workforce => staff.role == StaffRole.admin,
      OperationsModule.stock => staff.role == StaffRole.admin,
      OperationsModule.stockCount => staff.role != StaffRole.cashier,
      OperationsModule.members => true,
      OperationsModule.memberCards => staff.role != StaffRole.cashier,
      OperationsModule.customers => staff.role != StaffRole.cashier,
      OperationsModule.sales => staff.role != StaffRole.cashier,
      OperationsModule.expenses => true,
      OperationsModule.taxInvoices => staff.role == StaffRole.admin,
      OperationsModule.security => staff.role == StaffRole.admin,
      OperationsModule.audit => staff.role == StaffRole.admin,
      OperationsModule.settings => staff.role == StaffRole.admin,
      OperationsModule.reports => true,
      OperationsModule.fuelStockReport => staff.role != StaffRole.cashier,
      _ => false,
    };

bool hasOperationItemActions(OperationItem item, StaffSession staff) {
  final manager = staff.role != StaffRole.cashier;
  final admin = staff.role == StaffRole.admin;
  return switch (item.entity) {
    OperationEntity.schedule => manager,
    OperationEntity.shiftTemplate ||
    OperationEntity.employeeProfile ||
    OperationEntity.payroll => admin,
    OperationEntity.tank => true,
    OperationEntity.tankReading => admin,
    OperationEntity.product => admin,
    OperationEntity.stockCountSession => true,
    OperationEntity.member => true,
    OperationEntity.reward => admin,
    OperationEntity.memberCardBatch => manager,
    OperationEntity.customer => manager,
    OperationEntity.debt => manager,
    OperationEntity.sale => true,
    OperationEntity.expense => manager,
    OperationEntity.taxInvoice => true,
    OperationEntity.documentTemplate => manager,
    OperationEntity.securityEvent => admin,
    OperationEntity.setting ||
    OperationEntity.shopProfileConfig ||
    OperationEntity.documentConfig ||
    OperationEntity.membershipConfig ||
    OperationEntity.checkoutConfig ||
    OperationEntity.automaticBackupConfig => admin,
    OperationEntity.perLiterPromotionConfig ||
    OperationEntity.billPromotionConfig => manager,
    OperationEntity.branch ||
    OperationEntity.accessGroup ||
    OperationEntity.pump ||
    OperationEntity.nozzle ||
    OperationEntity.paymentConfig ||
    OperationEntity.assistantConfig => admin,
    _ => false,
  };
}

Future<bool> showOperationCreateActions({
  required BuildContext context,
  required OperationsModule module,
  required StaffSession staff,
  required OperationsRepository repository,
  DateTime? date,
}) async {
  final actions = await _createActions(
    context: context,
    module: module,
    staff: staff,
    repository: repository,
    date: date ?? DateTime.now(),
  );
  if (!context.mounted || actions.isEmpty) return false;
  return _runSelectedAction(
    context,
    actions,
    title: module == OperationsModule.settings
        ? 'เครื่องมือตั้งค่าระบบ'
        : 'เลือกการทำงาน',
  );
}

Future<bool> showOperationItemActions({
  required BuildContext context,
  required OperationItem item,
  required StaffSession staff,
  required OperationsRepository repository,
}) async {
  final actions = await _itemActions(
    context: context,
    item: item,
    staff: staff,
    repository: repository,
  );
  if (!context.mounted || actions.isEmpty) return false;
  return _runSelectedAction(context, actions, title: 'จัดการ ${item.title}');
}

Future<bool> _runSelectedAction(
  BuildContext context,
  List<_ActionDescriptor> actions, {
  String title = 'เลือกการทำงาน',
}) async {
  if (actions.length == 1) return actions.first.run();
  final selected = await showModalBottomSheet<int>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (sheetContext) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: actions.length > 6 ? 0.82 : 0.52,
      minChildSize: 0.35,
      maxChildSize: 0.94,
      builder: (sheetContext, scrollController) => Container(
        decoration: const BoxDecoration(
          color: Color(0xFFF8F7FB),
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: Column(
          children: [
            const SizedBox(height: 10),
            Container(
              width: 42,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFD8D5E0),
                borderRadius: BorderRadius.circular(99),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 16, 10, 11),
              child: Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: const Color(0xFFECE9FF),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Icon(
                      Icons.tune_rounded,
                      color: Color(0xFF6554D9),
                    ),
                  ),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(sheetContext).textTheme.titleLarge
                              ?.copyWith(fontWeight: FontWeight.w900),
                        ),
                        Text(
                          '${actions.length} เครื่องมือ · เลื่อนเพื่อดูทั้งหมด',
                          style: const TextStyle(
                            color: Color(0xFF777487),
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: 'ปิด',
                    onPressed: () => Navigator.pop(sheetContext),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: ListView.separated(
                controller: scrollController,
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
                itemCount: actions.length,
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, index) {
                  final action = actions[index];
                  final color = action.danger
                      ? const Color(0xFFC94B4B)
                      : const Color(0xFF6554D9);
                  return Material(
                    color: action.danger
                        ? const Color(0xFFFFF1F1)
                        : Colors.white,
                    borderRadius: BorderRadius.circular(17),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(17),
                      onTap: () => Navigator.pop(sheetContext, index),
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(12, 11, 10, 11),
                        child: Row(
                          children: [
                            Container(
                              width: 42,
                              height: 42,
                              decoration: BoxDecoration(
                                color: color.withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(13),
                              ),
                              child: Icon(action.icon, color: color, size: 21),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Text(
                                action.label,
                                style: TextStyle(
                                  color: action.danger ? color : null,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                            Icon(Icons.chevron_right_rounded, color: color),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    ),
  );
  if (selected == null || !context.mounted) return false;
  return actions[selected].run();
}

Future<List<_ActionDescriptor>> _createActions({
  required BuildContext context,
  required OperationsModule module,
  required StaffSession staff,
  required OperationsRepository repository,
  required DateTime date,
}) async {
  final branchId = staff.branch.id;
  switch (module) {
    case OperationsModule.workforce:
      if (staff.role != StaffRole.admin) return const [];
      final data = await Future.wait<Object?>([
        repository.queryProcedure('auth.listStaff', branchId: branchId),
        repository.queryProcedure(
          'workforce.listTemplates',
          branchId: branchId,
        ),
        repository.queryProcedure(
          'workforce.scheduleList',
          branchId: branchId,
          input: <String, Object?>{
            'startDate': DateFormat('yyyy-MM-dd').format(date),
            'endDate': DateFormat(
              'yyyy-MM-dd',
            ).format(date.add(const Duration(days: 6))),
          },
        ),
      ]);
      if (!context.mounted) return const [];
      final scheduleRows = _maps(data[2]);
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'เพิ่มตารางงาน',
          icon: Icons.event_available_outlined,
          spec: _scheduleSpec(
            staffRows: _maps(data[0]),
            templateRows: _maps(data[1]),
          ),
        ),
        if (scheduleRows.length >= 2)
          _formAction(
            context: context,
            repository: repository,
            branchId: branchId,
            label: 'สลับกะพนักงาน',
            icon: Icons.swap_horiz_rounded,
            spec: _swapSchedulesSpec(scheduleRows),
          ),
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'เพิ่มรูปแบบกะ',
          icon: Icons.more_time_rounded,
          spec: _shiftTemplateSpec(),
        ),
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'คำนวณเงินเดือน',
          icon: Icons.calculate_outlined,
          spec: _generatePayrollSpec(),
        ),
      ];
    case OperationsModule.stock:
      if (staff.role != StaffRole.admin) return const [];
      final products = _maps(
        await repository.queryProcedure(
          'catalog.listProducts',
          branchId: branchId,
        ),
      );
      if (!context.mounted) return const [];
      final fuelChoices = products
          .where((row) => _text(row['category']) == 'fuel')
          .map(
            (row) => _Choice(
              value: _int(row['id']),
              label: '${_text(row['code'])} · ${_text(row['name'])}',
            ),
          )
          .toList();
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'เพิ่มสินค้า',
          icon: Icons.add_box_outlined,
          spec: _productSpec(),
        ),
        if (fuelChoices.isNotEmpty)
          _formAction(
            context: context,
            repository: repository,
            branchId: branchId,
            label: 'เพิ่มถังน้ำมัน',
            icon: Icons.oil_barrel_outlined,
            spec: _tankSpec(productChoices: fuelChoices),
          ),
        _ActionDescriptor(
          label: 'จัดลำดับถังน้ำมัน',
          icon: Icons.swap_vert_rounded,
          run: () => showCatalogReorderSheet(
            context: context,
            repository: repository,
            branchId: branchId,
            tanks: true,
          ),
        ),
        _ActionDescriptor(
          label: 'จัดลำดับสินค้า',
          icon: Icons.format_list_numbered_rounded,
          run: () => showCatalogReorderSheet(
            context: context,
            repository: repository,
            branchId: branchId,
            tanks: false,
          ),
        ),
      ];
    case OperationsModule.stockCount:
      if (staff.role == StaffRole.cashier) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'เริ่มรอบตรวจนับ',
          icon: Icons.playlist_add_check_rounded,
          spec: _stockCountSessionSpec(),
        ),
      ];
    case OperationsModule.members:
      final actions = <_ActionDescriptor>[
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'สมัครสมาชิก',
          icon: Icons.person_add_alt_1_rounded,
          spec: _memberSpec(),
        ),
      ];
      if (staff.role == StaffRole.admin) {
        actions.add(
          _formAction(
            context: context,
            repository: repository,
            branchId: branchId,
            label: 'เพิ่มของรางวัล',
            icon: Icons.card_giftcard_rounded,
            spec: _rewardSpec(),
          ),
        );
      }
      return actions;
    case OperationsModule.memberCards:
      if (staff.role == StaffRole.cashier) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'สร้างชุดบัตรสมาชิก',
          icon: Icons.badge_outlined,
          spec: _memberCardBatchSpec(),
        ),
      ];
    case OperationsModule.customers:
      if (staff.role == StaffRole.cashier) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'เพิ่มลูกค้าธุรกิจ',
          icon: Icons.domain_add_outlined,
          spec: _customerSpec(),
        ),
      ];
    case OperationsModule.expenses:
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'บันทึกค่าใช้จ่าย',
          icon: Icons.add_card_rounded,
          spec: _expenseSpec(staffName: staff.name),
        ),
      ];
    case OperationsModule.sales:
      if (staff.role == StaffRole.cashier) return const [];
      return [
        _ActionDescriptor(
          label: 'เพิ่มบิลย้อนหลัง',
          icon: Icons.add_shopping_cart_rounded,
          run: () => showManualSaleSheet(
            context: context,
            repository: repository,
            staff: staff,
          ),
        ),
      ];
    case OperationsModule.taxInvoices:
      if (staff.role != StaffRole.admin) return const [];
      return [
        _ActionDescriptor(
          label: 'ออกใบกำกับภาษี',
          icon: Icons.post_add_rounded,
          run: () => _createTaxInvoice(
            context: context,
            repository: repository,
            staff: staff,
          ),
        ),
      ];
    case OperationsModule.security:
      if (staff.role != StaffRole.admin) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'สแกนความปลอดภัย',
          icon: Icons.radar_rounded,
          spec: _securityScanSpec(),
        ),
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'ให้ AI วิเคราะห์',
          icon: Icons.auto_awesome_rounded,
          spec: _securityAnalyzeSpec(),
        ),
      ];
    case OperationsModule.audit:
      if (staff.role != StaffRole.admin) return const [];
      return [
        _ActionDescriptor(
          label: 'ตรวจสอบสูตรด้วย AI Auditor',
          icon: Icons.rule_folder_outlined,
          run: () => showFormulaAuditSheet(
            context: context,
            repository: repository,
            staff: staff,
          ),
        ),
      ];
    case OperationsModule.reports:
      return [
        _ActionDescriptor(
          label: 'ดู / พิมพ์รายงานปิดวัน (Z-Report)',
          icon: Icons.print_outlined,
          run: () => showZReportPreview(
            context: context,
            repository: repository,
            branchId: branchId,
            date: date,
            printedBy: staff.name,
          ),
        ),
        if (staff.role != StaffRole.cashier) ...[
          _ActionDescriptor(
            label: 'ส่งออกรายงานวันที่เลือก (Excel)',
            icon: Icons.file_download_outlined,
            run: () => shareExcelReport(
              context: context,
              repository: repository,
              branchId: branchId,
              procedure: 'reports.exportDailyExcel',
              input: {'date': DateFormat('yyyy-MM-dd').format(date)},
            ),
          ),
          _ActionDescriptor(
            label: 'ส่งออกยอดขายช่วงเวลา (Excel)',
            icon: Icons.date_range_outlined,
            run: () => shareRangeExcelReport(
              context: context,
              repository: repository,
              branchId: branchId,
              initialDate: date,
            ),
          ),
        ],
      ];
    case OperationsModule.fuelStockReport:
      if (staff.role == StaffRole.cashier) return const [];
      return [
        _ActionDescriptor(
          label: 'ส่งออกรายงานสต็อกน้ำมัน (Excel)',
          icon: Icons.file_download_outlined,
          run: () => shareExcelReport(
            context: context,
            repository: repository,
            branchId: branchId,
            procedure: 'reports.exportFuelStockExcel',
            input: {'view': 'monthly', 'year': date.year, 'month': date.month},
          ),
        ),
        if (staff.role == StaffRole.admin)
          _ActionDescriptor(
            label: 'จัดลำดับถังน้ำมัน',
            icon: Icons.swap_vert_rounded,
            run: () => showCatalogReorderSheet(
              context: context,
              repository: repository,
              branchId: branchId,
              tanks: true,
            ),
          ),
      ];
    case OperationsModule.settings:
      if (staff.role != StaffRole.admin) return const [];
      final catalog = await Future.wait<Object?>([
        repository.queryProcedure('catalog.listPumps', branchId: branchId),
        repository.queryProcedure('catalog.listProducts', branchId: branchId),
        repository.queryProcedure('catalog.listTanks', branchId: branchId),
      ]);
      if (!context.mounted) return const [];
      final pumps = _maps(catalog[0]);
      final products = _maps(catalog[1]);
      final tanks = _maps(catalog[2]);
      return <_ActionDescriptor>[
        _ActionDescriptor(
          label: 'อัปโหลด / เปลี่ยนโลโก้ร้าน',
          icon: Icons.add_photo_alternate_outlined,
          run: () => updateShopLogo(
            context: context,
            repository: repository,
            branchId: branchId,
          ),
        ),
        _ActionDescriptor(
          label: 'ลบโลโก้ร้าน',
          icon: Icons.hide_image_outlined,
          danger: true,
          run: () => clearShopLogo(
            context: context,
            repository: repository,
            branchId: branchId,
          ),
        ),
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'เพิ่มสาขา',
          icon: Icons.add_business_outlined,
          spec: _branchSpec(),
        ),
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'เพิ่มกลุ่มสิทธิ์',
          icon: Icons.admin_panel_settings_outlined,
          spec: _accessGroupSpec(),
        ),
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'เพิ่มตู้จ่าย',
          icon: Icons.local_gas_station_outlined,
          spec: _pumpSpec(),
        ),
        _ActionDescriptor(
          label: 'ข้อมูลฐานข้อมูลและไฟล์สำรอง',
          icon: Icons.storage_rounded,
          run: () => showDatabaseInfo(
            context: context,
            repository: repository,
            branchId: branchId,
          ),
        ),
        _ActionDescriptor(
          label: 'สำรองฐานข้อมูลเป็นไฟล์',
          icon: Icons.cloud_download_outlined,
          run: () => backupDatabase(
            context: context,
            repository: repository,
            branchId: branchId,
          ),
        ),
        _ActionDescriptor(
          label: 'กู้คืนฐานข้อมูลจากไฟล์',
          icon: Icons.settings_backup_restore_rounded,
          danger: true,
          run: () => restoreDatabase(
            context: context,
            repository: repository,
            branchId: branchId,
          ),
        ),
        if (pumps.isNotEmpty &&
            products.any((row) => _text(row['category']) == 'fuel') &&
            tanks.isNotEmpty)
          _formAction(
            context: context,
            repository: repository,
            branchId: branchId,
            label: 'เพิ่มหัวจ่าย',
            icon: Icons.gas_meter_outlined,
            spec: _nozzleSpec(pumps: pumps, products: products, tanks: tanks),
          ),
      ];
    default:
      return const [];
  }
}

Future<List<_ActionDescriptor>> _itemActions({
  required BuildContext context,
  required OperationItem item,
  required StaffSession staff,
  required OperationsRepository repository,
}) async {
  final branchId = staff.branch.id;
  final row = item.record;
  final manager = staff.role != StaffRole.cashier;
  final admin = staff.role == StaffRole.admin;
  switch (item.entity) {
    case OperationEntity.schedule:
      final data = admin
          ? await Future.wait<Object?>([
              repository.queryProcedure('auth.listStaff', branchId: branchId),
              repository.queryProcedure(
                'workforce.listTemplates',
                branchId: branchId,
              ),
            ])
          : const <Object?>[];
      if (!context.mounted) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'แก้ยอดเบิกเงินล่วงหน้า',
          icon: Icons.payments_outlined,
          spec: _cashAdvanceSpec(row),
        ),
        if (admin)
          _formAction(
            context: context,
            repository: repository,
            branchId: branchId,
            label: 'แก้ไขตารางงาน',
            icon: Icons.edit_calendar_outlined,
            spec: _scheduleSpec(
              existing: row,
              staffRows: _maps(data[0]),
              templateRows: _maps(data[1]),
            ),
          ),
        if (admin)
          _deleteAction(
            context: context,
            repository: repository,
            branchId: branchId,
            label: 'ลบตารางงาน',
            procedure: 'workforce.deleteSchedule',
            input: {'id': _int(row['id'])},
            confirmation: 'ยืนยันลบตารางงานของ ${item.title} หรือไม่?',
          ),
      ];
    case OperationEntity.tank:
      final products = admin
          ? _maps(
              await repository.queryProcedure(
                'catalog.listProducts',
                branchId: branchId,
              ),
            )
          : const <Map<String, dynamic>>[];
      if (!context.mounted) return const [];
      final choices = products
          .where((product) => _text(product['category']) == 'fuel')
          .map(
            (product) => _Choice(
              value: _int(product['id']),
              label: '${_text(product['code'])} · ${_text(product['name'])}',
            ),
          )
          .toList();
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'รับน้ำมันเข้าถัง',
          icon: Icons.input_rounded,
          spec: _refillTankSpec(row),
        ),
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'บันทึกค่าวัดจริง',
          icon: Icons.straighten_rounded,
          spec: _tankReadingSpec(row),
        ),
        if (admin)
          _formAction(
            context: context,
            repository: repository,
            branchId: branchId,
            label: 'แก้ไขถัง',
            icon: Icons.edit_outlined,
            spec: _tankSpec(existing: row, productChoices: choices),
          ),
        if (admin)
          _deleteAction(
            context: context,
            repository: repository,
            branchId: branchId,
            label: 'ลบถัง',
            procedure: 'catalog.deleteTank',
            input: {'id': _int(row['id'])},
            confirmation:
                'ยืนยันลบถัง ${item.title} หรือไม่? ระบบจะไม่อนุญาตหากยังผูกกับหัวจ่าย',
          ),
      ];
    case OperationEntity.shiftTemplate:
      if (!admin) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'แก้ไขรูปแบบกะ',
          icon: Icons.edit_calendar_outlined,
          spec: _shiftTemplateSpec(existing: row),
        ),
        _deleteAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'ลบรูปแบบกะ',
          procedure: 'workforce.deleteTemplate',
          input: {'id': _int(row['id'])},
          confirmation:
              'ยืนยันลบรูปแบบกะ ${item.title} หรือไม่? รูปแบบที่มีตารางงานอ้างอิงอาจลบไม่ได้',
        ),
      ];
    case OperationEntity.employeeProfile:
      if (!admin) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'แก้ไขข้อมูลค่าจ้าง',
          icon: Icons.badge_outlined,
          spec: _employeeProfileSpec(row),
        ),
      ];
    case OperationEntity.payroll:
      if (!admin) return const [];
      return [
        if (_text(row['status']) != 'paid')
          _formAction(
            context: context,
            repository: repository,
            branchId: branchId,
            label: 'แก้ไขเงินเดือน',
            icon: Icons.edit_note_rounded,
            spec: _payrollSpec(row),
          ),
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: _text(row['status']) == 'paid'
              ? 'เปิดกลับมาแก้ไข'
              : 'บันทึกว่าจ่ายแล้ว',
          icon: Icons.price_check_rounded,
          spec: _payrollStatusSpec(row),
        ),
      ];
    case OperationEntity.product:
      if (!admin) return const [];
      return [
        _ActionDescriptor(
          label: 'ดูประวัติการเปลี่ยนราคา',
          icon: Icons.price_change_outlined,
          run: () => _showPriceHistory(
            context: context,
            repository: repository,
            branchId: branchId,
            product: row,
          ),
        ),
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'แก้ไขสินค้า',
          icon: Icons.edit_outlined,
          spec: _productSpec(existing: row),
        ),
        if (_text(row['category']) != 'fuel')
          _formAction(
            context: context,
            repository: repository,
            branchId: branchId,
            label: 'ปรับจำนวนสต็อก',
            icon: Icons.inventory_rounded,
            spec: _adjustStockSpec(row),
          ),
        _deleteAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'ลบสินค้า',
          procedure: 'catalog.deleteProduct',
          input: {'id': _int(row['id'])},
          confirmation: 'ยืนยันลบสินค้า ${item.title} หรือไม่?',
        ),
      ];
    case OperationEntity.tankReading:
      if (!admin) return const [];
      return [
        _deleteAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'ลบค่าวัดถัง',
          procedure: 'catalog.deleteTankReading',
          input: {'id': _int(row['id'])},
          confirmation:
              'ยืนยันลบค่าวัด ${_formatNumber(_number(row['liters']))} ลิตรหรือไม่?',
        ),
      ];
    case OperationEntity.stockCountSession:
      return [
        _ActionDescriptor(
          label: _text(row['status']) == 'counting'
              ? 'เปิดรอบและกรอกจำนวน'
              : 'ดูผลตรวจนับ',
          icon: Icons.playlist_add_check_rounded,
          run: () => _openStockCountSession(
            context: context,
            repository: repository,
            staff: staff,
            sessionId: _int(row['id']),
          ),
        ),
      ];
    case OperationEntity.member:
      final rewards = _maps(
        await repository.queryProcedure(
          'membership.listRewards',
          branchId: branchId,
        ),
      );
      if (!context.mounted) return const [];
      final actions = <_ActionDescriptor>[];
      actions.add(
        _ActionDescriptor(
          label: 'ดูประวัติคะแนน',
          icon: Icons.history_rounded,
          run: () => _showMemberTransactions(
            context: context,
            repository: repository,
            branchId: branchId,
            member: row,
          ),
        ),
      );
      if (admin) {
        actions.addAll([
          _formAction(
            context: context,
            repository: repository,
            branchId: branchId,
            label: 'แก้ไขสมาชิก',
            icon: Icons.edit_outlined,
            spec: _memberSpec(existing: row),
          ),
          _formAction(
            context: context,
            repository: repository,
            branchId: branchId,
            label: 'ปรับคะแนน',
            icon: Icons.stars_outlined,
            spec: _adjustPointsSpec(row),
          ),
        ]);
      }
      if (rewards.any((reward) => _bool(reward['active'], fallback: true))) {
        actions.add(
          _formAction(
            context: context,
            repository: repository,
            branchId: branchId,
            label: 'แลกของรางวัล',
            icon: Icons.redeem_rounded,
            spec: _redeemRewardSpec(row, rewards),
          ),
        );
      }
      if (admin) {
        actions.add(
          _deleteAction(
            context: context,
            repository: repository,
            branchId: branchId,
            label: 'ลบสมาชิก',
            procedure: 'membership.deleteMember',
            input: {'id': _int(row['id'])},
            confirmation:
                'ยืนยันลบสมาชิก ${item.title} พร้อมประวัติที่เกี่ยวข้องหรือไม่?',
          ),
        );
      }
      return actions;
    case OperationEntity.memberCardBatch:
      if (!manager) return const [];
      return [
        _ActionDescriptor(
          label: 'ดูหมายเลขบัตรในชุด',
          icon: Icons.qr_code_2_rounded,
          run: () => _showMemberCardBatch(
            context: context,
            repository: repository,
            branchId: branchId,
            batchId: _int(row['id']),
          ),
        ),
        _ActionDescriptor(
          label: 'ส่งออก Data Merge (.zip)',
          icon: Icons.folder_zip_outlined,
          run: () => shareMemberCardDataMerge(
            context: context,
            repository: repository,
            branchId: branchId,
            batchId: _int(row['id']),
          ),
        ),
      ];
    case OperationEntity.reward:
      if (!admin) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'แก้ไขของรางวัล',
          icon: Icons.edit_outlined,
          spec: _rewardSpec(existing: row),
        ),
        _deleteAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'ลบของรางวัล',
          procedure: 'membership.deleteReward',
          input: {'id': _int(row['id'])},
          confirmation: 'ยืนยันลบของรางวัล ${item.title} หรือไม่?',
        ),
      ];
    case OperationEntity.customer:
      if (!manager) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'แก้ไขลูกค้า',
          icon: Icons.edit_outlined,
          spec: _customerSpec(existing: row),
        ),
        _ActionDescriptor(
          label: 'พิมพ์ใบขอเปิดบัญชีเครดิต',
          icon: Icons.print_outlined,
          run: () => showCustomerDocument(
            context: context,
            repository: repository,
            staff: staff,
            type: 'credit-request',
            customer: row,
          ),
        ),
        _ActionDescriptor(
          label: 'พิมพ์แบบฟอร์มรถในสังกัด',
          icon: Icons.local_shipping_outlined,
          run: () => showCustomerDocument(
            context: context,
            repository: repository,
            staff: staff,
            type: 'vehicle-fleet',
            customer: row,
          ),
        ),
        _deleteAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'ลบลูกค้า',
          procedure: 'customers.remove',
          input: {'id': _int(row['id'])},
          confirmation:
              'ยืนยันลบลูกค้า ${item.title} หรือไม่? ลูกค้าที่มียอดค้างจะลบไม่ได้',
        ),
      ];
    case OperationEntity.debt:
      if (!manager) return const [];
      return [
        _ActionDescriptor(
          label: 'ดูบิลและประวัติชำระ',
          icon: Icons.receipt_long_outlined,
          run: () => _showDebtDetail(
            context: context,
            repository: repository,
            staff: staff,
            customer: row,
          ),
        ),
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'รับชำระหนี้',
          icon: Icons.payments_outlined,
          spec: _debtPaymentSpec(row, staff.name),
        ),
      ];
    case OperationEntity.sale:
      final status = _text(row['status']);
      final transactionType = _text(row['transactionType']);
      return [
        _ActionDescriptor(
          label: 'ดูรายละเอียดบิล',
          icon: Icons.receipt_long_outlined,
          run: () => _showSaleDetail(
            context: context,
            repository: repository,
            branchId: branchId,
            saleId: _int(row['id']),
          ),
        ),
        if (manager && status == 'completed')
          _formAction(
            context: context,
            repository: repository,
            branchId: branchId,
            label: 'แก้ไขหัวบิล',
            icon: Icons.edit_note_rounded,
            spec: _saleHeaderSpec(row),
          ),
        if (manager && status == 'completed' && transactionType != 'return')
          _ActionDescriptor(
            label: 'คืนสินค้า',
            icon: Icons.assignment_return_outlined,
            run: () => _returnSale(
              context: context,
              repository: repository,
              branchId: branchId,
              saleId: _int(row['id']),
            ),
          ),
        if (admin && status == 'completed')
          _deleteAction(
            context: context,
            repository: repository,
            branchId: branchId,
            label: 'ยกเลิกบิล',
            procedure: 'pos.voidSale',
            input: {'id': _int(row['id'])},
            confirmation:
                'ยืนยันยกเลิกบิล ${item.title} หรือไม่? ระบบจะคืนสต็อกและคะแนน',
          ),
        if (manager)
          _deleteAction(
            context: context,
            repository: repository,
            branchId: branchId,
            label: 'ลบบิลถาวร',
            procedure: 'pos.deleteSale',
            input: {'id': _int(row['id'])},
            confirmation:
                'ยืนยันลบบิล ${item.title} ถาวรหรือไม่? การทำงานนี้ย้อนกลับไม่ได้',
          ),
      ];
    case OperationEntity.expense:
      if (!manager) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'แก้ไขค่าใช้จ่าย',
          icon: Icons.edit_outlined,
          spec: _expenseSpec(existing: row, staffName: staff.name),
        ),
        _deleteAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'ลบค่าใช้จ่าย',
          procedure: 'expenses.remove',
          input: {'id': _int(row['id'])},
          confirmation: 'ยืนยันลบค่าใช้จ่าย ${item.title} หรือไม่?',
        ),
      ];
    case OperationEntity.taxInvoice:
      return [
        _ActionDescriptor(
          label: 'ดู / พิมพ์ใบกำกับภาษี',
          icon: Icons.print_outlined,
          run: () => showTaxInvoicePreview(
            context: context,
            repository: repository,
            branchId: branchId,
            saleId: _int(row['saleId']),
          ),
        ),
        if (admin)
          _formAction(
            context: context,
            repository: repository,
            branchId: branchId,
            label: 'แก้ไขข้อมูลใบกำกับ',
            icon: Icons.edit_document,
            spec: _taxInvoiceSpec(
              saleId: _int(row['saleId']),
              existing: row,
              issuedBy: staff.name,
            ),
          ),
        if (admin)
          _deleteAction(
            context: context,
            repository: repository,
            branchId: branchId,
            label: 'ลบใบกำกับภาษี',
            procedure: 'taxInvoice.remove',
            input: {'id': _int(row['id'])},
            confirmation:
                'ยืนยันลบใบกำกับ ${item.title} หรือไม่? บิลขายจะยังคงอยู่',
          ),
      ];
    case OperationEntity.documentTemplate:
      if (!manager) return const [];
      return [
        _ActionDescriptor(
          label: 'เลือกผู้รับเอกสารและพิมพ์ A4',
          icon: Icons.print_outlined,
          run: () => showCustomerDocument(
            context: context,
            repository: repository,
            staff: staff,
            type: _text(row['type']),
          ),
        ),
      ];
    case OperationEntity.securityEvent:
      if (!admin) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'เปลี่ยนสถานะเหตุการณ์',
          icon: Icons.rule_rounded,
          spec: _securityStatusSpec(row),
        ),
      ];
    case OperationEntity.setting:
      if (!admin) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'แก้ไขค่าตั้งระบบ',
          icon: Icons.tune_rounded,
          spec: _settingSpec(row),
        ),
      ];
    case OperationEntity.shopProfileConfig:
      if (!admin) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'แก้ไขข้อมูลร้านและภาษี',
          icon: Icons.storefront_outlined,
          spec: _shopProfileSettingsSpec(row),
        ),
      ];
    case OperationEntity.documentConfig:
      if (!admin) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'แก้ไขเอกสารและการพิมพ์',
          icon: Icons.receipt_long_outlined,
          spec: _documentSettingsSpec(row),
        ),
      ];
    case OperationEntity.membershipConfig:
      if (!admin) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'แก้ไขสมาชิกและคะแนน',
          icon: Icons.stars_outlined,
          spec: _membershipSettingsSpec(row),
        ),
      ];
    case OperationEntity.checkoutConfig:
      if (!admin) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'แก้ไขช่องทางชำระเงิน',
          icon: Icons.account_balance_wallet_outlined,
          spec: _checkoutSettingsSpec(row),
        ),
      ];
    case OperationEntity.automaticBackupConfig:
      if (!admin) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'แก้ไขการสำรองอัตโนมัติ',
          icon: Icons.cloud_sync_outlined,
          spec: _automaticBackupSettingsSpec(row),
        ),
      ];
    case OperationEntity.perLiterPromotionConfig:
      if (!manager) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'แก้ไขโปรโมชั่นลดต่อลิตร',
          icon: Icons.local_offer_outlined,
          spec: _perLiterPromotionSpec(row),
        ),
      ];
    case OperationEntity.billPromotionConfig:
      if (!manager) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'แก้ไขโปรโมชั่นลดท้ายบิล',
          icon: Icons.discount_outlined,
          spec: _billPromotionSpec(row),
        ),
      ];
    case OperationEntity.branch:
      if (!admin) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'แก้ไขสาขา',
          icon: Icons.edit_location_alt_outlined,
          spec: _branchSpec(existing: row),
        ),
      ];
    case OperationEntity.accessGroup:
      if (!admin) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'แก้ไขกลุ่มสิทธิ์',
          icon: Icons.edit_outlined,
          spec: _accessGroupSpec(existing: row),
        ),
        _deleteAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'ลบกลุ่มสิทธิ์',
          procedure: 'auth.deleteAccessGroup',
          input: {'id': _int(row['id'])},
          confirmation: 'ยืนยันลบกลุ่มสิทธิ์ ${item.title} หรือไม่?',
        ),
      ];
    case OperationEntity.pump:
      if (!admin) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'แก้ไขตู้จ่าย',
          icon: Icons.edit_outlined,
          spec: _pumpSpec(existing: row),
        ),
        _deleteAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'ลบตู้จ่าย',
          procedure: 'catalog.deletePump',
          input: {'id': _int(row['id'])},
          confirmation:
              'ยืนยันลบตู้จ่าย ${item.title} หรือไม่? ต้องลบหัวจ่ายทั้งหมดก่อน',
        ),
      ];
    case OperationEntity.nozzle:
      if (!admin) return const [];
      final catalog = await Future.wait<Object?>([
        repository.queryProcedure('catalog.listPumps', branchId: branchId),
        repository.queryProcedure('catalog.listProducts', branchId: branchId),
        repository.queryProcedure('catalog.listTanks', branchId: branchId),
      ]);
      if (!context.mounted) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'แก้ไขหัวจ่าย',
          icon: Icons.edit_outlined,
          spec: _nozzleSpec(
            existing: row,
            pumps: _maps(catalog[0]),
            products: _maps(catalog[1]),
            tanks: _maps(catalog[2]),
          ),
        ),
        _deleteAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'ลบหัวจ่าย',
          procedure: 'catalog.deleteNozzle',
          input: {'id': _int(row['id'])},
          confirmation:
              'ยืนยันลบหัวจ่าย ${item.title} หรือไม่? ระบบจะป้องกันเมื่อมีกะเปิดอยู่',
        ),
      ];
    case OperationEntity.paymentConfig:
      if (!admin) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'ตั้งค่าการชำระเงิน',
          icon: Icons.qr_code_rounded,
          spec: _paymentConfigSpec(row),
        ),
        _ActionDescriptor(
          label: 'ทดสอบการเชื่อมต่อ Slip2Go',
          icon: Icons.network_check_rounded,
          run: () => testPaymentConnection(
            context: context,
            repository: repository,
            branchId: branchId,
          ),
        ),
        _ActionDescriptor(
          label: 'ตรวจสอบ Merchant QR payload',
          icon: Icons.qr_code_scanner_rounded,
          run: () => validateMerchantQrPayload(
            context: context,
            repository: repository,
            branchId: branchId,
            initialPayload: _text(row['merchantPayload']),
          ),
        ),
      ];
    case OperationEntity.assistantConfig:
      if (!admin) return const [];
      return [
        _formAction(
          context: context,
          repository: repository,
          branchId: branchId,
          label: 'ตั้งค่าผู้ช่วย AI',
          icon: Icons.auto_awesome_rounded,
          spec: _assistantConfigSpec(row),
        ),
      ];
    default:
      return const [];
  }
}

_ActionDescriptor _formAction({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
  required String label,
  required IconData icon,
  required _MutationSpec spec,
}) => _ActionDescriptor(
  label: label,
  icon: icon,
  run: () => _showMutationForm(
    context: context,
    repository: repository,
    branchId: branchId,
    spec: spec,
  ),
);

_ActionDescriptor _deleteAction({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
  required String label,
  required String procedure,
  required Map<String, Object?> input,
  required String confirmation,
}) => _ActionDescriptor(
  label: label,
  icon: Icons.delete_outline_rounded,
  danger: true,
  run: () => _confirmMutation(
    context: context,
    repository: repository,
    branchId: branchId,
    procedure: procedure,
    input: input,
    confirmation: confirmation,
    successMessage: '$labelแล้ว',
  ),
);

Future<bool> _confirmMutation({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
  required String procedure,
  required Object? input,
  required String confirmation,
  required String successMessage,
}) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      icon: const Icon(Icons.warning_amber_rounded, color: Color(0xFFC94B4B)),
      title: const Text('ยืนยันการทำงาน'),
      content: Text(confirmation),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext, false),
          child: const Text('ยกเลิก'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xFFC94B4B),
          ),
          onPressed: () => Navigator.pop(dialogContext, true),
          child: const Text('ยืนยัน'),
        ),
      ],
    ),
  );
  if (confirmed != true || !context.mounted) return false;
  try {
    await repository.mutateProcedure(
      procedure,
      branchId: branchId,
      input: input,
    );
    if (!context.mounted) return true;
    _showMessage(context, successMessage);
    return true;
  } catch (error) {
    if (context.mounted) _showError(context, error);
    return false;
  }
}

Future<bool> _showMutationForm({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
  required _MutationSpec spec,
}) async {
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (sheetContext) => _MutationFormSheet(
      spec: spec,
      onSubmit: (values) async {
        final input = spec.inputBuilder?.call(values) ?? values;
        await repository.mutateProcedure(
          spec.procedure,
          branchId: branchId,
          input: input,
        );
      },
    ),
  );
  if (saved == true && context.mounted) {
    _showMessage(context, spec.successMessage);
  }
  return saved == true;
}

class _ActionDescriptor {
  const _ActionDescriptor({
    required this.label,
    required this.icon,
    required this.run,
    this.danger = false,
  });

  final String label;
  final IconData icon;
  final bool danger;
  final Future<bool> Function() run;
}

enum _FieldKind { text, multiline, number, integer, choice, toggle, date }

class _Choice {
  const _Choice({required this.value, required this.label});

  final Object value;
  final String label;
}

class _FieldSpec {
  const _FieldSpec({
    required this.key,
    required this.label,
    this.kind = _FieldKind.text,
    this.initial,
    this.required = false,
    this.hint,
    this.choices = const [],
    this.min,
    this.max,
  });

  final String key;
  final String label;
  final _FieldKind kind;
  final Object? initial;
  final bool required;
  final String? hint;
  final List<_Choice> choices;
  final num? min;
  final num? max;
}

class _MutationSpec {
  const _MutationSpec({
    required this.title,
    required this.procedure,
    required this.fields,
    required this.successMessage,
    this.description,
    this.submitLabel = 'บันทึก',
    this.inputBuilder,
  });

  final String title;
  final String? description;
  final String procedure;
  final List<_FieldSpec> fields;
  final String submitLabel;
  final String successMessage;
  final Map<String, Object?> Function(Map<String, Object?> values)?
  inputBuilder;
}

class _MutationFormSheet extends StatefulWidget {
  const _MutationFormSheet({required this.spec, required this.onSubmit});

  final _MutationSpec spec;
  final Future<void> Function(Map<String, Object?> values) onSubmit;

  @override
  State<_MutationFormSheet> createState() => _MutationFormSheetState();
}

class _MutationFormSheetState extends State<_MutationFormSheet> {
  final _controllers = <String, TextEditingController>{};
  final _values = <String, Object?>{};
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    for (final field in widget.spec.fields) {
      if (field.kind == _FieldKind.choice || field.kind == _FieldKind.toggle) {
        _values[field.key] =
            field.initial ??
            (field.kind == _FieldKind.toggle
                ? false
                : field.choices.firstOrNull?.value);
      } else {
        _controllers[field.key] = TextEditingController(
          text: field.initial == null ? '' : '${field.initial}',
        );
      }
    }
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    final values = <String, Object?>{};
    for (final field in widget.spec.fields) {
      if (field.kind == _FieldKind.choice || field.kind == _FieldKind.toggle) {
        final value = _values[field.key];
        if (field.required && value == null) {
          setState(() => _error = 'กรุณาระบุ${field.label}');
          return;
        }
        if (value != null) values[field.key] = value;
        continue;
      }
      final text = _controllers[field.key]!.text.trim();
      if (field.required && text.isEmpty) {
        setState(() => _error = 'กรุณาระบุ${field.label}');
        return;
      }
      if (text.isEmpty) continue;
      Object value = text;
      if (field.kind == _FieldKind.number || field.kind == _FieldKind.integer) {
        final number = num.tryParse(text.replaceAll(',', ''));
        if (number == null) {
          setState(() => _error = '${field.label}ต้องเป็นตัวเลข');
          return;
        }
        if (field.min != null && number < field.min!) {
          setState(() => _error = '${field.label}ต้องไม่น้อยกว่า ${field.min}');
          return;
        }
        if (field.max != null && number > field.max!) {
          setState(() => _error = '${field.label}ต้องไม่เกิน ${field.max}');
          return;
        }
        value = field.kind == _FieldKind.integer
            ? number.toInt()
            : number.toDouble();
      }
      values[field.key] = value;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.onSubmit(values);
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = '$error';
      });
    }
  }

  Future<void> _pickDate(_FieldSpec field) async {
    final controller = _controllers[field.key]!;
    final initial = DateTime.tryParse(controller.text) ?? DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 730)),
      locale: const Locale('th', 'TH'),
    );
    if (picked != null) {
      controller.text = DateFormat('yyyy-MM-dd').format(picked);
    }
  }

  @override
  Widget build(BuildContext context) {
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.92,
      ),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 10),
          Container(
            width: 42,
            height: 4,
            decoration: BoxDecoration(
              color: const Color(0xFFD8D5E0),
              borderRadius: BorderRadius.circular(99),
            ),
          ),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              padding: EdgeInsets.fromLTRB(20, 17, 20, 20 + keyboard),
              children: [
                Text(
                  widget.spec.title,
                  style: Theme.of(
                    context,
                  ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
                ),
                if (widget.spec.description case final description?) ...[
                  const SizedBox(height: 5),
                  Text(
                    description,
                    style: const TextStyle(color: Color(0xFF777487)),
                  ),
                ],
                const SizedBox(height: 18),
                for (final field in widget.spec.fields) ...[
                  _buildField(field),
                  const SizedBox(height: 12),
                ],
                if (_error case final error?) ...[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFEEEE),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFFFFC4C4)),
                    ),
                    child: Text(
                      error,
                      style: const TextStyle(color: Color(0xFFA93636)),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
                SizedBox(
                  height: 52,
                  child: FilledButton.icon(
                    onPressed: _busy ? null : _submit,
                    icon: _busy
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.save_outlined),
                    label: Text(
                      _busy ? 'กำลังบันทึก…' : widget.spec.submitLabel,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildField(_FieldSpec field) {
    if (field.kind == _FieldKind.toggle) {
      return Material(
        color: const Color(0xFFF8F7FB),
        borderRadius: BorderRadius.circular(16),
        child: SwitchListTile.adaptive(
          title: Text(field.label),
          subtitle: field.hint == null ? null : Text(field.hint!),
          value: _values[field.key] == true,
          onChanged: _busy
              ? null
              : (value) => setState(() => _values[field.key] = value),
        ),
      );
    }
    if (field.kind == _FieldKind.choice) {
      return DropdownButtonFormField<Object>(
        initialValue: _values[field.key],
        isExpanded: true,
        decoration: InputDecoration(
          labelText: field.required ? '${field.label} *' : field.label,
          helperText: field.hint,
        ),
        items: field.choices
            .map(
              (choice) => DropdownMenuItem<Object>(
                value: choice.value,
                child: Text(choice.label, overflow: TextOverflow.ellipsis),
              ),
            )
            .toList(),
        onChanged: _busy
            ? null
            : (value) => setState(() => _values[field.key] = value),
      );
    }
    final multiline = field.kind == _FieldKind.multiline;
    final numeric =
        field.kind == _FieldKind.number || field.kind == _FieldKind.integer;
    return TextField(
      controller: _controllers[field.key],
      enabled: !_busy,
      readOnly: field.kind == _FieldKind.date,
      onTap: field.kind == _FieldKind.date ? () => _pickDate(field) : null,
      maxLines: multiline ? 3 : 1,
      keyboardType: numeric
          ? TextInputType.numberWithOptions(
              signed: field.min == null || field.min! < 0,
              decimal: field.kind == _FieldKind.number,
            )
          : multiline
          ? TextInputType.multiline
          : TextInputType.text,
      decoration: InputDecoration(
        labelText: field.required ? '${field.label} *' : field.label,
        hintText: field.hint,
        suffixIcon: field.kind == _FieldKind.date
            ? const Icon(Icons.calendar_month_outlined)
            : null,
      ),
    );
  }
}

_MutationSpec _customerSpec({Map<String, dynamic>? existing}) {
  final editing = existing != null;
  return _MutationSpec(
    title: editing ? 'แก้ไขลูกค้าธุรกิจ' : 'เพิ่มลูกค้าธุรกิจ',
    description: 'ข้อมูลนี้ใช้กับเครดิต เอกสาร และใบกำกับภาษี',
    procedure: editing ? 'customers.update' : 'customers.create',
    successMessage: editing ? 'แก้ไขลูกค้าแล้ว' : 'เพิ่มลูกค้าแล้ว',
    fields: [
      _FieldSpec(
        key: 'name',
        label: 'ชื่อบุคคลหรือบริษัท',
        initial: existing?['name'],
        required: true,
      ),
      _FieldSpec(
        key: 'taxId',
        label: 'เลขประจำตัวผู้เสียภาษี',
        initial: existing?['taxId'],
      ),
      _FieldSpec(
        key: 'branch',
        label: 'สำนักงานใหญ่ / สาขา',
        initial: existing?['branch'],
      ),
      _FieldSpec(
        key: 'address',
        label: 'ที่อยู่',
        kind: _FieldKind.multiline,
        initial: existing?['address'],
      ),
      _FieldSpec(key: 'phone', label: 'โทรศัพท์', initial: existing?['phone']),
      _FieldSpec(
        key: 'vehiclePlate',
        label: 'ทะเบียนรถ',
        initial: existing?['vehiclePlate'],
      ),
      _FieldSpec(
        key: 'creditLimit',
        label: 'วงเงินเครดิต (0 = ไม่จำกัด)',
        kind: _FieldKind.number,
        initial: existing?['creditLimit'] ?? 0,
        required: true,
        min: 0,
      ),
    ],
    inputBuilder: (values) => <String, Object?>{
      if (editing) 'id': _int(existing['id']),
      'name': values['name'],
      'taxId': values['taxId'] ?? '',
      'branch': values['branch'] ?? '',
      'address': values['address'] ?? '',
      'phone': values['phone'] ?? '',
      'vehiclePlate': values['vehiclePlate'] ?? '',
      'creditLimit': values['creditLimit'] ?? 0.0,
    },
  );
}

_MutationSpec _expenseSpec({
  Map<String, dynamic>? existing,
  required String staffName,
}) {
  final editing = existing != null;
  return _MutationSpec(
    title: editing ? 'แก้ไขค่าใช้จ่าย' : 'บันทึกค่าใช้จ่าย',
    procedure: editing ? 'expenses.update' : 'expenses.create',
    successMessage: editing ? 'แก้ไขค่าใช้จ่ายแล้ว' : 'บันทึกค่าใช้จ่ายแล้ว',
    fields: [
      _FieldSpec(
        key: 'title',
        label: 'รายการ',
        initial: existing?['title'],
        required: true,
      ),
      _FieldSpec(
        key: 'category',
        label: 'หมวดค่าใช้จ่าย',
        initial: existing?['category'],
        hint: 'เช่น ค่าน้ำ ค่าไฟ ซ่อมบำรุง',
      ),
      _FieldSpec(
        key: 'amount',
        label: 'จำนวนเงิน',
        kind: _FieldKind.number,
        initial: existing?['amount'],
        required: true,
        min: 0.01,
      ),
      _FieldSpec(
        key: 'note',
        label: 'หมายเหตุ',
        kind: _FieldKind.multiline,
        initial: existing?['note'],
      ),
    ],
    inputBuilder: (values) => <String, Object?>{
      if (editing) 'id': _int(existing['id']),
      ...values,
      if (!editing) 'staffName': staffName,
      if (!values.containsKey('category')) 'category': '',
    },
  );
}

_MutationSpec _memberSpec({Map<String, dynamic>? existing}) {
  final editing = existing != null;
  return _MutationSpec(
    title: editing ? 'แก้ไขสมาชิก' : 'สมัครสมาชิก',
    procedure: editing ? 'membership.updateMember' : 'membership.createMember',
    successMessage: editing ? 'แก้ไขสมาชิกแล้ว' : 'สมัครสมาชิกแล้ว',
    fields: [
      _FieldSpec(
        key: 'name',
        label: 'ชื่อสมาชิก',
        initial: existing?['name'],
        required: true,
      ),
      _FieldSpec(
        key: 'phone',
        label: 'โทรศัพท์',
        initial: existing?['phone'],
        required: true,
        hint: 'อย่างน้อย 9 หลัก',
      ),
      if (!editing)
        const _FieldSpec(
          key: 'cardCode',
          label: 'เลขบัตร 16 หลัก (เว้นว่างเพื่อสร้างอัตโนมัติ)',
        ),
      if (editing)
        _FieldSpec(
          key: 'tier',
          label: 'ระดับสมาชิก',
          kind: _FieldKind.choice,
          initial: _text(existing['tier'], fallback: 'silver'),
          choices: const [
            _Choice(value: 'silver', label: 'Silver'),
            _Choice(value: 'gold', label: 'Gold'),
            _Choice(value: 'platinum', label: 'Platinum'),
          ],
        ),
    ],
    inputBuilder: (values) => <String, Object?>{
      if (editing) 'id': _int(existing['id']),
      ...values,
    },
  );
}

_MutationSpec _rewardSpec({Map<String, dynamic>? existing}) {
  final editing = existing != null;
  return _MutationSpec(
    title: editing ? 'แก้ไขของรางวัล' : 'เพิ่มของรางวัล',
    procedure: 'membership.upsertReward',
    successMessage: editing ? 'แก้ไขของรางวัลแล้ว' : 'เพิ่มของรางวัลแล้ว',
    fields: [
      _FieldSpec(
        key: 'name',
        label: 'ชื่อของรางวัล',
        initial: existing?['name'],
        required: true,
      ),
      _FieldSpec(
        key: 'pointsRequired',
        label: 'คะแนนที่ใช้',
        kind: _FieldKind.integer,
        initial: existing?['pointsRequired'],
        required: true,
        min: 1,
      ),
      _FieldSpec(
        key: 'stock',
        label: 'จำนวนคงเหลือ',
        kind: _FieldKind.integer,
        initial: existing?['stock'] ?? 0,
        required: true,
        min: 0,
      ),
      _FieldSpec(
        key: 'active',
        label: 'เปิดให้แลกของรางวัล',
        kind: _FieldKind.toggle,
        initial: existing == null || _bool(existing['active'], fallback: true),
      ),
    ],
    inputBuilder: (values) => <String, Object?>{
      if (editing) 'id': _int(existing['id']),
      ...values,
    },
  );
}

_MutationSpec _memberCardBatchSpec() => const _MutationSpec(
  title: 'สร้างชุดบัตรสมาชิก',
  description: 'ระบบจะสร้างหมายเลขบัตรที่ไม่ซ้ำจำนวน 1–500 ใบ',
  procedure: 'membership.createCardBatch',
  successMessage: 'สร้างชุดบัตรสมาชิกแล้ว',
  fields: [
    _FieldSpec(
      key: 'quantity',
      label: 'จำนวนบัตร',
      kind: _FieldKind.integer,
      initial: 20,
      required: true,
      min: 1,
      max: 500,
    ),
    _FieldSpec(key: 'label', label: 'ป้ายกำกับชุดบัตร'),
  ],
);

_MutationSpec _productSpec({Map<String, dynamic>? existing}) {
  final editing = existing != null;
  return _MutationSpec(
    title: editing ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า',
    procedure: editing ? 'catalog.updateProduct' : 'catalog.createProduct',
    successMessage: editing ? 'แก้ไขสินค้าแล้ว' : 'เพิ่มสินค้าแล้ว',
    fields: [
      _FieldSpec(
        key: 'code',
        label: 'รหัสสินค้า / บาร์โค้ด',
        initial: existing?['code'],
        required: true,
      ),
      _FieldSpec(
        key: 'name',
        label: 'ชื่อสินค้า',
        initial: existing?['name'],
        required: true,
      ),
      _FieldSpec(
        key: 'category',
        label: 'หมวดสินค้า',
        kind: _FieldKind.choice,
        initial: _text(existing?['category'], fallback: 'other'),
        choices: const [
          _Choice(value: 'fuel', label: 'น้ำมันเชื้อเพลิง'),
          _Choice(value: 'lubricant', label: 'น้ำมันเครื่อง'),
          _Choice(value: 'other', label: 'สินค้าอื่น'),
        ],
        required: true,
      ),
      _FieldSpec(
        key: 'unit',
        label: 'หน่วย',
        initial: existing?['unit'] ?? 'ชิ้น',
        required: true,
      ),
      _FieldSpec(
        key: 'price',
        label: 'ราคาขาย',
        kind: _FieldKind.number,
        initial: existing?['price'] ?? 0,
        required: true,
        min: 0,
      ),
      _FieldSpec(
        key: 'cost',
        label: 'ต้นทุน',
        kind: _FieldKind.number,
        initial: existing?['cost'] ?? 0,
        required: true,
        min: 0,
      ),
      _FieldSpec(
        key: 'stockQty',
        label: 'จำนวนคงเหลือ',
        kind: _FieldKind.number,
        initial: existing?['stockQty'] ?? 0,
        required: true,
        min: 0,
      ),
      _FieldSpec(
        key: 'lowStockAt',
        label: 'จุดแจ้งเตือนสต็อกต่ำ',
        kind: _FieldKind.number,
        initial: existing?['lowStockAt'] ?? 0,
        required: true,
        min: 0,
      ),
      if (editing)
        _FieldSpec(
          key: 'active',
          label: 'เปิดขายสินค้า',
          kind: _FieldKind.toggle,
          initial: _bool(existing['active'], fallback: true),
        ),
    ],
    inputBuilder: (values) => <String, Object?>{
      if (editing) 'id': _int(existing['id']),
      ...values,
    },
  );
}

_MutationSpec _tankSpec({
  Map<String, dynamic>? existing,
  required List<_Choice> productChoices,
}) {
  final editing = existing != null;
  final nestedProduct = _map(existing?['product']);
  return _MutationSpec(
    title: editing ? 'แก้ไขถังน้ำมัน' : 'เพิ่มถังน้ำมัน',
    procedure: editing ? 'catalog.updateTank' : 'catalog.createTank',
    successMessage: editing ? 'แก้ไขถังแล้ว' : 'เพิ่มถังแล้ว',
    fields: [
      _FieldSpec(
        key: 'productId',
        label: 'ชนิดน้ำมัน',
        kind: _FieldKind.choice,
        initial: editing
            ? _int(existing['productId'] ?? nestedProduct['id'])
            : productChoices.firstOrNull?.value,
        choices: productChoices,
        required: true,
      ),
      _FieldSpec(
        key: 'name',
        label: 'ชื่อถัง',
        initial: existing?['name'],
        required: true,
      ),
      _FieldSpec(
        key: 'capacityLiters',
        label: 'ความจุ (ลิตร)',
        kind: _FieldKind.number,
        initial: existing?['capacityLiters'],
        required: true,
        min: 0.001,
      ),
      _FieldSpec(
        key: 'currentLiters',
        label: 'คงเหลือปัจจุบัน (ลิตร)',
        kind: _FieldKind.number,
        initial: existing?['currentLiters'] ?? 0,
        required: true,
        min: 0,
      ),
      _FieldSpec(
        key: 'lowAlertAt',
        label: 'จุดแจ้งเตือน (ลิตร)',
        kind: _FieldKind.number,
        initial: existing?['lowAlertAt'] ?? 0,
        required: true,
        min: 0,
      ),
    ],
    inputBuilder: (values) => <String, Object?>{
      if (editing) 'id': _int(existing['id']),
      ...values,
    },
  );
}

_MutationSpec _refillTankSpec(Map<String, dynamic> tank) => _MutationSpec(
  title: 'รับน้ำมันเข้า ${_text(tank['name'])}',
  procedure: 'catalog.refillTank',
  successMessage: 'บันทึกรับน้ำมันเข้าถังแล้ว',
  fields: const [
    _FieldSpec(
      key: 'liters',
      label: 'จำนวนที่รับเข้า (ลิตร)',
      kind: _FieldKind.number,
      required: true,
      min: 0.001,
    ),
    _FieldSpec(
      key: 'costPerLiter',
      label: 'ต้นทุนต่อลิตร',
      kind: _FieldKind.number,
      initial: 0,
      required: true,
      min: 0,
    ),
    _FieldSpec(key: 'note', label: 'หมายเหตุ', kind: _FieldKind.multiline),
  ],
  inputBuilder: (values) => <String, Object?>{
    'tankId': _int(tank['id']),
    ...values,
  },
);

_MutationSpec _tankReadingSpec(Map<String, dynamic> tank) => _MutationSpec(
  title: 'บันทึกค่าวัดจริง ${_text(tank['name'])}',
  description: 'เลือกปรับยอดสต็อกเมื่อค่าที่วัดเป็นค่าจริงที่ต้องการใช้ต่อ',
  procedure: 'catalog.addTankReading',
  successMessage: 'บันทึกค่าวัดถังแล้ว',
  fields: [
    _FieldSpec(
      key: 'liters',
      label: 'ระดับที่วัดได้ (ลิตร)',
      kind: _FieldKind.number,
      initial: tank['currentLiters'],
      required: true,
      min: 0,
    ),
    const _FieldSpec(
      key: 'adjustStock',
      label: 'ปรับยอดคงเหลือให้ตรงกับค่าวัด',
      kind: _FieldKind.toggle,
    ),
    const _FieldSpec(
      key: 'note',
      label: 'หมายเหตุ',
      kind: _FieldKind.multiline,
    ),
  ],
  inputBuilder: (values) => <String, Object?>{
    'tankId': _int(tank['id']),
    ...values,
  },
);

_MutationSpec _adjustStockSpec(Map<String, dynamic> product) => _MutationSpec(
  title: 'ปรับสต็อก ${_text(product['name'])}',
  procedure: 'catalog.adjustStock',
  successMessage: 'ปรับจำนวนสต็อกแล้ว',
  fields: const [
    _FieldSpec(
      key: 'mode',
      label: 'วิธีปรับ',
      kind: _FieldKind.choice,
      initial: 'add',
      choices: [
        _Choice(value: 'add', label: 'เพิ่ม/ลดจากยอดปัจจุบัน'),
        _Choice(value: 'set', label: 'กำหนดยอดใหม่'),
      ],
      required: true,
    ),
    _FieldSpec(
      key: 'qty',
      label: 'จำนวน',
      kind: _FieldKind.number,
      required: true,
      hint: 'โหมดเพิ่ม/ลดสามารถใส่ค่าติดลบได้',
    ),
  ],
  inputBuilder: (values) => <String, Object?>{
    'productId': _int(product['id']),
    ...values,
  },
);

_MutationSpec _stockCountSessionSpec() => _MutationSpec(
  title: 'เริ่มรอบตรวจนับสต็อก',
  procedure: 'stockCount.createSession',
  successMessage: 'เริ่มรอบตรวจนับแล้ว',
  fields: const [
    _FieldSpec(key: 'name', label: 'ชื่อรอบ (เว้นว่างเพื่อสร้างอัตโนมัติ)'),
    _FieldSpec(
      key: 'scope',
      label: 'ขอบเขต',
      kind: _FieldKind.choice,
      initial: 'all',
      choices: [
        _Choice(value: 'all', label: 'สินค้าทั้งหมด'),
        _Choice(value: 'lubricant', label: 'น้ำมันเครื่อง'),
        _Choice(value: 'other', label: 'สินค้าอื่น'),
      ],
      required: true,
    ),
    _FieldSpec(key: 'note', label: 'หมายเหตุ', kind: _FieldKind.multiline),
  ],
  inputBuilder: (values) => <String, Object?>{...values},
);

_MutationSpec _adjustPointsSpec(Map<String, dynamic> member) => _MutationSpec(
  title: 'ปรับคะแนน ${_text(member['name'])}',
  procedure: 'membership.adjustPoints',
  successMessage: 'ปรับคะแนนสมาชิกแล้ว',
  fields: const [
    _FieldSpec(
      key: 'points',
      label: 'จำนวนคะแนน',
      kind: _FieldKind.integer,
      required: true,
      hint: 'ใส่ค่าติดลบเมื่อต้องการหักคะแนน',
    ),
    _FieldSpec(
      key: 'note',
      label: 'เหตุผล',
      kind: _FieldKind.multiline,
      required: true,
    ),
  ],
  inputBuilder: (values) => <String, Object?>{
    'memberId': _int(member['id']),
    ...values,
  },
);

_MutationSpec _redeemRewardSpec(
  Map<String, dynamic> member,
  List<Map<String, dynamic>> rewards,
) => _MutationSpec(
  title: 'แลกของรางวัลให้ ${_text(member['name'])}',
  description: 'คะแนนปัจจุบัน ${_int(member['points'])} แต้ม',
  procedure: 'membership.redeemReward',
  successMessage: 'แลกของรางวัลแล้ว',
  fields: [
    _FieldSpec(
      key: 'rewardId',
      label: 'ของรางวัล',
      kind: _FieldKind.choice,
      choices: rewards
          .where(
            (reward) =>
                _bool(reward['active'], fallback: true) &&
                _int(reward['stock']) > 0,
          )
          .map(
            (reward) => _Choice(
              value: _int(reward['id']),
              label:
                  '${_text(reward['name'])} · ${_int(reward['pointsRequired'])} แต้ม · เหลือ ${_int(reward['stock'])}',
            ),
          )
          .toList(),
      required: true,
    ),
  ],
  inputBuilder: (values) => <String, Object?>{
    'memberId': _int(member['id']),
    ...values,
  },
);

_MutationSpec _debtPaymentSpec(
  Map<String, dynamic> customer,
  String staffName,
) => _MutationSpec(
  title: 'รับชำระหนี้ ${_text(customer['name'])}',
  description:
      'ยอดค้าง ${NumberFormat('#,##0.00', 'th_TH').format(_number(customer['outstanding']))} บาท',
  procedure: 'credit.receivePayment',
  successMessage: 'บันทึกรับชำระหนี้แล้ว',
  fields: [
    _FieldSpec(
      key: 'amount',
      label: 'ยอดชำระ',
      kind: _FieldKind.number,
      required: true,
      min: 0.01,
      max: _number(customer['outstanding']),
    ),
    const _FieldSpec(
      key: 'method',
      label: 'ช่องทางชำระ',
      kind: _FieldKind.choice,
      initial: 'cash',
      choices: [
        _Choice(value: 'cash', label: 'เงินสด'),
        _Choice(value: 'qr', label: 'QR'),
        _Choice(value: 'transfer', label: 'โอนเงิน'),
      ],
      required: true,
    ),
    const _FieldSpec(
      key: 'note',
      label: 'หมายเหตุ',
      kind: _FieldKind.multiline,
    ),
  ],
  inputBuilder: (values) => <String, Object?>{
    'customerId': _int(customer['id']),
    ...values,
    'staffName': staffName,
  },
);

_MutationSpec _saleHeaderSpec(Map<String, dynamic> sale) => _MutationSpec(
  title: 'แก้ไขบิล ${_text(sale['receiptNo'])}',
  procedure: 'pos.updateSale',
  successMessage: 'แก้ไขข้อมูลบิลแล้ว',
  fields: [
    _FieldSpec(
      key: 'staffName',
      label: 'ชื่อพนักงาน',
      initial: sale['staffName'],
      required: true,
    ),
    _FieldSpec(
      key: 'paymentMethod',
      label: 'ช่องทางชำระ',
      kind: _FieldKind.choice,
      initial: _text(sale['paymentMethod'], fallback: 'cash'),
      choices: const [
        _Choice(value: 'cash', label: 'เงินสด'),
        _Choice(value: 'qr', label: 'QR'),
        _Choice(value: 'card', label: 'บัตร'),
        _Choice(value: 'credit', label: 'เครดิต'),
        _Choice(value: 'thungngern', label: 'ถุงเงิน'),
      ],
      required: true,
    ),
    _FieldSpec(
      key: 'discount',
      label: 'ส่วนลด',
      kind: _FieldKind.number,
      initial: sale['discount'] ?? 0,
      required: true,
      min: 0,
    ),
  ],
  inputBuilder: (values) => <String, Object?>{
    'id': _int(sale['id']),
    ...values,
  },
);

_MutationSpec _taxInvoiceSpec({
  required int saleId,
  Map<String, dynamic>? existing,
  required String issuedBy,
  bool creating = false,
}) => _MutationSpec(
  title: creating ? 'ออกใบกำกับภาษี' : 'แก้ไขข้อมูลใบกำกับภาษี',
  procedure: 'taxInvoice.save',
  successMessage: creating ? 'ออกใบกำกับภาษีแล้ว' : 'แก้ไขใบกำกับภาษีแล้ว',
  fields: [
    _FieldSpec(
      key: 'customerName',
      label: 'ชื่อลูกค้าหรือบริษัท',
      initial: existing?['customerName'],
      required: true,
    ),
    _FieldSpec(
      key: 'customerTaxId',
      label: 'เลขประจำตัวผู้เสียภาษี',
      initial: existing?['customerTaxId'],
    ),
    _FieldSpec(
      key: 'customerBranch',
      label: 'สำนักงานใหญ่ / สาขา',
      initial: existing?['customerBranch'] ?? 'สำนักงานใหญ่',
    ),
    _FieldSpec(
      key: 'customerAddress',
      label: 'ที่อยู่',
      kind: _FieldKind.multiline,
      initial: existing?['customerAddress'],
    ),
    _FieldSpec(
      key: 'customerPhone',
      label: 'โทรศัพท์',
      initial: existing?['customerPhone'],
    ),
    _FieldSpec(
      key: 'vehiclePlate',
      label: 'ทะเบียนรถ',
      initial: existing?['vehiclePlate'],
    ),
  ],
  inputBuilder: (values) => <String, Object?>{
    'saleId': saleId,
    'customerName': values['customerName'],
    'customerTaxId': values['customerTaxId'] ?? '',
    'customerBranch': values['customerBranch'] ?? '',
    'customerAddress': values['customerAddress'] ?? '',
    'customerPhone': values['customerPhone'] ?? '',
    'vehiclePlate': values['vehiclePlate'] ?? '',
    'issuedBy': issuedBy,
  },
);

_MutationSpec _securityScanSpec() => const _MutationSpec(
  title: 'สแกนความปลอดภัย',
  description: 'ตรวจเหตุการณ์ผิดปกติและสร้างรายการแจ้งเตือนใหม่',
  procedure: 'security.scan',
  successMessage: 'สแกนความปลอดภัยแล้ว',
  submitLabel: 'เริ่มสแกน',
  fields: [
    _FieldSpec(
      key: 'windowDays',
      label: 'ช่วงเวลาย้อนหลัง',
      kind: _FieldKind.choice,
      initial: 7,
      choices: [
        _Choice(value: 1, label: '1 วัน'),
        _Choice(value: 7, label: '7 วัน'),
        _Choice(value: 30, label: '30 วัน'),
      ],
      required: true,
    ),
  ],
);

_MutationSpec _securityAnalyzeSpec() => const _MutationSpec(
  title: 'ให้ AI วิเคราะห์ความปลอดภัย',
  description: 'วิเคราะห์เหตุการณ์ย้อนหลังและสร้างรายงานสำหรับ Admin',
  procedure: 'security.analyze',
  successMessage: 'สร้างรายงานวิเคราะห์แล้ว',
  submitLabel: 'เริ่มวิเคราะห์',
  fields: [
    _FieldSpec(
      key: 'windowDays',
      label: 'ช่วงเวลาย้อนหลัง',
      kind: _FieldKind.choice,
      initial: 7,
      choices: [
        _Choice(value: 1, label: '1 วัน'),
        _Choice(value: 7, label: '7 วัน'),
        _Choice(value: 30, label: '30 วัน'),
      ],
      required: true,
    ),
  ],
);

_MutationSpec _securityStatusSpec(Map<String, dynamic> event) => _MutationSpec(
  title: 'เปลี่ยนสถานะเหตุการณ์',
  procedure: 'security.setEventStatus',
  successMessage: 'เปลี่ยนสถานะเหตุการณ์แล้ว',
  fields: [
    _FieldSpec(
      key: 'status',
      label: 'สถานะ',
      kind: _FieldKind.choice,
      initial: _text(event['status'], fallback: 'new'),
      choices: const [
        _Choice(value: 'new', label: 'ใหม่'),
        _Choice(value: 'acknowledged', label: 'รับทราบแล้ว'),
        _Choice(value: 'resolved', label: 'แก้ไขแล้ว'),
      ],
      required: true,
    ),
  ],
  inputBuilder: (values) => <String, Object?>{
    'id': _text(event['id']),
    ...values,
  },
);

_MutationSpec _settingSpec(Map<String, dynamic> setting) {
  final key = _text(setting['key']);
  final initial = setting['value'];
  const toggleKeys = <String>{
    'pay_cash_enabled',
    'pay_qr_enabled',
    'pay_card_enabled',
    'pay_credit_enabled',
    'receipt_silent_print',
    'backup_auto_enabled',
    'promotion_enabled',
    'bill_promotion_enabled',
    'vat_enabled',
  };
  const numberKeys = <String>{
    'vat_rate',
    'point_earn_per_baht',
    'point_redeem_value',
    'backup_auto_keep',
    'promotion_discount',
    'bill_promotion_min_fuel_spend',
    'bill_promotion_discount',
  };
  const dateKeys = <String>{
    'promotion_start_date',
    'promotion_end_date',
    'bill_promotion_start_date',
    'bill_promotion_end_date',
  };

  late final _FieldSpec field;
  if (toggleKeys.contains(key)) {
    field = _FieldSpec(
      key: 'value',
      label: 'เปิดใช้งาน',
      kind: _FieldKind.toggle,
      initial: _bool(initial),
    );
  } else if (key == 'receipt_paper_size') {
    field = _FieldSpec(
      key: 'value',
      label: 'ขนาดกระดาษใบเสร็จ',
      kind: _FieldKind.choice,
      initial: _text(initial, fallback: '80'),
      choices: const [
        _Choice(value: '58', label: '58 มม. · เครื่องพิมพ์ขนาดเล็ก'),
        _Choice(value: '80', label: '80 มม. · มาตรฐาน POS'),
      ],
      required: true,
    );
  } else if (key == 'tax_invoice_paper_size') {
    field = _FieldSpec(
      key: 'value',
      label: 'ขนาดกระดาษใบกำกับภาษี',
      kind: _FieldKind.choice,
      initial: _text(initial, fallback: 'a4').toLowerCase(),
      choices: const [
        _Choice(value: 'a4', label: 'A4 · เอกสารเต็มหน้า'),
        _Choice(value: 'a5', label: 'A5 · เอกสารครึ่งหน้า'),
      ],
      required: true,
    );
  } else if (numberKeys.contains(key)) {
    field = _FieldSpec(
      key: 'value',
      label: 'ค่าตัวเลข',
      kind: key == 'backup_auto_keep' ? _FieldKind.integer : _FieldKind.number,
      initial: initial,
      required: true,
      min: 0,
    );
  } else if (dateKeys.contains(key)) {
    field = _FieldSpec(
      key: 'value',
      label: 'วันที่',
      kind: _FieldKind.date,
      initial: initial,
    );
  } else {
    field = _FieldSpec(
      key: 'value',
      label: 'ค่าใหม่',
      kind: key == 'shop_address' ? _FieldKind.multiline : _FieldKind.text,
      initial: initial,
    );
  }

  return _MutationSpec(
    title: 'แก้ไข ${_settingLabel(key)}',
    description: _settingHint(key),
    procedure: 'catalog.updateSettings',
    successMessage: 'บันทึกการตั้งค่าแล้ว',
    fields: [field],
    inputBuilder: (values) {
      final value = values['value'];
      return <String, Object?>{
        'entries': [
          <String, Object?>{
            'key': key,
            'value': toggleKeys.contains(key)
                ? (value == true ? '1' : '0')
                : '${value ?? ''}',
          },
        ],
      };
    },
  );
}

_MutationSpec _scheduleSpec({
  Map<String, dynamic>? existing,
  required List<Map<String, dynamic>> staffRows,
  required List<Map<String, dynamic>> templateRows,
}) {
  final editing = existing != null;
  final staffChoices = staffRows
      .where((row) => _bool(row['active'], fallback: true))
      .map(
        (row) => _Choice(
          value: _int(row['id']),
          label: '${_text(row['name'])} · ${_text(row['role'])}',
        ),
      )
      .toList();
  final templateChoices = templateRows
      .where((row) => _bool(row['active'], fallback: true))
      .map(
        (row) => _Choice(
          value: _int(row['id']),
          label:
              '${_text(row['name'])} · ${_text(row['startTime'])}–${_text(row['endTime'])}',
        ),
      )
      .toList();
  return _MutationSpec(
    title: editing ? 'แก้ไขตารางงาน' : 'เพิ่มตารางงาน',
    procedure: editing
        ? 'workforce.updateSchedule'
        : 'workforce.createSchedule',
    successMessage: editing ? 'แก้ไขตารางงานแล้ว' : 'เพิ่มตารางงานแล้ว',
    fields: [
      _FieldSpec(
        key: 'workDate',
        label: 'วันที่ทำงาน',
        kind: _FieldKind.date,
        initial: _dateOnly(existing?['workDate']),
        required: true,
      ),
      _FieldSpec(
        key: 'shiftTemplateId',
        label: 'รูปแบบกะ',
        kind: _FieldKind.choice,
        initial: editing
            ? _int(existing['shiftTemplateId'])
            : templateChoices.firstOrNull?.value,
        choices: templateChoices,
        required: true,
      ),
      _FieldSpec(
        key: 'staffId',
        label: 'พนักงาน',
        kind: _FieldKind.choice,
        initial: editing
            ? _int(existing['staffId'])
            : staffChoices.firstOrNull?.value,
        choices: staffChoices,
        required: true,
      ),
      _FieldSpec(
        key: 'status',
        label: 'สถานะ',
        kind: _FieldKind.choice,
        initial: _text(existing?['status'], fallback: 'scheduled'),
        choices: const [
          _Choice(value: 'scheduled', label: 'จัดตารางแล้ว'),
          _Choice(value: 'completed', label: 'ทำงานแล้ว'),
          _Choice(value: 'absent', label: 'ขาดงาน'),
          _Choice(value: 'leave', label: 'ลา'),
        ],
        required: true,
      ),
      _FieldSpec(
        key: 'cashAdvance',
        label: 'เบิกเงินล่วงหน้า',
        kind: _FieldKind.number,
        initial: existing?['cashAdvance'] ?? 0,
        required: true,
        min: 0,
      ),
      _FieldSpec(
        key: 'note',
        label: 'หมายเหตุ',
        kind: _FieldKind.multiline,
        initial: existing?['note'],
      ),
    ],
    inputBuilder: (values) => <String, Object?>{
      if (editing) 'id': _int(existing['id']),
      ...values,
    },
  );
}

_MutationSpec _cashAdvanceSpec(Map<String, dynamic> schedule) => _MutationSpec(
  title: 'แก้ยอดเบิกเงินล่วงหน้า',
  description:
      '${_text(schedule['staffName'], fallback: 'พนักงาน')} · ${_dateOnly(schedule['workDate'])}',
  procedure: 'workforce.updateCashAdvance',
  successMessage: 'บันทึกยอดเบิกและปรับเงินเดือนฉบับร่างแล้ว',
  fields: [
    _FieldSpec(
      key: 'cashAdvance',
      label: 'ยอดเบิกเงินล่วงหน้า (บาท)',
      kind: _FieldKind.number,
      initial: schedule['cashAdvance'] ?? 0,
      required: true,
      min: 0,
    ),
  ],
  inputBuilder: (values) => <String, Object?>{
    'id': _int(schedule['id']),
    'cashAdvance': values['cashAdvance'],
  },
);

_MutationSpec _swapSchedulesSpec(List<Map<String, dynamic>> schedules) {
  final choices = schedules
      .map(
        (row) => _Choice(
          value: _int(row['id']),
          label:
              '${_dateOnly(row['workDate'])} · ${_text(row['shiftName'], fallback: 'กะงาน')} · ${_text(row['staffName'], fallback: 'พนักงาน')}',
        ),
      )
      .toList();
  return _MutationSpec(
    title: 'สลับกะพนักงาน',
    description:
        'เลือกตารางงานคนละ 2 รายการ ระบบจะสลับพนักงานและปรับเงินเดือนฉบับร่างให้โดยอัตโนมัติ',
    procedure: 'workforce.swapSchedules',
    successMessage: 'สลับกะพนักงานแล้ว',
    submitLabel: 'ยืนยันสลับกะ',
    fields: [
      _FieldSpec(
        key: 'firstId',
        label: 'กะรายการที่ 1',
        kind: _FieldKind.choice,
        initial: choices.first.value,
        choices: choices,
        required: true,
      ),
      _FieldSpec(
        key: 'secondId',
        label: 'กะรายการที่ 2',
        kind: _FieldKind.choice,
        initial: choices[1].value,
        choices: choices,
        required: true,
      ),
    ],
    inputBuilder: (values) => <String, Object?>{
      'firstId': _int(values['firstId']),
      'secondId': _int(values['secondId']),
    },
  );
}

_MutationSpec _shiftTemplateSpec({Map<String, dynamic>? existing}) {
  final editing = existing != null;
  return _MutationSpec(
    title: editing ? 'แก้ไขรูปแบบกะ' : 'เพิ่มรูปแบบกะ',
    procedure: 'workforce.upsertTemplate',
    successMessage: editing ? 'แก้ไขรูปแบบกะแล้ว' : 'เพิ่มรูปแบบกะแล้ว',
    fields: [
      _FieldSpec(
        key: 'name',
        label: 'ชื่อกะ',
        initial: existing?['name'],
        required: true,
      ),
      _FieldSpec(
        key: 'startTime',
        label: 'เวลาเริ่ม (HH:mm)',
        initial: existing?['startTime'] ?? '08:00',
        required: true,
      ),
      _FieldSpec(
        key: 'endTime',
        label: 'เวลาสิ้นสุด (HH:mm)',
        initial: existing?['endTime'] ?? '17:00',
        required: true,
      ),
      _FieldSpec(
        key: 'breakMinutes',
        label: 'เวลาพัก (นาที)',
        kind: _FieldKind.integer,
        initial: existing?['breakMinutes'] ?? 60,
        required: true,
        min: 0,
        max: 720,
      ),
      _FieldSpec(
        key: 'active',
        label: 'เปิดใช้งานรูปแบบกะ',
        kind: _FieldKind.toggle,
        initial: existing == null || _bool(existing['active'], fallback: true),
      ),
    ],
    inputBuilder: (values) => <String, Object?>{
      if (editing) 'id': _int(existing['id']),
      ...values,
    },
  );
}

_MutationSpec _generatePayrollSpec() => _MutationSpec(
  title: 'คำนวณเงินเดือน',
  description:
      'ระบบจะคำนวณจากตารางงาน ขาดงาน เงินเบิกล่วงหน้า และข้อมูลค่าจ้าง',
  procedure: 'workforce.generatePayroll',
  successMessage: 'คำนวณเงินเดือนแล้ว',
  submitLabel: 'เริ่มคำนวณ',
  fields: [
    _FieldSpec(
      key: 'month',
      label: 'เดือน (YYYY-MM)',
      initial: DateFormat('yyyy-MM').format(DateTime.now()),
      required: true,
    ),
  ],
);

_MutationSpec _employeeProfileSpec(Map<String, dynamic> profile) =>
    _MutationSpec(
      title: 'ข้อมูลค่าจ้าง ${_text(profile['name'])}',
      procedure: 'workforce.upsertEmployeeProfile',
      successMessage: 'บันทึกข้อมูลค่าจ้างแล้ว',
      fields: [
        _FieldSpec(
          key: 'position',
          label: 'ตำแหน่ง',
          initial: profile['position'],
        ),
        _FieldSpec(
          key: 'salaryType',
          label: 'ประเภทค่าจ้าง',
          kind: _FieldKind.choice,
          initial: _text(profile['salaryType'], fallback: 'monthly'),
          choices: const [
            _Choice(value: 'monthly', label: 'รายเดือน'),
            _Choice(value: 'daily', label: 'รายวัน'),
            _Choice(value: 'hourly', label: 'รายชั่วโมง'),
          ],
          required: true,
        ),
        _FieldSpec(
          key: 'baseRate',
          label: 'อัตราค่าจ้างพื้นฐาน',
          kind: _FieldKind.number,
          initial: profile['baseRate'] ?? 0,
          required: true,
          min: 0,
        ),
        _FieldSpec(
          key: 'overtimeRate',
          label: 'ค่าล่วงเวลาต่อชั่วโมง',
          kind: _FieldKind.number,
          initial: profile['overtimeRate'] ?? 0,
          required: true,
          min: 0,
        ),
        _FieldSpec(
          key: 'hireDate',
          label: 'วันที่เริ่มงาน',
          kind: _FieldKind.date,
          initial: profile['hireDate'],
        ),
        _FieldSpec(
          key: 'note',
          label: 'หมายเหตุ',
          kind: _FieldKind.multiline,
          initial: profile['note'],
        ),
      ],
      inputBuilder: (values) => <String, Object?>{
        'staffId': _int(profile['staffId']),
        'position': values['position'] ?? '',
        'salaryType': values['salaryType'] ?? 'monthly',
        'baseRate': values['baseRate'] ?? 0.0,
        'overtimeRate': values['overtimeRate'] ?? 0.0,
        if (values.containsKey('hireDate')) 'hireDate': values['hireDate'],
        if (values.containsKey('note')) 'note': values['note'],
      },
    );

_MutationSpec _payrollSpec(Map<String, dynamic> payroll) => _MutationSpec(
  title: 'แก้ไขเงินเดือน ${_text(payroll['staffName'])}',
  procedure: 'workforce.updatePayroll',
  successMessage: 'แก้ไขเงินเดือนแล้ว',
  fields: [
    _FieldSpec(
      key: 'overtimeHours',
      label: 'ชั่วโมงล่วงเวลา',
      kind: _FieldKind.number,
      initial: payroll['overtimeHours'] ?? 0,
      required: true,
      min: 0,
    ),
    _FieldSpec(
      key: 'bonus',
      label: 'โบนัส',
      kind: _FieldKind.number,
      initial: payroll['bonus'] ?? 0,
      required: true,
      min: 0,
    ),
    _FieldSpec(
      key: 'deduction',
      label: 'หักอื่น ๆ',
      kind: _FieldKind.number,
      initial: payroll['deduction'] ?? 0,
      required: true,
      min: 0,
    ),
    _FieldSpec(
      key: 'note',
      label: 'หมายเหตุ',
      kind: _FieldKind.multiline,
      initial: payroll['note'],
    ),
  ],
  inputBuilder: (values) => <String, Object?>{
    'id': _int(payroll['id']),
    ...values,
  },
);

_MutationSpec _payrollStatusSpec(Map<String, dynamic> payroll) => _MutationSpec(
  title: 'สถานะเงินเดือน ${_text(payroll['staffName'])}',
  procedure: 'workforce.setPayrollStatus',
  successMessage: 'เปลี่ยนสถานะเงินเดือนแล้ว',
  fields: [
    _FieldSpec(
      key: 'status',
      label: 'สถานะ',
      kind: _FieldKind.choice,
      initial: _text(payroll['status']) == 'paid' ? 'draft' : 'paid',
      choices: const [
        _Choice(value: 'draft', label: 'รอตรวจสอบ / เปิดแก้ไข'),
        _Choice(value: 'paid', label: 'จ่ายแล้ว'),
      ],
      required: true,
    ),
  ],
  inputBuilder: (values) => <String, Object?>{
    'id': _int(payroll['id']),
    ...values,
  },
);

Map<String, Object?> _settingsEntries(
  Map<String, Object?> values,
  List<String> keys, {
  Set<String> toggleKeys = const <String>{},
}) => <String, Object?>{
  'entries': [
    for (final key in keys)
      <String, Object?>{
        'key': key,
        'value': toggleKeys.contains(key)
            ? (values[key] == true ? '1' : '0')
            : '${values[key] ?? ''}',
      },
  ],
};

_MutationSpec _shopProfileSettingsSpec(Map<String, dynamic> settings) =>
    _MutationSpec(
      title: 'ข้อมูลร้านและภาษี',
      description: 'ข้อมูลชุดนี้จะแสดงบนใบเสร็จและใบกำกับภาษี',
      procedure: 'catalog.updateSettings',
      successMessage: 'บันทึกข้อมูลร้านและภาษีแล้ว',
      fields: [
        _FieldSpec(
          key: 'shop_name',
          label: 'ชื่อร้าน',
          initial: settings['shop_name'],
          required: true,
        ),
        _FieldSpec(
          key: 'shop_branch',
          label: 'ชื่อสาขาบนเอกสาร',
          initial: settings['shop_branch'],
        ),
        _FieldSpec(
          key: 'shop_address',
          label: 'ที่อยู่',
          kind: _FieldKind.multiline,
          initial: settings['shop_address'],
        ),
        _FieldSpec(
          key: 'shop_phone',
          label: 'โทรศัพท์',
          initial: settings['shop_phone'],
        ),
        _FieldSpec(
          key: 'tax_id',
          label: 'เลขประจำตัวผู้เสียภาษี',
          initial: settings['tax_id'],
        ),
        _FieldSpec(
          key: 'vat_rate',
          label: 'อัตรา VAT (%)',
          kind: _FieldKind.number,
          initial: settings['vat_rate'] ?? 7,
          required: true,
          min: 0,
          max: 100,
        ),
      ],
      inputBuilder: (values) => _settingsEntries(values, const [
        'shop_name',
        'shop_branch',
        'shop_address',
        'shop_phone',
        'tax_id',
        'vat_rate',
      ]),
    );

_MutationSpec _documentSettingsSpec(
  Map<String, dynamic> settings,
) => _MutationSpec(
  title: 'เอกสารและการพิมพ์',
  description:
      'ตั้งค่ารหัสนำหน้าและขนาดกระดาษ โดยไม่แก้เลขเอกสารถัดไปที่ระบบกำลังใช้งาน',
  procedure: 'catalog.updateSettings',
  successMessage: 'บันทึกการตั้งค่าเอกสารแล้ว',
  fields: [
    _FieldSpec(
      key: 'receipt_prefix',
      label: 'คำนำหน้าเลขใบเสร็จอย่างย่อ',
      initial: settings['receipt_prefix'] ?? 'R',
      hint: 'ไม่เกิน 10 ตัวอักษร',
    ),
    _FieldSpec(
      key: 'tax_invoice_prefix',
      label: 'คำนำหน้าเลขใบกำกับภาษี',
      initial: settings['tax_invoice_prefix'] ?? 'T',
      hint: 'ไม่เกิน 10 ตัวอักษร',
    ),
    _FieldSpec(
      key: 'receipt_paper_size',
      label: 'ขนาดกระดาษใบเสร็จ',
      kind: _FieldKind.choice,
      initial: _text(
        settings['receipt_paper_size'],
        fallback: '80',
      ).toLowerCase(),
      choices: const [
        _Choice(value: '80', label: 'ม้วนความร้อน 80 มม.'),
        _Choice(value: '58', label: 'ม้วนความร้อน 58 มม.'),
        _Choice(value: 'a5', label: 'A5'),
        _Choice(value: 'a4', label: 'A4'),
      ],
      required: true,
    ),
    _FieldSpec(
      key: 'tax_invoice_paper_size',
      label: 'ขนาดกระดาษใบกำกับภาษีเต็มรูป',
      kind: _FieldKind.choice,
      initial: _text(
        settings['tax_invoice_paper_size'],
        fallback: 'a4',
      ).toLowerCase(),
      choices: const [
        _Choice(value: 'a4', label: 'A4 · เอกสารเต็มหน้า'),
        _Choice(value: 'a5', label: 'A5 · เอกสารครึ่งหน้า'),
      ],
      required: true,
    ),
    _FieldSpec(
      key: 'receipt_silent_print',
      label: 'พิมพ์ใบเสร็จอัตโนมัติหลังชำระเงิน',
      kind: _FieldKind.toggle,
      initial: _bool(settings['receipt_silent_print']),
      hint: 'ใช้กับแอปเดสก์ท็อปและเครื่องพิมพ์เริ่มต้น',
    ),
  ],
  inputBuilder: (values) => _settingsEntries(
    values,
    const [
      'receipt_prefix',
      'tax_invoice_prefix',
      'receipt_paper_size',
      'tax_invoice_paper_size',
      'receipt_silent_print',
    ],
    toggleKeys: const {'receipt_silent_print'},
  ),
);

_MutationSpec _membershipSettingsSpec(Map<String, dynamic> settings) =>
    _MutationSpec(
      title: 'สมาชิกและคะแนนสะสม',
      description: 'กำหนดอัตราการได้รับและการใช้คะแนนของสมาชิก',
      procedure: 'catalog.updateSettings',
      successMessage: 'บันทึกอัตราคะแนนแล้ว',
      fields: [
        _FieldSpec(
          key: 'point_earn_per_baht',
          label: 'ยอดซื้อที่ได้รับ 1 คะแนน (บาท)',
          kind: _FieldKind.integer,
          initial: settings['point_earn_per_baht'] ?? 100,
          required: true,
          min: 1,
        ),
        _FieldSpec(
          key: 'point_redeem_value',
          label: 'มูลค่าแลก 1 คะแนน (บาท)',
          kind: _FieldKind.integer,
          initial: settings['point_redeem_value'] ?? 1,
          required: true,
          min: 1,
        ),
      ],
      inputBuilder: (values) => _settingsEntries(values, const [
        'point_earn_per_baht',
        'point_redeem_value',
      ]),
    );

_MutationSpec _checkoutSettingsSpec(Map<String, dynamic> settings) =>
    _MutationSpec(
      title: 'ช่องทางชำระเงินหน้า POS',
      description: 'เลือกช่องทางที่พนักงานจะเห็นในหน้ารับชำระเงิน',
      procedure: 'catalog.updateSettings',
      successMessage: 'บันทึกช่องทางชำระเงินแล้ว',
      fields: [
        _FieldSpec(
          key: 'pay_cash_enabled',
          label: 'เงินสด',
          kind: _FieldKind.toggle,
          initial: _bool(settings['pay_cash_enabled'], fallback: true),
        ),
        _FieldSpec(
          key: 'pay_qr_enabled',
          label: 'โอนจ่าย / QR',
          kind: _FieldKind.toggle,
          initial: _bool(settings['pay_qr_enabled'], fallback: true),
        ),
        _FieldSpec(
          key: 'pay_card_enabled',
          label: 'บัตร',
          kind: _FieldKind.toggle,
          initial: _bool(settings['pay_card_enabled'], fallback: true),
        ),
        _FieldSpec(
          key: 'pay_credit_enabled',
          label: 'เครดิต (ขายเชื่อ)',
          kind: _FieldKind.toggle,
          initial: _bool(settings['pay_credit_enabled'], fallback: true),
        ),
      ],
      inputBuilder: (values) => _settingsEntries(
        values,
        const [
          'pay_cash_enabled',
          'pay_qr_enabled',
          'pay_card_enabled',
          'pay_credit_enabled',
        ],
        toggleKeys: const {
          'pay_cash_enabled',
          'pay_qr_enabled',
          'pay_card_enabled',
          'pay_credit_enabled',
        },
      ),
    );

_MutationSpec _automaticBackupSettingsSpec(Map<String, dynamic> settings) =>
    _MutationSpec(
      title: 'สำรองข้อมูลอัตโนมัติ',
      description: 'กำหนดเวลาและจำนวนชุดสำรองที่ต้องการเก็บไว้',
      procedure: 'catalog.updateSettings',
      successMessage: 'บันทึกการสำรองข้อมูลอัตโนมัติแล้ว',
      fields: [
        _FieldSpec(
          key: 'backup_auto_enabled',
          label: 'เปิดสำรองข้อมูลอัตโนมัติ',
          kind: _FieldKind.toggle,
          initial: _bool(settings['backup_auto_enabled']),
        ),
        _FieldSpec(
          key: 'backup_auto_time',
          label: 'เวลาสำรองข้อมูล',
          initial: settings['backup_auto_time'] ?? '23:30',
          required: true,
          hint: 'รูปแบบ 24 ชั่วโมง เช่น 23:30',
        ),
        _FieldSpec(
          key: 'backup_auto_keep',
          label: 'จำนวนชุดสำรองที่เก็บ',
          kind: _FieldKind.integer,
          initial: settings['backup_auto_keep'] ?? 7,
          required: true,
          min: 1,
        ),
      ],
      inputBuilder: (values) => _settingsEntries(
        values,
        const ['backup_auto_enabled', 'backup_auto_time', 'backup_auto_keep'],
        toggleKeys: const {'backup_auto_enabled'},
      ),
    );

_MutationSpec _perLiterPromotionSpec(Map<String, dynamic> settings) =>
    _MutationSpec(
      title: 'โปรโมชั่นลดราคาต่อลิตร',
      procedure: 'catalog.updatePerLiterPromotion',
      successMessage: 'บันทึกโปรโมชั่นต่อลิตรแล้ว',
      fields: [
        _FieldSpec(
          key: 'enabled',
          label: 'เปิดใช้งานโปรโมชั่น',
          kind: _FieldKind.toggle,
          initial: _bool(settings['promotion_enabled']),
        ),
        _FieldSpec(
          key: 'name',
          label: 'ชื่อโปรโมชั่น',
          initial: settings['promotion_name'],
          required: true,
        ),
        _FieldSpec(
          key: 'discountPerLiter',
          label: 'ส่วนลดต่อลิตร',
          kind: _FieldKind.number,
          initial: settings['promotion_discount'] ?? 0.5,
          required: true,
          min: 0.01,
        ),
        _FieldSpec(
          key: 'startDate',
          label: 'วันที่เริ่ม',
          kind: _FieldKind.date,
          initial: settings['promotion_start_date'],
          required: true,
        ),
        _FieldSpec(
          key: 'endDate',
          label: 'วันที่สิ้นสุด',
          kind: _FieldKind.date,
          initial: settings['promotion_end_date'],
          required: true,
        ),
      ],
    );

_MutationSpec _billPromotionSpec(Map<String, dynamic> settings) =>
    _MutationSpec(
      title: 'โปรโมชั่นลดท้ายบิล',
      procedure: 'catalog.updateBillPromotion',
      successMessage: 'บันทึกโปรโมชั่นท้ายบิลแล้ว',
      fields: [
        _FieldSpec(
          key: 'enabled',
          label: 'เปิดใช้งานโปรโมชั่น',
          kind: _FieldKind.toggle,
          initial: _bool(settings['bill_promotion_enabled']),
        ),
        _FieldSpec(
          key: 'name',
          label: 'ชื่อโปรโมชั่น',
          initial: settings['bill_promotion_name'],
          required: true,
        ),
        _FieldSpec(
          key: 'minimumFuelSpend',
          label: 'ยอดเติมน้ำมันขั้นต่ำ',
          kind: _FieldKind.number,
          initial: settings['bill_promotion_min_fuel_spend'] ?? 1000,
          required: true,
          min: 0.01,
        ),
        _FieldSpec(
          key: 'discount',
          label: 'ส่วนลดท้ายบิล',
          kind: _FieldKind.number,
          initial: settings['bill_promotion_discount'] ?? 20,
          required: true,
          min: 0.01,
        ),
        _FieldSpec(
          key: 'startDate',
          label: 'วันที่เริ่ม',
          kind: _FieldKind.date,
          initial: settings['bill_promotion_start_date'],
          required: true,
        ),
        _FieldSpec(
          key: 'endDate',
          label: 'วันที่สิ้นสุด',
          kind: _FieldKind.date,
          initial: settings['bill_promotion_end_date'],
          required: true,
        ),
      ],
    );

_MutationSpec _branchSpec({Map<String, dynamic>? existing}) {
  final editing = existing != null;
  return _MutationSpec(
    title: editing ? 'แก้ไขสาขา' : 'เพิ่มสาขา',
    description: editing
        ? 'รหัสสาขาไม่สามารถเปลี่ยนได้'
        : 'สามารถคัดลอกสินค้า ตู้จ่าย ถัง และรูปแบบกะจากสาขาปัจจุบัน',
    procedure: editing ? 'auth.updateBranch' : 'auth.createBranch',
    successMessage: editing ? 'แก้ไขสาขาแล้ว' : 'เพิ่มสาขาแล้ว',
    fields: [
      if (!editing)
        const _FieldSpec(
          key: 'code',
          label: 'รหัสสาขา',
          required: true,
          hint: 'ตัวอักษร ตัวเลข _ หรือ -',
        ),
      _FieldSpec(
        key: 'name',
        label: 'ชื่อสาขา',
        initial: existing?['name'],
        required: true,
      ),
      _FieldSpec(
        key: 'address',
        label: 'ที่อยู่',
        kind: _FieldKind.multiline,
        initial: existing?['address'],
      ),
      _FieldSpec(key: 'phone', label: 'โทรศัพท์', initial: existing?['phone']),
      _FieldSpec(
        key: 'taxId',
        label: 'เลขประจำตัวผู้เสียภาษี',
        initial: existing?['taxId'],
      ),
      if (!editing)
        const _FieldSpec(
          key: 'cloneCurrentSetup',
          label: 'คัดลอกโครงสร้างจากสาขาปัจจุบัน',
          kind: _FieldKind.toggle,
          initial: true,
        ),
      if (editing)
        _FieldSpec(
          key: 'active',
          label: 'เปิดใช้งานสาขา',
          kind: _FieldKind.toggle,
          initial: _bool(existing['active'], fallback: true),
        ),
    ],
    inputBuilder: (values) => <String, Object?>{
      if (editing) 'id': _int(existing['id']),
      ...values,
      if (!editing) 'code': _text(values['code']).toUpperCase(),
      if (!values.containsKey('address')) 'address': '',
      if (!values.containsKey('phone')) 'phone': '',
      if (!values.containsKey('taxId')) 'taxId': '',
    },
  );
}

const _allMenuPermissions = <String>[
  'dashboard',
  'pos',
  'shifts',
  'workforce',
  'stock',
  'members',
  'customers',
  'debts',
  'sales',
  'reports',
  'expenses',
  'tax_invoices',
  'documents',
  'settings',
];

_MutationSpec _accessGroupSpec({Map<String, dynamic>? existing}) {
  final editing = existing != null;
  final permissions = existing == null
      ? 'dashboard,pos,shifts,stock,members,customers,debts,sales,expenses'
      : _list(existing['menuPermissions']).join(',');
  return _MutationSpec(
    title: editing ? 'แก้ไขกลุ่มสิทธิ์' : 'เพิ่มกลุ่มสิทธิ์',
    description:
        'ระบุคีย์เมนูคั่นด้วยเครื่องหมายจุลภาค ระบบจะตรวจตามบทบาทอีกชั้นหนึ่ง',
    procedure: editing ? 'auth.updateAccessGroup' : 'auth.createAccessGroup',
    successMessage: editing ? 'แก้ไขกลุ่มสิทธิ์แล้ว' : 'เพิ่มกลุ่มสิทธิ์แล้ว',
    fields: [
      _FieldSpec(
        key: 'name',
        label: 'ชื่อกลุ่ม',
        initial: existing?['name'],
        required: true,
      ),
      _FieldSpec(
        key: 'description',
        label: 'คำอธิบาย',
        kind: _FieldKind.multiline,
        initial: existing?['description'],
      ),
      if (!editing)
        const _FieldSpec(
          key: 'role',
          label: 'บทบาทพื้นฐาน',
          kind: _FieldKind.choice,
          initial: 'cashier',
          choices: [
            _Choice(value: 'manager', label: 'ผู้จัดการ'),
            _Choice(value: 'cashier', label: 'แคชเชียร์'),
          ],
          required: true,
        ),
      _FieldSpec(
        key: 'permissionsText',
        label: 'คีย์เมนู',
        kind: _FieldKind.multiline,
        initial: permissions,
        required: true,
        hint: _allMenuPermissions.join(', '),
      ),
    ],
    inputBuilder: (values) {
      final requested = _text(values['permissionsText'])
          .split(',')
          .map((value) => value.trim())
          .where(_allMenuPermissions.contains)
          .toSet()
          .toList();
      return <String, Object?>{
        if (editing) 'id': _int(existing['id']),
        'name': values['name'],
        'description': values['description'] ?? '',
        if (!editing) 'role': values['role'],
        'menuPermissions': requested,
      };
    },
  );
}

_MutationSpec _pumpSpec({Map<String, dynamic>? existing}) {
  final editing = existing != null;
  return _MutationSpec(
    title: editing ? 'แก้ไขตู้จ่าย' : 'เพิ่มตู้จ่าย',
    procedure: editing ? 'catalog.updatePump' : 'catalog.createPump',
    successMessage: editing ? 'แก้ไขตู้จ่ายแล้ว' : 'เพิ่มตู้จ่ายแล้ว',
    fields: [
      _FieldSpec(
        key: 'name',
        label: 'ชื่อตู้จ่าย',
        initial: existing?['name'],
        required: true,
      ),
    ],
    inputBuilder: (values) => <String, Object?>{
      if (editing) 'id': _int(existing['id']),
      ...values,
    },
  );
}

_MutationSpec _nozzleSpec({
  Map<String, dynamic>? existing,
  required List<Map<String, dynamic>> pumps,
  required List<Map<String, dynamic>> products,
  required List<Map<String, dynamic>> tanks,
}) {
  final editing = existing != null;
  final pumpChoices = pumps
      .map((row) => _Choice(value: _int(row['id']), label: _text(row['name'])))
      .toList();
  final productChoices = products
      .where((row) => _text(row['category']) == 'fuel')
      .map(
        (row) => _Choice(
          value: _int(row['id']),
          label: '${_text(row['code'])} · ${_text(row['name'])}',
        ),
      )
      .toList();
  final tankChoices = tanks
      .map(
        (row) => _Choice(
          value: _int(row['id']),
          label:
              '${_text(row['name'])} · ${_text(_map(row['product'])['name'])}',
        ),
      )
      .toList();
  return _MutationSpec(
    title: editing ? 'แก้ไขหัวจ่าย' : 'เพิ่มหัวจ่าย',
    description: 'สินค้าและถังต้องเป็นน้ำมันชนิดเดียวกัน',
    procedure: editing ? 'catalog.updateNozzleMeter' : 'catalog.createNozzle',
    successMessage: editing ? 'แก้ไขหัวจ่ายแล้ว' : 'เพิ่มหัวจ่ายแล้ว',
    fields: [
      _FieldSpec(
        key: 'pumpId',
        label: 'ตู้จ่าย',
        kind: _FieldKind.choice,
        initial: editing
            ? _int(existing['pumpId'])
            : pumpChoices.firstOrNull?.value,
        choices: pumpChoices,
        required: true,
      ),
      _FieldSpec(
        key: 'productId',
        label: 'ชนิดน้ำมัน',
        kind: _FieldKind.choice,
        initial: editing
            ? _int(existing['productId'])
            : productChoices.firstOrNull?.value,
        choices: productChoices,
        required: true,
      ),
      _FieldSpec(
        key: 'tankId',
        label: 'ถังที่ตัดสต็อก',
        kind: _FieldKind.choice,
        initial: editing
            ? _int(existing['tankId'])
            : tankChoices.firstOrNull?.value,
        choices: tankChoices,
        required: true,
      ),
      _FieldSpec(
        key: 'label',
        label: 'ชื่อหัวจ่าย',
        initial: existing?['label'],
        required: true,
      ),
      _FieldSpec(
        key: 'meter',
        label: 'มิเตอร์ลิตรสะสม',
        kind: _FieldKind.number,
        initial: existing?['currentMeter'] ?? 0,
        required: true,
        min: 0,
      ),
      _FieldSpec(
        key: 'money',
        label: 'มิเตอร์เงินสะสม',
        kind: _FieldKind.number,
        initial: existing?['currentMoney'] ?? 0,
        required: true,
        min: 0,
      ),
      if (editing)
        _FieldSpec(
          key: 'active',
          label: 'เปิดใช้งานหัวจ่าย',
          kind: _FieldKind.toggle,
          initial: _bool(existing['active'], fallback: true),
        ),
    ],
    inputBuilder: (values) => <String, Object?>{
      if (editing) 'id': _int(existing['id']),
      ...values,
    },
  );
}

_MutationSpec _paymentConfigSpec(Map<String, dynamic> config) => _MutationSpec(
  title: 'ตั้งค่าการชำระเงินและถุงเงิน',
  procedure: 'payments.updateConfig',
  successMessage: 'บันทึกการตั้งค่าการชำระเงินแล้ว',
  fields: [
    _FieldSpec(
      key: 'thungngernEnabled',
      label: 'เปิดใช้งานถุงเงิน / ตรวจสลิป',
      kind: _FieldKind.toggle,
      initial: _bool(config['thungngernEnabled']),
    ),
    _FieldSpec(
      key: 'promptpayId',
      label: 'PromptPay ID',
      initial: config['promptpayId'],
    ),
    _FieldSpec(
      key: 'qrMode',
      label: 'รูปแบบ QR',
      kind: _FieldKind.choice,
      initial: _text(config['qrMode'], fallback: 'promptpay'),
      choices: const [
        _Choice(value: 'promptpay', label: 'PromptPay'),
        _Choice(value: 'merchant', label: 'Merchant QR'),
      ],
      required: true,
    ),
    _FieldSpec(
      key: 'merchantPayload',
      label: 'Merchant QR payload',
      kind: _FieldKind.multiline,
      initial: config['merchantPayload'],
    ),
    const _FieldSpec(
      key: 'apiSecret',
      label: 'Slip2Go API Secret ใหม่',
      hint: 'เว้นว่างเพื่อใช้ค่าเดิม',
    ),
    const _FieldSpec(
      key: 'clearApiSecret',
      label: 'ลบ API Secret เดิม',
      kind: _FieldKind.toggle,
    ),
    const _FieldSpec(
      key: 'regenerateWebhookToken',
      label: 'สร้าง Webhook Token ใหม่',
      kind: _FieldKind.toggle,
    ),
  ],
  inputBuilder: (values) => <String, Object?>{
    'thungngernEnabled': values['thungngernEnabled'] ?? false,
    'promptpayId': values['promptpayId'] ?? '',
    'qrMode': values['qrMode'] ?? 'promptpay',
    if (values.containsKey('merchantPayload'))
      'merchantPayload': values['merchantPayload'],
    if (values.containsKey('apiSecret')) 'apiSecret': values['apiSecret'],
    'clearApiSecret': values['clearApiSecret'] ?? false,
    'regenerateWebhookToken': values['regenerateWebhookToken'] ?? false,
  },
);

_MutationSpec _assistantConfigSpec(Map<String, dynamic> config) =>
    _MutationSpec(
      title: 'ตั้งค่าผู้ช่วย AI',
      procedure: 'assistant.updateConfig',
      successMessage: 'บันทึกการตั้งค่า AI แล้ว',
      fields: [
        _FieldSpec(
          key: 'provider',
          label: 'ผู้ให้บริการ',
          kind: _FieldKind.choice,
          initial: _text(config['provider'], fallback: 'ollama'),
          choices: const [
            _Choice(value: 'ollama', label: 'Ollama (Local)'),
            _Choice(value: 'deepseek', label: 'DeepSeek'),
          ],
          required: true,
        ),
        _FieldSpec(
          key: 'ollamaModel',
          label: 'Ollama model',
          initial: config['ollamaModel'] ?? 'qwen3:8b',
          required: true,
        ),
        _FieldSpec(
          key: 'deepseekModel',
          label: 'DeepSeek model',
          initial: config['deepseekModel'] ?? 'deepseek-chat',
          required: true,
        ),
        const _FieldSpec(
          key: 'deepseekApiKey',
          label: 'DeepSeek API Key ใหม่',
          hint: 'เว้นว่างเพื่อใช้ค่าเดิม',
        ),
        const _FieldSpec(
          key: 'clearDeepseekApiKey',
          label: 'ลบ API Key เดิม',
          kind: _FieldKind.toggle,
        ),
      ],
      inputBuilder: (values) => <String, Object?>{
        'provider': values['provider'],
        'ollamaModel': values['ollamaModel'],
        'deepseekModel': values['deepseekModel'],
        if (values.containsKey('deepseekApiKey'))
          'deepseekApiKey': values['deepseekApiKey'],
        'clearDeepseekApiKey': values['clearDeepseekApiKey'] ?? false,
      },
    );

Future<bool> _createTaxInvoice({
  required BuildContext context,
  required OperationsRepository repository,
  required StaffSession staff,
}) async {
  try {
    final sales = _maps(
      await repository.queryProcedure(
        'taxInvoice.salesAvailable',
        branchId: staff.branch.id,
      ),
    );
    if (!context.mounted) return false;
    if (sales.isEmpty) {
      _showMessage(context, 'ไม่มีบิลที่รอออกใบกำกับภาษี');
      return false;
    }
    final selected = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(sheetContext).height * 0.8,
        ),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: Column(
          children: [
            const SizedBox(height: 10),
            Container(
              width: 42,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFD8D5E0),
                borderRadius: BorderRadius.circular(99),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 17, 20, 10),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'เลือกบิลที่ยังไม่มีใบกำกับภาษี',
                  style: Theme.of(
                    sheetContext,
                  ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
                ),
              ),
            ),
            Expanded(
              child: ListView.separated(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 18),
                itemCount: sales.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (_, index) {
                  final sale = sales[index];
                  return ListTile(
                    leading: const Icon(Icons.receipt_long_outlined),
                    title: Text(
                      _text(sale['receiptNo'], fallback: 'บิล #${sale['id']}'),
                    ),
                    subtitle: Text(_formatDateTime(sale['createdAt'])),
                    trailing: Text(
                      _money(_number(sale['total'])),
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    onTap: () => Navigator.pop(sheetContext, sale),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
    if (selected == null || !context.mounted) return false;
    final detail = _map(
      await repository.queryProcedure(
        'pos.saleDetail',
        branchId: staff.branch.id,
        input: {'id': _int(selected['id'])},
      ),
    );
    if (!context.mounted) return false;
    final initial = <String, dynamic>{
      'customerName': _text(
        detail['customerName'],
        fallback: _text(detail['memberName']),
      ),
    };
    return _showMutationForm(
      context: context,
      repository: repository,
      branchId: staff.branch.id,
      spec: _taxInvoiceSpec(
        saleId: _int(selected['id']),
        existing: initial,
        issuedBy: staff.name,
        creating: true,
      ),
    );
  } catch (error) {
    if (context.mounted) _showError(context, error);
    return false;
  }
}

Future<bool> _showMemberCardBatch({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
  required int batchId,
}) async {
  try {
    final payload = _map(
      await repository.queryProcedure(
        'membership.getCardBatch',
        branchId: branchId,
        input: {'id': batchId},
      ),
    );
    if (!context.mounted) return false;
    final batch = _map(payload['batch']);
    final cards = _maps(payload['cards']);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(sheetContext).height * 0.9,
        ),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: Column(
          children: [
            const SizedBox(height: 10),
            Container(
              width: 42,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFD8D5E0),
                borderRadius: BorderRadius.circular(99),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(20),
              child: Row(
                children: [
                  const Icon(Icons.badge_outlined, color: Color(0xFF6554D9)),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _text(batch['label'], fallback: 'ชุดบัตรสมาชิก'),
                          style: Theme.of(sheetContext).textTheme.titleLarge
                              ?.copyWith(fontWeight: FontWeight.w900),
                        ),
                        Text(
                          '${_text(batch['batchCode'])} · ${cards.length} ใบ',
                          style: const TextStyle(color: Color(0xFF777487)),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: ListView.separated(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 20),
                itemCount: cards.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (_, index) {
                  final card = cards[index];
                  return ListTile(
                    leading: CircleAvatar(child: Text('${index + 1}')),
                    title: SelectableText(
                      _text(card['memberCode']),
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    trailing: _StatusPill(label: _cardStatus(card['status'])),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
    return false;
  } catch (error) {
    if (context.mounted) _showError(context, error);
    return false;
  }
}

Future<bool> _showMemberTransactions({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
  required Map<String, dynamic> member,
}) async {
  try {
    final rows = _maps(
      await repository.queryProcedure(
        'membership.memberTransactions',
        branchId: branchId,
        input: {'memberId': _int(member['id'])},
      ),
    );
    if (!context.mounted) return false;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => FractionallySizedBox(
        heightFactor: .82,
        child: Scaffold(
          appBar: AppBar(title: Text('ประวัติคะแนน ${_text(member['name'])}')),
          body: rows.isEmpty
              ? const Center(child: Text('ยังไม่มีประวัติคะแนน'))
              : ListView.separated(
                  padding: const EdgeInsets.all(14),
                  itemCount: rows.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 8),
                  itemBuilder: (context, index) {
                    final row = rows[index];
                    final points = _int(row['points']);
                    return Card(
                      margin: EdgeInsets.zero,
                      child: ListTile(
                        leading: CircleAvatar(
                          backgroundColor: points < 0
                              ? const Color(0xFFFFEEEE)
                              : const Color(0xFFE5F8EF),
                          foregroundColor: points < 0
                              ? const Color(0xFFB42318)
                              : const Color(0xFF087443),
                          child: Icon(
                            points < 0
                                ? Icons.remove_rounded
                                : Icons.add_rounded,
                          ),
                        ),
                        title: Text(
                          '${points > 0 ? '+' : ''}$points แต้ม',
                          style: const TextStyle(fontWeight: FontWeight.w900),
                        ),
                        subtitle: Text(
                          '${_text(row['note'], fallback: _text(row['type']))}\n${_text(row['branchName'])}',
                        ),
                        trailing: Text(
                          _formatDateTime(row['createdAt']),
                          textAlign: TextAlign.right,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ),
                    );
                  },
                ),
        ),
      ),
    );
  } catch (error) {
    if (context.mounted) _showError(context, error);
  }
  return false;
}

Future<bool> _showPriceHistory({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
  required Map<String, dynamic> product,
}) async {
  try {
    final rows = _maps(
      await repository.queryProcedure(
        'catalog.priceHistory',
        branchId: branchId,
        input: {'productId': _int(product['id'])},
      ),
    );
    if (!context.mounted) return false;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => FractionallySizedBox(
        heightFactor: .8,
        child: Scaffold(
          appBar: AppBar(title: Text('ประวัติราคา ${_text(product['name'])}')),
          body: rows.isEmpty
              ? const Center(child: Text('ยังไม่มีประวัติเปลี่ยนราคา'))
              : ListView.separated(
                  padding: const EdgeInsets.all(14),
                  itemCount: rows.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 8),
                  itemBuilder: (context, index) {
                    final row = rows[index];
                    return Card(
                      margin: EdgeInsets.zero,
                      child: ListTile(
                        leading: const CircleAvatar(
                          child: Icon(Icons.currency_exchange_rounded),
                        ),
                        title: Text(
                          '${_money(_number(row['oldPrice']))} → ${_money(_number(row['newPrice']))}',
                          style: const TextStyle(fontWeight: FontWeight.w900),
                        ),
                        subtitle: Text(
                          '${_text(row['changedBy'], fallback: 'ระบบ')} · ${_formatDateTime(row['createdAt'])}',
                        ),
                      ),
                    );
                  },
                ),
        ),
      ),
    );
    return false;
  } catch (error) {
    if (context.mounted) _showError(context, error);
    return false;
  }
}

Future<bool> _showDebtDetail({
  required BuildContext context,
  required OperationsRepository repository,
  required StaffSession staff,
  required Map<String, dynamic> customer,
}) async {
  final changed = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _DebtDetailSheet(
      repository: repository,
      staff: staff,
      customer: customer,
    ),
  );
  return changed == true;
}

class _DebtDetailSheet extends StatefulWidget {
  const _DebtDetailSheet({
    required this.repository,
    required this.staff,
    required this.customer,
  });

  final OperationsRepository repository;
  final StaffSession staff;
  final Map<String, dynamic> customer;

  @override
  State<_DebtDetailSheet> createState() => _DebtDetailSheetState();
}

class _DebtDetailSheetState extends State<_DebtDetailSheet> {
  late Future<Map<String, dynamic>> _detail;
  bool _changed = false;

  @override
  void initState() {
    super.initState();
    _detail = _load();
  }

  Future<Map<String, dynamic>> _load() async => _map(
    await widget.repository.queryProcedure(
      'credit.detail',
      branchId: widget.staff.branch.id,
      input: {'customerId': _int(widget.customer['id'])},
    ),
  );

  Future<void> _removePayment(Map<String, dynamic> payment) async {
    final ok = await _confirmMutation(
      context: context,
      repository: widget.repository,
      branchId: widget.staff.branch.id,
      procedure: 'credit.removePayment',
      input: {'id': _int(payment['id'])},
      confirmation:
          'ยืนยันลบรายการชำระ ${_text(payment['paymentNo'])} หรือไม่?',
      successMessage: 'ลบรายการชำระแล้ว',
    );
    if (ok && mounted) {
      setState(() {
        _changed = true;
        _detail = _load();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: true,
      onPopInvokedWithResult: (didPop, _) {},
      child: Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.92,
        ),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: Column(
          children: [
            const SizedBox(height: 10),
            Container(
              width: 42,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFD8D5E0),
                borderRadius: BorderRadius.circular(99),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 17, 12, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'รายละเอียดลูกหนี้ ${_text(widget.customer['name'])}',
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context, _changed),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            Expanded(
              child: FutureBuilder<Map<String, dynamic>>(
                future: _detail,
                builder: (context, snapshot) {
                  if (!snapshot.hasData) {
                    if (snapshot.hasError) {
                      return Center(child: Text('${snapshot.error}'));
                    }
                    return const Center(child: CircularProgressIndicator());
                  }
                  final data = snapshot.data!;
                  final sales = _maps(data['creditSales']);
                  final payments = _maps(data['payments']);
                  return ListView(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                    children: [
                      _SummaryTile(
                        label: 'ยอดค้างชำระ',
                        value: _money(_number(data['outstanding'])),
                        color: const Color(0xFFC94B4B),
                      ),
                      const SizedBox(height: 18),
                      const _SectionTitle(title: 'บิลเครดิต'),
                      for (final sale in sales)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.receipt_long_outlined),
                          title: Text(_text(sale['receiptNo'])),
                          subtitle: Text(_formatDateTime(sale['createdAt'])),
                          trailing: Text(
                            _money(_number(sale['total'])),
                            style: const TextStyle(fontWeight: FontWeight.w800),
                          ),
                        ),
                      if (sales.isEmpty) const Text('ไม่มีบิลเครดิต'),
                      const SizedBox(height: 18),
                      const _SectionTitle(title: 'ประวัติชำระ'),
                      for (final payment in payments)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.payments_outlined),
                          title: Text(_text(payment['paymentNo'])),
                          subtitle: Text(
                            '${_paymentLabel(payment['method'])} · ${_formatDateTime(payment['createdAt'])}',
                          ),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                _money(_number(payment['amount'])),
                                style: const TextStyle(
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              IconButton(
                                tooltip: 'ดู / พิมพ์ใบรับชำระหนี้',
                                onPressed: () => showDebtPaymentPreview(
                                  context: context,
                                  repository: widget.repository,
                                  branchId: widget.staff.branch.id,
                                  payment: payment,
                                  customerName: _text(widget.customer['name']),
                                ),
                                icon: const Icon(Icons.print_outlined),
                              ),
                              IconButton(
                                tooltip: 'ลบรายการชำระ',
                                onPressed: () => _removePayment(payment),
                                icon: const Icon(
                                  Icons.delete_outline_rounded,
                                  color: Color(0xFFC94B4B),
                                ),
                              ),
                            ],
                          ),
                        ),
                      if (payments.isEmpty) const Text('ยังไม่มีประวัติชำระ'),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

Future<bool> _showSaleDetail({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
  required int saleId,
}) async {
  try {
    final data = _map(
      await repository.queryProcedure(
        'pos.saleDetail',
        branchId: branchId,
        input: {'id': saleId},
      ),
    );
    if (!context.mounted) return false;
    final sale = _map(data['sale']);
    final items = _maps(data['items']);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(sheetContext).height * 0.9,
        ),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
          children: [
            Text(
              _text(sale['receiptNo'], fallback: 'รายละเอียดบิล'),
              style: Theme.of(
                sheetContext,
              ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 4),
            Text(
              '${_formatDateTime(sale['createdAt'])} · ${_paymentLabel(sale['paymentMethod'])}',
              style: const TextStyle(color: Color(0xFF777487)),
            ),
            const SizedBox(height: 16),
            for (final item in items)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(_text(item['name'], fallback: 'สินค้า')),
                subtitle: Text(
                  '${_formatNumber(_number(item['qty']).abs())} ${_text(item['unit'])} × ${_money(_number(item['unitPrice']))}',
                ),
                trailing: Text(
                  _money(_number(item['amount']).abs()),
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
            const Divider(),
            _KeyValue(
              label: 'ยอดก่อนลด',
              value: _money(_number(sale['subtotal'])),
            ),
            _KeyValue(
              label: 'ส่วนลด',
              value: _money(_number(sale['discount'])),
            ),
            _KeyValue(
              label: 'ยอดสุทธิ',
              value: _money(_number(sale['total'])),
              emphasized: true,
            ),
            if (_text(data['memberName']).isNotEmpty)
              _KeyValue(label: 'สมาชิก', value: _text(data['memberName'])),
            if (_text(data['customerName']).isNotEmpty)
              _KeyValue(
                label: 'ลูกค้าเครดิต',
                value: _text(data['customerName']),
              ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: () => showSaleReceiptPreview(
                context: sheetContext,
                repository: repository,
                branchId: branchId,
                saleId: saleId,
              ),
              icon: const Icon(Icons.print_outlined),
              label: const Text('ดู / พิมพ์ใบเสร็จ'),
            ),
            if (_text(sale['status']) == 'completed' &&
                _text(sale['transactionType']) != 'return') ...[
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: () async {
                  final invoice = _map(
                    await repository.queryProcedure(
                      'taxInvoice.bySale',
                      branchId: branchId,
                      input: {'saleId': saleId},
                    ),
                  );
                  if (!sheetContext.mounted) return;
                  if (invoice.isEmpty) {
                    _showMessage(
                      sheetContext,
                      'บิลนี้ยังไม่มีใบกำกับภาษีเต็มรูป กรุณาออกจากเมนูใบกำกับภาษี',
                    );
                    return;
                  }
                  await showTaxInvoicePreview(
                    context: sheetContext,
                    repository: repository,
                    branchId: branchId,
                    saleId: saleId,
                  );
                },
                icon: const Icon(Icons.description_outlined),
                label: const Text('ดู / พิมพ์ใบกำกับภาษีเต็มรูป'),
              ),
            ],
          ],
        ),
      ),
    );
    return false;
  } catch (error) {
    if (context.mounted) _showError(context, error);
    return false;
  }
}

Future<bool> _returnSale({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
  required int saleId,
}) async {
  try {
    final detail = _map(
      await repository.queryProcedure(
        'pos.saleDetail',
        branchId: branchId,
        input: {'id': saleId},
      ),
    );
    if (!context.mounted) return false;
    final returnable = _maps(
      detail['returnableItems'],
    ).where((row) => _bool(row['returnable'])).toList();
    if (returnable.isEmpty) {
      _showMessage(context, 'บิลนี้ไม่มีสินค้าที่สามารถคืนได้');
      return false;
    }
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ReturnSaleSheet(
        repository: repository,
        branchId: branchId,
        saleId: saleId,
        items: returnable,
      ),
    );
    if (saved == true && context.mounted) {
      _showMessage(context, 'บันทึกคืนสินค้าแล้ว');
    }
    return saved == true;
  } catch (error) {
    if (context.mounted) _showError(context, error);
    return false;
  }
}

class _ReturnSaleSheet extends StatefulWidget {
  const _ReturnSaleSheet({
    required this.repository,
    required this.branchId,
    required this.saleId,
    required this.items,
  });

  final OperationsRepository repository;
  final int branchId;
  final int saleId;
  final List<Map<String, dynamic>> items;

  @override
  State<_ReturnSaleSheet> createState() => _ReturnSaleSheetState();
}

class _ReturnSaleSheetState extends State<_ReturnSaleSheet> {
  final _controllers = <int, TextEditingController>{};
  final _reason = TextEditingController();
  String _method = 'cash';
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    for (final item in widget.items) {
      _controllers[_int(item['id'])] = TextEditingController(text: '0');
    }
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    _reason.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final rows = <Map<String, Object?>>[];
    for (final item in widget.items) {
      final qty = double.tryParse(_controllers[_int(item['id'])]!.text) ?? 0;
      final max = _number(item['returnableQty']);
      if (qty < 0 || qty > max) {
        setState(
          () => _error = 'จำนวนคืน ${_text(item['productName'])} ไม่ถูกต้อง',
        );
        return;
      }
      if (qty > 0) rows.add({'saleItemId': _int(item['id']), 'qty': qty});
    }
    if (rows.isEmpty) {
      setState(() => _error = 'กรุณาระบุสินค้าที่ต้องการคืน');
      return;
    }
    if (_reason.text.trim().length < 3) {
      setState(() => _error = 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.repository.mutateProcedure(
        'pos.returnSale',
        branchId: widget.branchId,
        input: <String, Object?>{
          'saleId': widget.saleId,
          'items': rows,
          'reason': _reason.text.trim(),
          'refundMethod': _method,
        },
      );
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = '$error';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.92,
      ),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: ListView(
        padding: EdgeInsets.fromLTRB(
          20,
          18,
          20,
          22 + MediaQuery.viewInsetsOf(context).bottom,
        ),
        children: [
          Text(
            'คืนสินค้า',
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 6),
          const Text(
            'น้ำมันเชื้อเพลิงไม่สามารถคืนผ่าน workflow นี้ได้',
            style: TextStyle(color: Color(0xFF777487)),
          ),
          const SizedBox(height: 16),
          for (final item in widget.items) ...[
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _text(item['productName']),
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                      Text(
                        'คืนได้สูงสุด ${_formatNumber(_number(item['returnableQty']))} ${_text(item['unit'])}',
                        style: const TextStyle(
                          color: Color(0xFF777487),
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                SizedBox(
                  width: 92,
                  child: TextField(
                    controller: _controllers[_int(item['id'])],
                    enabled: !_busy,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(labelText: 'จำนวนคืน'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
          ],
          TextField(
            controller: _reason,
            enabled: !_busy,
            maxLines: 3,
            decoration: const InputDecoration(labelText: 'เหตุผลการคืน *'),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _method,
            decoration: const InputDecoration(labelText: 'ช่องทางคืนเงิน'),
            items: const [
              DropdownMenuItem(value: 'cash', child: Text('เงินสด')),
              DropdownMenuItem(value: 'qr', child: Text('QR')),
              DropdownMenuItem(value: 'card', child: Text('บัตร')),
              DropdownMenuItem(value: 'credit', child: Text('เครดิต')),
              DropdownMenuItem(value: 'thungngern', child: Text('ถุงเงิน')),
            ],
            onChanged: _busy
                ? null
                : (value) => setState(() => _method = value ?? 'cash'),
          ),
          if (_error case final error?) ...[
            const SizedBox(height: 12),
            Text(error, style: const TextStyle(color: Color(0xFFC94B4B))),
          ],
          const SizedBox(height: 16),
          SizedBox(
            height: 52,
            child: FilledButton.icon(
              onPressed: _busy ? null : _submit,
              icon: _busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.assignment_return_outlined),
              label: const Text('ยืนยันคืนสินค้า'),
            ),
          ),
        ],
      ),
    );
  }
}

Future<bool> _openStockCountSession({
  required BuildContext context,
  required OperationsRepository repository,
  required StaffSession staff,
  required int sessionId,
}) async {
  final changed = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _StockCountSessionSheet(
      repository: repository,
      staff: staff,
      sessionId: sessionId,
    ),
  );
  return changed == true;
}

class _StockCountSessionSheet extends StatefulWidget {
  const _StockCountSessionSheet({
    required this.repository,
    required this.staff,
    required this.sessionId,
  });

  final OperationsRepository repository;
  final StaffSession staff;
  final int sessionId;

  @override
  State<_StockCountSessionSheet> createState() =>
      _StockCountSessionSheetState();
}

class _StockCountSessionSheetState extends State<_StockCountSessionSheet> {
  late Future<Map<String, dynamic>> _session;
  final _controllers = <int, TextEditingController>{};
  bool _busy = false;
  bool _changed = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _session = _load();
  }

  Future<Map<String, dynamic>> _load() async => _map(
    await widget.repository.queryProcedure(
      'stockCount.getSession',
      branchId: widget.staff.branch.id,
      input: {'id': widget.sessionId},
    ),
  );

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  TextEditingController _controller(Map<String, dynamic> item) {
    final id = _int(item['id']);
    return _controllers.putIfAbsent(
      id,
      () => TextEditingController(
        text: item['countedQty'] == null
            ? ''
            : _formatNumber(_number(item['countedQty'])),
      ),
    );
  }

  Future<void> _save(Map<String, dynamic> data) async {
    final items = _maps(data['items']);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      var saved = 0;
      for (final item in items) {
        final text = _controller(item).text.trim();
        if (text.isEmpty) continue;
        final qty = double.tryParse(text.replaceAll(',', ''));
        if (qty == null || qty < 0) {
          throw Exception('จำนวนของ ${_text(item['productName'])} ไม่ถูกต้อง');
        }
        final previous = item['countedQty'];
        if (previous != null && (_number(previous) - qty).abs() < 0.000001) {
          continue;
        }
        await widget.repository.mutateProcedure(
          'stockCount.saveItemCount',
          branchId: widget.staff.branch.id,
          input: <String, Object?>{
            'sessionId': widget.sessionId,
            'itemId': _int(item['id']),
            'countedQty': qty,
          },
        );
        saved++;
      }
      if (!mounted) return;
      setState(() {
        _busy = false;
        _changed = _changed || saved > 0;
        _session = _load();
      });
      _showMessage(
        context,
        saved == 0 ? 'ไม่มีรายการเปลี่ยนแปลง' : 'บันทึก $saved รายการแล้ว',
      );
    } catch (error) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = '$error';
        });
      }
    }
  }

  Future<void> _finish(String procedure, String confirmation) async {
    final ok = await _confirmMutation(
      context: context,
      repository: widget.repository,
      branchId: widget.staff.branch.id,
      procedure: procedure,
      input: {'id': widget.sessionId},
      confirmation: confirmation,
      successMessage: procedure.endsWith('completeSession')
          ? 'ยืนยันผลตรวจนับแล้ว'
          : 'ยกเลิกรอบตรวจนับแล้ว',
    );
    if (ok && mounted) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.94,
      ),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: FutureBuilder<Map<String, dynamic>>(
        future: _session,
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            if (snapshot.hasError) {
              return Center(child: Text('${snapshot.error}'));
            }
            return const Center(child: CircularProgressIndicator());
          }
          final data = snapshot.data!;
          final items = _maps(data['items']);
          final summary = _map(data['summary']);
          final counting = _text(data['status']) == 'counting';
          final manager = widget.staff.role != StaffRole.cashier;
          return Column(
            children: [
              const SizedBox(height: 10),
              Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: const Color(0xFFD8D5E0),
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 15, 12, 10),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _text(data['name'], fallback: 'รอบตรวจนับ'),
                            style: Theme.of(context).textTheme.titleLarge
                                ?.copyWith(fontWeight: FontWeight.w900),
                          ),
                          Text(
                            'นับแล้ว ${_int(summary['countedItems'])}/${_int(summary['totalItems'])} · ต่าง ${_formatNumber(_number(summary['totalDifference']))}',
                            style: const TextStyle(color: Color(0xFF777487)),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(context, _changed),
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
                  itemCount: items.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (_, index) {
                    final item = items[index];
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _text(item['productName']),
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                Text(
                                  '${_text(item['productCode'])} · ระบบ ${_formatNumber(_number(item['expectedQty']))} ${_text(item['unit'])}',
                                  style: const TextStyle(
                                    color: Color(0xFF777487),
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          SizedBox(
                            width: 105,
                            child: TextField(
                              controller: _controller(item),
                              enabled: counting && !_busy,
                              keyboardType:
                                  const TextInputType.numberWithOptions(
                                    decimal: true,
                                  ),
                              decoration: InputDecoration(
                                labelText: 'นับจริง',
                                suffixText: _text(item['unit']),
                              ),
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
              if (_error case final error?)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Text(
                    error,
                    style: const TextStyle(color: Color(0xFFC94B4B)),
                  ),
                ),
              if (counting)
                SafeArea(
                  top: false,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
                    child: Column(
                      children: [
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton.icon(
                            onPressed: _busy ? null : () => _save(data),
                            icon: _busy
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.save_outlined),
                            label: const Text('บันทึกจำนวนที่นับ'),
                          ),
                        ),
                        if (manager) ...[
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton(
                                  onPressed: _busy
                                      ? null
                                      : () => _finish(
                                          'stockCount.cancelSession',
                                          'ยืนยันยกเลิกรอบตรวจนับนี้หรือไม่?',
                                        ),
                                  child: const Text('ยกเลิกรอบ'),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: FilledButton.tonal(
                                  onPressed: _busy
                                      ? null
                                      : () => _finish(
                                          'stockCount.completeSession',
                                          'ยืนยันผลตรวจนับและปรับยอดสินค้าให้ตรงกับจำนวนจริงหรือไม่?',
                                        ),
                                  child: const Text('ยืนยันผล'),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _SummaryTile extends StatelessWidget {
  const _SummaryTile({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: color.withValues(alpha: 0.16)),
      ),
      child: Row(
        children: [
          Expanded(child: Text(label)),
          Text(
            value,
            style: TextStyle(
              color: color,
              fontSize: 20,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 4),
    child: Text(
      title,
      style: Theme.of(
        context,
      ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w900),
    ),
  );
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
    decoration: BoxDecoration(
      color: const Color(0xFFEDE9FE),
      borderRadius: BorderRadius.circular(99),
    ),
    child: Text(
      label,
      style: const TextStyle(
        color: Color(0xFF5E4FC4),
        fontSize: 11,
        fontWeight: FontWeight.w800,
      ),
    ),
  );
}

class _KeyValue extends StatelessWidget {
  const _KeyValue({
    required this.label,
    required this.value,
    this.emphasized = false,
  });

  final String label;
  final String value;
  final bool emphasized;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 5),
    child: Row(
      children: [
        Expanded(child: Text(label)),
        Text(
          value,
          style: TextStyle(
            fontSize: emphasized ? 17 : 14,
            fontWeight: emphasized ? FontWeight.w900 : FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}

Map<String, dynamic> _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return const <String, dynamic>{};
}

List<Map<String, dynamic>> _maps(Object? value) {
  if (value is! List) return const [];
  return value.map(_map).where((row) => row.isNotEmpty).toList();
}

List<Object?> _list(Object? value) => value is List ? value : const [];

String _text(Object? value, {String fallback = ''}) {
  if (value == null) return fallback;
  final text = '$value'.trim();
  return text.isEmpty ? fallback : text;
}

int _int(Object? value) {
  if (value is num) return value.toInt();
  return int.tryParse('$value') ?? 0;
}

double _number(Object? value) {
  if (value is num) return value.toDouble();
  return double.tryParse('$value') ?? 0;
}

bool _bool(Object? value, {bool fallback = false}) {
  if (value is bool) return value;
  if (value == 1 || value == '1' || value == 'true') return true;
  if (value == 0 || value == '0' || value == 'false') return false;
  return fallback;
}

String _dateOnly(Object? value) {
  final date = DateTime.tryParse(_text(value))?.toLocal() ?? DateTime.now();
  return DateFormat('yyyy-MM-dd').format(date);
}

String _formatDateTime(Object? value) {
  final date = DateTime.tryParse(_text(value))?.toLocal();
  return date == null
      ? '-'
      : DateFormat('d MMM yyyy HH:mm', 'th_TH').format(date);
}

String _formatNumber(double value) =>
    NumberFormat('#,##0.###', 'th_TH').format(value);

String _money(double value) =>
    '฿${NumberFormat('#,##0.00', 'th_TH').format(value)}';

String _paymentLabel(Object? value) => switch (_text(value)) {
  'cash' => 'เงินสด',
  'qr' => 'QR',
  'transfer' => 'โอนเงิน',
  'card' => 'บัตร',
  'credit' => 'เครดิต',
  'thungngern' => 'ถุงเงิน',
  final value => value.isEmpty ? '-' : value,
};

String _cardStatus(Object? value) => switch (_text(value)) {
  'unused' => 'พร้อมใช้',
  'activated' => 'เปิดใช้แล้ว',
  'void' => 'ยกเลิก',
  final value => value.isEmpty ? '-' : value,
};

String _settingLabel(String key) => switch (key) {
  'shop_name' => 'ชื่อสถานี / ร้านค้า',
  'shop_branch' => 'ชื่อสาขาบนเอกสาร',
  'shop_address' => 'ที่อยู่',
  'shop_phone' => 'โทรศัพท์',
  'tax_id' => 'เลขประจำตัวผู้เสียภาษี',
  'receipt_prefix' => 'คำนำหน้าเลขใบเสร็จ',
  'tax_invoice_prefix' => 'คำนำหน้าใบกำกับภาษี',
  'receipt_paper_size' => 'ขนาดกระดาษใบเสร็จ',
  'tax_invoice_paper_size' => 'ขนาดกระดาษใบกำกับภาษี',
  'vat_enabled' => 'เปิดใช้งาน VAT',
  'vat_rate' => 'อัตรา VAT',
  'point_earn_per_baht' => 'ยอดซื้อที่ได้รับ 1 คะแนน',
  'point_redeem_value' => 'มูลค่าแลก 1 คะแนน',
  'pay_cash_enabled' => 'รับชำระเงินสด',
  'pay_qr_enabled' => 'รับชำระ QR',
  'pay_card_enabled' => 'รับชำระบัตร',
  'pay_credit_enabled' => 'รับชำระเครดิต',
  'receipt_silent_print' => 'พิมพ์ใบเสร็จอัตโนมัติ',
  'backup_auto_enabled' => 'สำรองข้อมูลอัตโนมัติ',
  'backup_auto_time' => 'เวลาสำรองข้อมูล',
  'backup_auto_keep' => 'จำนวนชุดสำรองที่เก็บ',
  'promotion_enabled' => 'โปรโมชั่นลดต่อลิตร',
  'promotion_name' => 'ชื่อโปรโมชั่นลดต่อลิตร',
  'promotion_discount' => 'ส่วนลดต่อลิตร',
  'promotion_start_date' => 'วันเริ่มโปรโมชั่นต่อลิตร',
  'promotion_end_date' => 'วันสิ้นสุดโปรโมชั่นต่อลิตร',
  'bill_promotion_enabled' => 'โปรโมชั่นลดท้ายบิล',
  'bill_promotion_name' => 'ชื่อโปรโมชั่นท้ายบิล',
  'bill_promotion_min_fuel_spend' => 'ยอดเติมขั้นต่ำ',
  'bill_promotion_discount' => 'ส่วนลดท้ายบิล',
  'bill_promotion_start_date' => 'วันเริ่มโปรโมชั่นท้ายบิล',
  'bill_promotion_end_date' => 'วันสิ้นสุดโปรโมชั่นท้ายบิล',
  _ => key,
};

String _settingHint(String key) => switch (key) {
  'shop_name' || 'shop_branch' => 'ชื่อนี้จะแสดงบนใบเสร็จและเอกสารของสาขา',
  'shop_address' ||
  'shop_phone' ||
  'tax_id' => 'ข้อมูลนี้ใช้กับใบเสร็จและเอกสารภาษี',
  'receipt_prefix' ||
  'tax_invoice_prefix' => 'ใช้ตัวอักษรสั้น ๆ และไม่ต้องใส่เลขลำดับ',
  'receipt_paper_size' ||
  'tax_invoice_paper_size' => 'เลือกให้ตรงกับกระดาษและเครื่องพิมพ์ที่ใช้งาน',
  'point_earn_per_baht' => 'ยอดซื้อกี่บาทจึงได้รับ 1 คะแนน',
  'point_redeem_value' => 'มูลค่าส่วนลดต่อ 1 คะแนน',
  'backup_auto_time' => 'รูปแบบเวลา 24 ชั่วโมง เช่น 02:00',
  final value when value.startsWith('pay_') =>
    'เปิดหรือปิดช่องทางนี้บนหน้ารับชำระเงิน',
  final value when value.contains('promotion') =>
    'สามารถแก้ทั้งชุดได้จากเมนูเครื่องมือผู้ดูแลระบบ',
  _ => 'การเปลี่ยนแปลงมีผลกับสาขาปัจจุบัน',
};

void _showMessage(BuildContext context, String message) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
}

void _showError(BuildContext context, Object error) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text('$error'), backgroundColor: const Color(0xFFC94B4B)),
  );
}
