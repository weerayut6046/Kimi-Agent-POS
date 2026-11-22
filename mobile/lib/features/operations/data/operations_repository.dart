import '../../../core/network/trpc_client.dart';
import '../domain/operations_models.dart';

typedef _Row = Map<String, dynamic>;

class OperationsRepository {
  const OperationsRepository(this.client);
  final TrpcClient client;
  Future<Object?> queryProcedure(
    String procedure, {
    required int branchId,
    Object? input,
  }) => client.query(procedure, branchId: branchId, input: input);
  Future<Object?> mutateProcedure(
    String procedure, {
    required int branchId,
    Object? input,
  }) => client.mutation(procedure, branchId: branchId, input: input);
  Future<void> createStaff({
    required int branchId,
    required String name,
    required String username,
    required String password,
    required String role,
    int? accessGroupId,
    required Set<String> menuPermissions,
    required List<int> branchIds,
  }) async {
    await mutateProcedure(
      'auth.createStaff',
      branchId: branchId,
      input: {
        'name': name,
        'username': username.trim().toLowerCase(),
        'pin': password,
        'role': role,
        'accessGroupId': accessGroupId,
        'menuPermissions': menuPermissions.toList(),
        'branchIds': branchIds,
      },
    );
  }

  Future<void> updateStaff({
    required int branchId,
    required StaffRecordData staff,
    String? password,
  }) async {
    await mutateProcedure(
      'auth.updateStaff',
      branchId: branchId,
      input: {
        'id': staff.id,
        'name': staff.name,
        'username': staff.username.trim().toLowerCase(),
        'role': staff.role,
        'active': staff.active,
        'accessGroupId': staff.accessGroupId,
        'menuPermissions': staff.menuPermissions.toList(),
        'branchIds': staff.branchIds,
        if (password != null && password.isNotEmpty) 'pin': password,
      },
    );
  }

  Future<void> deleteStaff({
    required int branchId,
    required int staffId,
  }) async {
    await mutateProcedure(
      'auth.deleteStaff',
      branchId: branchId,
      input: {'id': staffId},
    );
  }

