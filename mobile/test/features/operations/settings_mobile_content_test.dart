import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pumppos/features/auth/domain/staff_session.dart';
import 'package:pumppos/features/operations/domain/operations_models.dart';
import 'package:pumppos/features/operations/presentation/settings_mobile_content.dart';

void main() {
  testWidgets('settings uses a scrollable mobile-first categorized layout', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final searchController = TextEditingController();
    addTearDown(searchController.dispose);
    OperationItem? selected;
    var toolsOpened = false;

    final shopConfig = _config(
      entity: OperationEntity.shopProfileConfig,
      title: 'ข้อมูลร้านและภาษี',
      subtitle: 'PumpPOS สาขาหลัก',
    );
    final snapshot = OperationsSnapshot(
      metrics: const [
        OperationMetric(
          label: 'พนักงาน',
          value: '5',
          icon: Icons.badge_outlined,
        ),
        OperationMetric(
          label: 'สินค้า',
          value: '33',
          icon: Icons.inventory_2_outlined,
        ),
        OperationMetric(
          label: 'ถังน้ำมัน',
          value: '6',
          icon: Icons.local_gas_station_outlined,
        ),
      ],
      groups: [
        OperationGroup(
          title: 'ข้อมูลสถานีและเอกสาร',
          items: [
            shopConfig,
            _config(
              entity: OperationEntity.documentConfig,
              title: 'เอกสารและการพิมพ์',
              subtitle: 'ใบเสร็จ 80 มม. · ใบกำกับ A4',
            ),
            _config(
              entity: OperationEntity.membershipConfig,
              title: 'สมาชิกและคะแนนสะสม',
              subtitle: '100 บาท = 1 คะแนน',
            ),
            _config(
              entity: OperationEntity.checkoutConfig,
              title: 'ช่องทางชำระเงินหน้า POS',
              subtitle: 'เงินสด · โอนจ่าย / QR',
            ),
            const OperationItem(
              title: 'โปรโมชั่นลดต่อลิตร',
              subtitle: 'ลดทันที 50 สตางค์',
              badge: 'เปิดใช้งาน',
              entity: OperationEntity.perLiterPromotionConfig,
              record: {
                'promotion_enabled': '1',
                'promotion_name': 'ลดทันที 50 สตางค์',
              },
            ),
            const OperationItem(
              title: 'โปรโมชั่นลดท้ายบิล',
              subtitle: 'เติมครบรับส่วนลด',
              badge: 'ปิดใช้งาน',
              entity: OperationEntity.billPromotionConfig,
              record: {
                'bill_promotion_enabled': '0',
                'bill_promotion_name': 'เติมครบรับส่วนลด',
              },
            ),
            _config(
              entity: OperationEntity.automaticBackupConfig,
              title: 'สำรองข้อมูลอัตโนมัติ',
              subtitle: 'เวลา 23:30 · เก็บ 7 ชุด',
            ),
          ],
        ),
        const OperationGroup(
          title: 'บริการเชื่อมต่อ',
          items: [
            OperationItem(
              title: 'การชำระเงินและถุงเงิน',
              subtitle: 'เปิดใช้งาน',
              badge: 'promptpay',
              entity: OperationEntity.paymentConfig,
            ),
            OperationItem(
              title: 'ผู้ช่วย AI',
              subtitle: 'deepseek',
              badge: 'พร้อมใช้งาน',
              entity: OperationEntity.assistantConfig,
            ),
          ],
        ),
      ],
      note: 'แตะรายการเพื่อแก้ไขการตั้งค่า',
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SettingsMobileContent(
            staff: _staff(),
            snapshot: snapshot,
            query: '',
            searchController: searchController,
            onQueryChanged: (_) {},
            onRefresh: () async {},
            onOpenTools: () async => toolsOpened = true,
            onManageItem: (item) => selected = item,
            canManageItem: (_) => true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('settings-mobile-content')), findsOneWidget);
    expect(find.text('ศูนย์ตั้งค่า'), findsOneWidget);
    expect(find.text('ข้อมูลร้านและสาขา'), findsOneWidget);

    await tester.tap(find.byKey(const Key('settings-tools')));
    expect(toolsOpened, isTrue);

    await tester.ensureVisible(find.text('ข้อมูลร้านและภาษี'));
    await tester.tap(find.text('ข้อมูลร้านและภาษี'));
    expect(selected, same(shopConfig));

    await tester.scrollUntilVisible(
      find.text('โปรโมชั่น'),
      300,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('โปรโมชั่นลดต่อลิตร'), findsOneWidget);
    expect(find.text('โปรโมชั่นลดท้ายบิล'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('บริการเชื่อมต่อ'),
      350,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('ผู้ช่วย AI'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

OperationItem _config({
  required OperationEntity entity,
  required String title,
  required String subtitle,
}) => OperationItem(title: title, subtitle: subtitle, entity: entity);

StaffSession _staff() => const StaffSession(
  id: 1,
  name: 'ผู้ดูแลระบบ',
  username: 'admin',
  role: StaffRole.admin,
  menuPermissions: {'settings'},
  branch: BranchSummary(
    id: 7,
    code: 'MAIN',
    name: 'สาขาหลัก',
    address: '',
    phone: '',
    taxId: '',
    active: true,
  ),
  branches: [],
);
