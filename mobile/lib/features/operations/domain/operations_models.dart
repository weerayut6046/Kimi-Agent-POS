import 'package:flutter/material.dart';

enum OperationsModule {
  workforce,
  stock,
  stockCount,
  members,
  memberCards,
  customers,
  debts,
  sales,
  expenses,
  reports,
  fuelStockReport,
  tankReconciliation,
  taxInvoices,
  documents,
  audit,
  security,
  settings,
}

extension OperationsModuleInfo on OperationsModule {
  String get permission => switch (this) {
    OperationsModule.taxInvoices => 'tax_invoices',
    OperationsModule.stockCount => 'stock',
    OperationsModule.memberCards => 'members',
    OperationsModule.fuelStockReport ||
    OperationsModule.tankReconciliation => 'reports',
    _ => name,
  };

  String get title => switch (this) {
    OperationsModule.workforce => 'พนักงาน',
    OperationsModule.stock => 'สต็อก',
    OperationsModule.stockCount => 'ตรวจนับสต็อก',
    OperationsModule.members => 'สมาชิก',
    OperationsModule.memberCards => 'ชุดบัตรสมาชิก',
    OperationsModule.customers => 'ลูกค้า',
    OperationsModule.debts => 'ลูกหนี้',
    OperationsModule.sales => 'รายการขาย',
    OperationsModule.expenses => 'ค่าใช้จ่าย',
    OperationsModule.reports => 'รายงานประจำวัน',
    OperationsModule.fuelStockReport => 'รายงานสต็อกน้ำมัน',
    OperationsModule.tankReconciliation => 'กระทบยอดถัง',
    OperationsModule.taxInvoices => 'ใบกำกับภาษี',
    OperationsModule.documents => 'ศูนย์เอกสาร',
    OperationsModule.audit => 'ตรวจสอบระบบ',
    OperationsModule.security => 'ความปลอดภัย',
    OperationsModule.settings => 'ตั้งค่าระบบ',
  };

  String get eyebrow => switch (this) {
    OperationsModule.workforce => 'Workforce',
    OperationsModule.stock => 'Inventory',
    OperationsModule.stockCount => 'Stock count',
    OperationsModule.members => 'Membership',
    OperationsModule.memberCards => 'Member cards',
    OperationsModule.customers => 'CRM',
    OperationsModule.debts => 'Credit control',
    OperationsModule.sales => 'Sales history',
    OperationsModule.expenses => 'Cash out',
    OperationsModule.reports => 'Daily report',
    OperationsModule.fuelStockReport => 'Fuel inventory',
    OperationsModule.tankReconciliation => 'Tank reconciliation',
    OperationsModule.taxInvoices => 'Tax documents',
    OperationsModule.documents => 'Document center',
    OperationsModule.audit => 'Audit trail',
    OperationsModule.security => 'Security center',
    OperationsModule.settings => 'Configuration',
  };

  String get subtitle => switch (this) {
    OperationsModule.workforce => 'รายชื่อพนักงานและสถานะการใช้งาน',
    OperationsModule.stock => 'ยอดคงเหลือสินค้าและถังน้ำมันแบบเรียลไทม์',
    OperationsModule.stockCount => 'เริ่ม บันทึก และยืนยันรอบตรวจนับสินค้า',
    OperationsModule.members => 'ค้นหาสมาชิกและตรวจสอบคะแนนสะสม',
    OperationsModule.memberCards => 'สร้างและตรวจสอบชุดบัตรสมาชิกพร้อมใช้งาน',
    OperationsModule.customers => 'ข้อมูลลูกค้าและวงเงินเครดิต',
    OperationsModule.debts => 'ยอดค้างชำระแยกตามลูกค้า',
    OperationsModule.sales => 'ตรวจสอบบิลขาย คืนสินค้า และบิลยกเลิก',
    OperationsModule.expenses => 'ค่าใช้จ่ายของวันที่เลือก',
    OperationsModule.reports => 'ยอดขาย เงินสด และปริมาณน้ำมันของวันที่เลือก',
    OperationsModule.fuelStockReport =>
      'รับเข้า ขายออก คงเหลือ และกำไรของน้ำมันรายเดือนหรือรายปี',
    OperationsModule.tankReconciliation =>
      'เปรียบเทียบค่าวัดจริงกับยอดรับเข้าและมิเตอร์หัวจ่าย',
    OperationsModule.taxInvoices => 'ค้นหาเอกสารภาษีที่ออกแล้ว',
    OperationsModule.documents => 'แบบฟอร์มลูกค้าเครดิตสำหรับพรีวิวและพิมพ์ A4',
    OperationsModule.audit => 'ประวัติการเปลี่ยนแปลงข้อมูลสำคัญ',
    OperationsModule.security => 'เหตุการณ์และการแจ้งเตือนความปลอดภัย',
    OperationsModule.settings => 'ภาพรวมการตั้งค่าของสาขาปัจจุบัน',
  };