  Future<OperationsSnapshot> load({
    required OperationsModule module,
    required int branchId,
    required DateTime date,
    String role = 'cashier',
  }) async {
    final day = date.toIso8601String().substring(0, 10);
    final month = day.substring(0, 7);
    final period = {
      'startDate': '$month-01',
      'endDate': DateTime(
        date.year,
        date.month + 1,
        0,
      ).toIso8601String().substring(0, 10),
    };
    final groups = <OperationGroup>[];
    final metrics = <OperationMetric>[];
    Future<Object?> get(String proc, [Object? args]) =>
        queryProcedure(proc, branchId: branchId, input: args);
    void metric(String label, Object? value) => metrics.add(
      OperationMetric(
        label: label,
        value: (value ?? 0).toString(),
        icon: module.icon,
      ),
    );
    void group(
      String title,
      OperationEntity entity,
      Object? payload, {
      String? key,
    }) {
      final value = key != null && payload is _Row ? payload[key] : payload;
      final rows = value is List
          ? value.whereType<_Row>()
          : value is _Row && value.isNotEmpty
          ? [value]
          : <_Row>[];
      groups.add(
        OperationGroup(
          title: title,
          items: [for (final row in rows) _item(entity, row, title)],
        ),
      );
    }

    switch (module) {
      case OperationsModule.workforce:
        if (role == 'admin') {
          group(
            'พนักงาน',
            OperationEntity.staff,
            await get('auth.listStaffAccess'),
          );
          group(
            'ตารางงาน',
            OperationEntity.schedule,
            await get('workforce.scheduleList', period),
          );
          group(
            'แม่แบบกะ',
            OperationEntity.shiftTemplate,
            await get('workforce.listTemplates'),
          );
          group(
            'ข้อมูลพนักงาน',
            OperationEntity.employeeProfile,
            await get('workforce.employeeProfiles'),
          );
          group(
            'เงินเดือน',
            OperationEntity.payroll,
            await get('workforce.payrollList', {'month': month}),
          );
        } else {
          group(
            'ข้อมูลของฉัน',
            OperationEntity.staff,
            await get('workforce.myProfile'),
          );
          group(
            'ตารางงานของฉัน',
            OperationEntity.schedule,
            await get('workforce.myScheduleList', period),
          );
          group(
            'เงินเดือนของฉัน',
            OperationEntity.payroll,
            await get('workforce.myPayroll', {'month': month}),
          );
        }
      case OperationsModule.stock:
        final products = (await get('catalog.listProducts') as List)
            .cast<_Row>();
        final tanks = (await get('catalog.listTanks') as List).cast<_Row>();
        group('ถังน้ำมัน', OperationEntity.tank, [
          for (final tank in tanks)
            {
              ...tank,
              'product':
                  products
                      .where((p) => p['id'] == tank['productId'])
                      .firstOrNull ??
                  tank['product'],
            },
        ]);
        group('สินค้า', OperationEntity.product, products);
        group(
          'รับน้ำมัน',
          OperationEntity.tankRefill,
          await get('catalog.listRefills'),
        );
        group(
          'วัดถัง',
          OperationEntity.tankReading,
          await get('catalog.listTankReadings'),
        );
        metric(
          'สินค้าใช้งาน',
          products.where((r) => r['active'] == true).length,
        );
      case OperationsModule.stockCount:
        group(
          'รอบตรวจนับ',
          OperationEntity.stockCountSession,
          await get('stockCount.listSessions'),
        );
      case OperationsModule.members:
        group(
          'สมาชิก',
          OperationEntity.member,
          await get('membership.listMembers'),
        );
        group(
          'ของรางวัล',
          OperationEntity.reward,
          await get('membership.listRewards'),
        );
        group(
          'ประวัติแลก',
          OperationEntity.rewardRedemption,
          await get('membership.redemptionHistory'),
        );
      case OperationsModule.memberCards:
        group(
          'ชุดบัตรสมาชิก',
          OperationEntity.memberCardBatch,
          await get('membership.listCardBatches'),
        );
      case OperationsModule.customers:
        group('ลูกค้า', OperationEntity.customer, await get('customers.list'));
      case OperationsModule.debts:
        group('ยอดค้างชำระ', OperationEntity.debt, await get('credit.summary'));
      case OperationsModule.sales:
        group('บิลขาย', OperationEntity.sale, await get('pos.salesHistory'));
      case OperationsModule.expenses:
        final data = await get('expenses.list', {'date': day}) as _Row;
        group('ค่าใช้จ่าย', OperationEntity.expense, data, key: 'items');
        metric('ค่าใช้จ่ายรวม', data['total']);
      case OperationsModule.reports:
        final data = await get('reports.daily', {'date': day}) as _Row;
        metric('ยอดขาย POS', data['totalSales']);
        metric('จำนวนบิล', data['billCount']);
        metric('ลิตรขาย', data['totalLiters']);
        group('กะ', OperationEntity.none, data, key: 'shifts');
        group('น้ำมัน', OperationEntity.none, data, key: 'fuelSales');
      case OperationsModule.fuelStockReport:
        final data =
            await get('reports.fuelStockSummary', {
                  'view': 'monthly',
                  'year': date.year,
                })
                as _Row;
        group('ยอดรายเดือน', OperationEntity.none, data, key: 'periods');
        group(
          'คงเหลือปัจจุบัน',
          OperationEntity.none,
          data,
          key: 'currentProducts',
        );
      case OperationsModule.tankReconciliation:
        group(
          'กระทบยอดถัง',
          OperationEntity.none,
          await get('reports.tankReconciliation', {'from': day, 'to': day}),
          key: 'tanks',
        );
      case OperationsModule.taxInvoices:
        group(
          'ใบกำกับภาษี',
          OperationEntity.taxInvoice,
          await get('taxInvoice.list'),
        );
      case OperationsModule.documents:
        group('แบบฟอร์ม', OperationEntity.documentTemplate, [
          {'type': 'credit-request', 'name': 'ใบขอเปิดบัญชีเครดิต'},
          {'type': 'vehicle-fleet', 'name': 'รายการรถและเครื่องจักร'},
        ]);
      case OperationsModule.audit:
        group(
          'บันทึกการใช้งาน',
          OperationEntity.audit,
          await get('audit.list'),
          key: 'rows',
        );
      case OperationsModule.security:
        final summary = await get('security.overview') as _Row;
        metric('เหตุการณ์ใหม่ระดับร้ายแรง', summary['criticalNew']);
        group(
          'เหตุการณ์',
          OperationEntity.securityEvent,
          await get('security.events', {}),
          key: 'rows',
        );
        group(
          'รายงาน',
          OperationEntity.none,
          await get('security.reports', {'limit': 10}),
        );
      case OperationsModule.settings:
        final settings = await get('catalog.getSettings') as _Row;
        const editors = {
          OperationEntity.shopProfileConfig: 'ข้อมูลร้านและสาขา',
          OperationEntity.documentConfig: 'เอกสารและการพิมพ์',
          OperationEntity.membershipConfig: 'สมาชิกและคะแนนสะสม',
          OperationEntity.checkoutConfig: 'ช่องทางชำระเงินหน้า POS',
          OperationEntity.perLiterPromotionConfig: 'โปรโมชั่นลดราคาต่อลิตร',
          OperationEntity.billPromotionConfig: 'โปรโมชั่นลดท้ายบิล',
          OperationEntity.automaticBackupConfig: 'สำรองข้อมูลอัตโนมัติ',
        };
        groups.add(
          OperationGroup(
            title: 'ตั้งค่ากิจการ',
            items: [
              for (final e in editors.entries)
                OperationItem(
                  title: e.value,
                  subtitle: '',
                  entity: e.key,
                  record: settings,
                ),
            ],
          ),
        );
        final grouped = RegExp(
          r'^(shop_(name|branch|address|phone)$|tax_id$|vat_|receipt_|tax_invoice_|point_|pay_|backup_auto_|promotion_|bill_promotion_)',
        );
        group('ค่าอื่น', OperationEntity.setting, [
          for (final e in settings.entries)
            if (!grouped.hasMatch(e.key)) {'key': e.key, 'value': e.value},
        ]);
    }
    if (metrics.isEmpty) {
      metric(
        'จำนวนรายการ',
        groups.fold<int>(0, (sum, g) => sum + g.items.length),
      );
    }
    return OperationsSnapshot(metrics: metrics, groups: groups);
  }

  OperationItem _item(OperationEntity entity, _Row row, String label) {
    final id = row['id'] ?? row['staffId'];
    final name =
        row['name'] ??
        row['staffName'] ??
        row['receiptNo'] ??
        row['title'] ??
        row['label'] ??
        row['key'] ??
        row['action'] ??
        row['taxInvoiceNo'] ??
        row['customerName'] ??
        label;
    final fields = {
      for (final e in row.entries)
        if (e.value is String || e.value is num || e.value is bool)
          e.key: e.value.toString(),
    };
    final group = row['accessGroup'];
    final staff = entity == OperationEntity.staff && id is num
        ? StaffRecordData(
            id: id.toInt(),
            name: name.toString(),
            username: '${row['username'] ?? ''}',
            role: '${row['role'] ?? 'cashier'}',
            active: row['active'] != false,
            accessGroupId: (row['accessGroupId'] as num?)?.toInt(),
            accessGroupName: group is _Row ? group['name'] as String? : null,
            branchIds:
                (row['branchIds'] as List?)
                    ?.whereType<num>()
                    .map((x) => x.toInt())
                    .toList() ??
                [],
            menuPermissions:
                (row['menuPermissions'] as List?)
                    ?.whereType<String>()
                    .toSet() ??
                {},
          )
        : null;
    TankLevelData? tank;
    if (entity == OperationEntity.tank) {
      final product = row['product'] as _Row? ?? {};
      double n(Object? value) => double.tryParse('$value') ?? 0;
      final liters = n(row['currentLiters']),
          cap = n(row['capacityLiters']),
          alert = n(row['lowAlertAt']),
          price = n(product['price']);
      tank = TankLevelData(
        currentLiters: liters,
        capacityLiters: cap,
        lowAlertAt: alert,
        percent: cap > 0 ? liters * 100 / cap : 0,
        productName: '${product['name'] ?? ''}',
        productCode: '${product['code'] ?? ''}',
        isLow: liters <= alert,
        saleValue: liters * price,
        pricePerLiter: price,
      );
    }
    return OperationItem(
      entity: entity,
      id: id,
      title: '$name',
      subtitle:
          tank?.productName ??
          '${row['username'] ?? row['code'] ?? row['status'] ?? row['date'] ?? ''}',
      trailing: (row['total'] ?? row['outstanding'] ?? row['amount'])
          ?.toString(),
      record: row,
      staff: staff,
      tank: tank,
      fields: fields,
    );
  }
}