  IconData get icon => switch (this) {
    OperationsModule.workforce => Icons.badge_outlined,
    OperationsModule.stock => Icons.inventory_2_outlined,
    OperationsModule.stockCount => Icons.fact_check_outlined,
    OperationsModule.members => Icons.card_membership_outlined,
    OperationsModule.memberCards => Icons.badge_outlined,
    OperationsModule.customers => Icons.groups_outlined,
    OperationsModule.debts => Icons.request_quote_outlined,
    OperationsModule.sales => Icons.receipt_long_outlined,
    OperationsModule.expenses => Icons.payments_outlined,
    OperationsModule.reports => Icons.bar_chart_rounded,
    OperationsModule.fuelStockReport => Icons.oil_barrel_outlined,
    OperationsModule.tankReconciliation => Icons.speed_outlined,
    OperationsModule.taxInvoices => Icons.description_outlined,
    OperationsModule.documents => Icons.folder_outlined,
    OperationsModule.audit => Icons.fact_check_outlined,
    OperationsModule.security => Icons.security_outlined,
    OperationsModule.settings => Icons.settings_outlined,
  };

  bool get supportsDate =>
      this == OperationsModule.workforce ||
      this == OperationsModule.expenses ||
      this == OperationsModule.reports ||
      this == OperationsModule.tankReconciliation;
}

enum OperationEntity {
  none,
  staff,
  schedule,
  shiftTemplate,
  employeeProfile,
  payroll,
  tank,
  tankRefill,
  tankReading,
  product,
  stockCountSession,
  member,
  reward,
  rewardRedemption,
  memberCardBatch,
  customer,
  debt,
  sale,
  expense,
  taxInvoice,
  documentTemplate,
  audit,
  securityEvent,
  setting,
  shopProfileConfig,
  documentConfig,
  membershipConfig,
  checkoutConfig,
  perLiterPromotionConfig,
  billPromotionConfig,
  automaticBackupConfig,
  branch,
  accessGroup,
  pump,
  nozzle,
  paymentConfig,
  assistantConfig,
}

class OperationMetric {
  const OperationMetric({
    required this.label,
    required this.value,
    required this.icon,
    this.color = const Color(0xFF6554D9),
  });

  final String label;
  final String value;
  final IconData icon;
  final Color color;
}

class OperationItem {
  const OperationItem({
    required this.title,
    required this.subtitle,
    this.id,
    this.trailing,
    this.badge,
    this.fields = const <String, String>{},
    this.searchTerms = const <String>[],
    this.tank,
    this.staff,
    this.entity = OperationEntity.none,
    this.record = const <String, dynamic>{},
  });

  final Object? id;
  final String title;
  final String subtitle;
  final String? trailing;
  final String? badge;
  final Map<String, String> fields;
  final List<String> searchTerms;
  final TankLevelData? tank;
  final StaffRecordData? staff;
  final OperationEntity entity;
  final Map<String, dynamic> record;

  bool matches(String query) {
    final normalized = query.trim().toLowerCase();
    if (normalized.isEmpty) return true;
    return <String>[
      title,
      subtitle,
      trailing ?? '',
      badge ?? '',
      ...fields.values,
      ...searchTerms,
    ].any((value) => value.toLowerCase().contains(normalized));
  }
}

class StaffRecordData {
  const StaffRecordData({
    required this.id,
    required this.name,
    required this.username,
    required this.role,
    required this.active,
    this.accessGroupId,
    this.accessGroupName,
    this.branchIds = const <int>[],
    this.menuPermissions = const <String>{},
  });

  final int id;
  final String name;
  final String username;
  final String role;
  final bool active;
  final int? accessGroupId;
  final String? accessGroupName;
  final List<int> branchIds;
  final Set<String> menuPermissions;
}

class TankLevelData {
  const TankLevelData({
    required this.currentLiters,
    required this.capacityLiters,
    required this.lowAlertAt,
    required this.percent,
    required this.productName,
    required this.productCode,
    required this.isLow,
    required this.saleValue,
    required this.pricePerLiter,
  });

  final double currentLiters;
  final double capacityLiters;
  final double lowAlertAt;
  final double percent;
  final String productName;
  final String productCode;
  final bool isLow;
  final double saleValue;
  final double pricePerLiter;
}

class OperationGroup {
  const OperationGroup({required this.title, required this.items});

  final String title;
  final List<OperationItem> items;
}

class OperationsSnapshot {
  const OperationsSnapshot({
    required this.metrics,
    required this.groups,
    this.note,
  });

  final List<OperationMetric> metrics;
  final List<OperationGroup> groups;
  final String? note;

  int get itemCount => groups.fold(0, (sum, group) => sum + group.items.length);
}
