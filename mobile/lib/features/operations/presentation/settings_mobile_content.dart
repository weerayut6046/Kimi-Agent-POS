import 'package:flutter/material.dart';

import '../../auth/domain/staff_session.dart';
import '../domain/operations_models.dart';

class SettingsMobileContent extends StatelessWidget {
  const SettingsMobileContent({
    required this.staff,
    required this.snapshot,
    required this.query,
    required this.searchController,
    required this.onQueryChanged,
    required this.onRefresh,
    required this.onManageItem,
    required this.canManageItem,
    this.onOpenTools,
    super.key,
  });

  final StaffSession staff;
  final OperationsSnapshot snapshot;
  final String query;
  final TextEditingController searchController;
  final ValueChanged<String> onQueryChanged;
  final Future<void> Function() onRefresh;
  final ValueChanged<OperationItem> onManageItem;
  final bool Function(OperationItem) canManageItem;
  final Future<void> Function()? onOpenTools;

  @override
  Widget build(BuildContext context) {
    final sections = _sections(snapshot, query);
    final visibleItems = sections.fold<int>(
      0,
      (total, section) => total + section.items.length,
    );

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        key: const Key('settings-mobile-content'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 32),
        children: [
          _SettingsHero(staff: staff),
          const SizedBox(height: 12),
          if (snapshot.metrics.isNotEmpty)
            _SettingsMetrics(metrics: snapshot.metrics),
          if (snapshot.metrics.isNotEmpty) const SizedBox(height: 12),
          if (onOpenTools != null) ...[
            _ToolsButton(
              admin: staff.role == StaffRole.admin,
              onPressed: onOpenTools!,
            ),
            const SizedBox(height: 12),
          ],
          TextField(
            key: const Key('settings-search'),
            controller: searchController,
            onChanged: onQueryChanged,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'ค้นหาการตั้งค่า',
              prefixIcon: const Icon(Icons.search_rounded),
              suffixIcon: query.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'ล้างคำค้น',
                      onPressed: () {
                        searchController.clear();
                        onQueryChanged('');
                      },
                      icon: const Icon(Icons.close_rounded),
                    ),
              filled: true,
              fillColor: Colors.white,
            ),
          ),
          if (snapshot.note case final note?) ...[
            const SizedBox(height: 10),
            _SettingsNotice(text: note),
          ],
          const SizedBox(height: 18),
          if (visibleItems == 0)
            _EmptySettings(query: query)
          else
            for (final section in sections)
              if (section.items.isNotEmpty) ...[
                _SettingsSection(
                  section: section,
                  onTap: onManageItem,
                  canManageItem: canManageItem,
                ),
                const SizedBox(height: 16),
              ],
          const _SecurityFooter(),
        ],
      ),
    );
  }
}

class _SettingsHero extends StatelessWidget {
  const _SettingsHero({required this.staff});

  final StaffSession staff;

  @override
  Widget build(BuildContext context) {
    final roleLabel = switch (staff.role) {
      StaffRole.admin => 'ผู้ดูแลระบบ',
      StaffRole.manager => 'ผู้จัดการ',
      StaffRole.cashier => 'พนักงานขาย',
    };
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(26),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF17133D), Color(0xFF2E286D), Color(0xFF0B5566)],
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x28211B58),
            blurRadius: 24,
            offset: Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(17),
                  gradient: const LinearGradient(
                    colors: [Color(0xFF7868FF), Color(0xFF22BBD0)],
                  ),
                ),
                child: const Icon(
                  Icons.tune_rounded,
                  color: Colors.white,
                  size: 27,
                ),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'ศูนย์ตั้งค่า',
                      style: Theme.of(context).textTheme.headlineSmall
                          ?.copyWith(
                            color: Colors.white,
                            fontWeight: FontWeight.w900,
                          ),
                    ),
                    const Text(
                      'จัดการระบบจากหน้าจอเดียว',
                      style: TextStyle(color: Color(0xFFC9C4E5)),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 17),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
            decoration: BoxDecoration(
              color: const Color(0x16FFFFFF),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0x24FFFFFF)),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.storefront_outlined,
                  color: Color(0xFF76E5EA),
                  size: 21,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        staff.branch.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      Text(
                        '${staff.branch.code} · $roleLabel',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFFBBB6D5),
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(
                  Icons.verified_user_outlined,
                  color: Color(0xFF65DDAE),
                  size: 20,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SettingsMetrics extends StatelessWidget {
  const _SettingsMetrics({required this.metrics});

  final List<OperationMetric> metrics;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 82,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: metrics.length,
        separatorBuilder: (_, _) => const SizedBox(width: 9),
        itemBuilder: (context, index) {
          final metric = metrics[index];
          return Container(
            width: 132,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(19),
              border: Border.all(color: metric.color.withValues(alpha: 0.16)),
            ),
            child: Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: metric.color.withValues(alpha: 0.11),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(metric.icon, color: metric.color, size: 19),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        metric.value,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      Text(
                        metric.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFF777487),
                          fontSize: 10.5,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _ToolsButton extends StatefulWidget {
  const _ToolsButton({required this.admin, required this.onPressed});

  final bool admin;
  final Future<void> Function() onPressed;

  @override
  State<_ToolsButton> createState() => _ToolsButtonState();
}

class _ToolsButtonState extends State<_ToolsButton> {
  bool _busy = false;

  Future<void> _open() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await widget.onPressed();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFECE9FF),
      borderRadius: BorderRadius.circular(19),
      child: InkWell(
        key: const Key('settings-tools'),
        onTap: _busy ? null : _open,
        borderRadius: BorderRadius.circular(19),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 14),
          child: Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: const Color(0xFF6554D9),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: _busy
                    ? const Padding(
                        padding: EdgeInsets.all(11),
                        child: CircularProgressIndicator(
                          color: Colors.white,
                          strokeWidth: 2.4,
                        ),
                      )
                    : const Icon(Icons.add_rounded, color: Colors.white),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _busy
                          ? 'กำลังโหลดเครื่องมือ…'
                          : widget.admin
                          ? 'เครื่องมือผู้ดูแลระบบ'
                          : 'โปรโมชั่นและการขาย',
                      style: const TextStyle(fontWeight: FontWeight.w900),
                    ),
                    Text(
                      widget.admin
                          ? 'เพิ่มสาขา อุปกรณ์ โลโก้ และจัดการข้อมูล'
                          : 'ตั้งค่าโปรโมชั่นที่ใช้ในสาขานี้',
                      style: const TextStyle(
                        color: Color(0xFF686478),
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: Color(0xFF6554D9)),
            ],
          ),
        ),
      ),
    );
  }
}

class _SettingsNotice extends StatelessWidget {
  const _SettingsNotice({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFF1F8F9),
        borderRadius: BorderRadius.circular(15),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.info_outline_rounded,
            color: Color(0xFF0C7F8C),
            size: 18,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(color: Color(0xFF38646A), fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}

class _SettingsSection extends StatelessWidget {
  const _SettingsSection({
    required this.section,
    required this.onTap,
    required this.canManageItem,
  });

  final _SettingsSectionData section;
  final ValueChanged<OperationItem> onTap;
  final bool Function(OperationItem) canManageItem;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, right: 4, bottom: 8),
          child: Row(
            children: [
              Icon(section.icon, color: section.color, size: 19),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  section.title,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: section.color.withValues(alpha: 0.09),
                  borderRadius: BorderRadius.circular(99),
                ),
                child: Text(
                  '${section.items.length}',
                  style: TextStyle(
                    color: section.color,
                    fontSize: 11,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
        ),
        Material(
          color: Colors.white,
          borderRadius: BorderRadius.circular(21),
          clipBehavior: Clip.antiAlias,
          child: DecoratedBox(
            decoration: BoxDecoration(
              border: Border.all(color: const Color(0xFFE9E7EF)),
              borderRadius: BorderRadius.circular(21),
            ),
            child: Column(
              children: [
                for (var index = 0; index < section.items.length; index++) ...[
                  _SettingsTile(
                    item: section.items[index],
                    section: section,
                    manageable: canManageItem(section.items[index]),
                    onTap: () => onTap(section.items[index]),
                  ),
                  if (index != section.items.length - 1)
                    const Divider(height: 1, indent: 66),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _SettingsTile extends StatelessWidget {
  const _SettingsTile({
    required this.item,
    required this.section,
    required this.manageable,
    required this.onTap,
  });

  final OperationItem item;
  final _SettingsSectionData section;
  final bool manageable;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: manageable ? onTap : null,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(13, 12, 10, 12),
        child: Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: section.color.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(_itemIcon(item), color: section.color, size: 21),
            ),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  if (item.subtitle.trim().isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      item.subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF777487),
                        fontSize: 12,
                        height: 1.25,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            if (item.badge case final badge?)
              Container(
                constraints: const BoxConstraints(maxWidth: 88),
                margin: const EdgeInsets.only(left: 7),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                decoration: BoxDecoration(
                  color: _badgeColor(badge).withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(99),
                ),
                child: Text(
                  badge,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: _badgeColor(badge),
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            const SizedBox(width: 4),
            Icon(
              manageable
                  ? Icons.chevron_right_rounded
                  : Icons.lock_outline_rounded,
              color: const Color(0xFFAAA7B4),
              size: manageable ? 22 : 16,
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptySettings extends StatelessWidget {
  const _EmptySettings({required this.query});

  final String query;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 18),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 34),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        children: [
          const Icon(
            Icons.manage_search_rounded,
            size: 42,
            color: Color(0xFF8D899D),
          ),
          const SizedBox(height: 9),
          Text(
            query.trim().isEmpty
                ? 'ยังไม่มีข้อมูลตั้งค่า'
                : 'ไม่พบ “${query.trim()}”',
            textAlign: TextAlign.center,
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}

class _SecurityFooter extends StatelessWidget {
  const _SecurityFooter();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.fromLTRB(10, 4, 10, 0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.shield_outlined, size: 15, color: Color(0xFF8A8799)),
          SizedBox(width: 6),
          Flexible(
            child: Text(
              'ค่าระบบถูกจำกัดตามสิทธิ์และสาขาที่กำลังใช้งาน',
              textAlign: TextAlign.center,
              style: TextStyle(color: Color(0xFF8A8799), fontSize: 11),
            ),
          ),
        ],
      ),
    );
  }
}

class _SettingsSectionData {
  const _SettingsSectionData({
    required this.title,
    required this.icon,
    required this.color,
    required this.items,
  });

  final String title;
  final IconData icon;
  final Color color;
  final List<OperationItem> items;
}

List<_SettingsSectionData> _sections(
  OperationsSnapshot snapshot,
  String query,
) {
  final baseSettings = snapshot.groups
      .expand((group) => group.items)
      .where(_isSettingsItem)
      .toList();

  final sections = <_SettingsSectionData>[
    _entitySection(
      'ข้อมูลร้านและสาขา',
      Icons.storefront_outlined,
      const Color(0xFF6554D9),
      baseSettings,
      const {OperationEntity.shopProfileConfig},
    ),
    _entitySection(
      'เอกสาร ภาษี และการพิมพ์',
      Icons.receipt_long_outlined,
      const Color(0xFF0C91A1),
      baseSettings,
      const {OperationEntity.documentConfig},
    ),
    _entitySection(
      'สมาชิกและคะแนน',
      Icons.card_membership_outlined,
      const Color(0xFFE67E22),
      baseSettings,
      const {OperationEntity.membershipConfig},
    ),
    _entitySection(
      'ช่องทางชำระเงิน',
      Icons.account_balance_wallet_outlined,
      const Color(0xFF138A58),
      baseSettings,
      const {OperationEntity.checkoutConfig},
    ),
    _entitySection(
      'โปรโมชั่น',
      Icons.local_offer_outlined,
      const Color(0xFFD95E8A),
      baseSettings,
      const {
        OperationEntity.perLiterPromotionConfig,
        OperationEntity.billPromotionConfig,
      },
    ),
    _entitySection(
      'การสำรองข้อมูล',
      Icons.cloud_sync_outlined,
      const Color(0xFF5574C9),
      baseSettings,
      const {OperationEntity.automaticBackupConfig},
    ),
  ];

  final categorized = sections.expand((section) => section.items).toSet();
  final remaining = baseSettings
      .where((item) => !categorized.contains(item))
      .toList();
  if (remaining.isNotEmpty) {
    sections.add(
      _SettingsSectionData(
        title: 'การตั้งค่าอื่น',
        icon: Icons.tune_outlined,
        color: const Color(0xFF7A758E),
        items: remaining,
      ),
    );
  }

  for (final group in snapshot.groups) {
    final items = group.items.where((item) => !_isSettingsItem(item)).toList();
    if (items.isEmpty) continue;
    final style = _groupStyle(group.title);
    sections.add(
      _SettingsSectionData(
        title: group.title,
        icon: style.$1,
        color: style.$2,
        items: items,
      ),
    );
  }

  final trimmedQuery = query.trim();
  if (trimmedQuery.isEmpty) return sections;
  return [
    for (final section in sections)
      _SettingsSectionData(
        title: section.title,
        icon: section.icon,
        color: section.color,
        items: section.items
            .where((item) => item.matches(trimmedQuery))
            .toList(),
      ),
  ];
}

_SettingsSectionData _entitySection(
  String title,
  IconData icon,
  Color color,
  List<OperationItem> items,
  Set<OperationEntity> entities,
) => _SettingsSectionData(
  title: title,
  icon: icon,
  color: color,
  items: items.where((item) => entities.contains(item.entity)).toList(),
);

(IconData, Color) _groupStyle(String title) => switch (title) {
  'สาขา' => (Icons.business_outlined, const Color(0xFF6554D9)),
  'กลุ่มสิทธิ์' => (
    Icons.admin_panel_settings_outlined,
    const Color(0xFF9B5BC4),
  ),
  'ตู้และหัวจ่าย' => (
    Icons.local_gas_station_outlined,
    const Color(0xFFE67E22),
  ),
  'บริการเชื่อมต่อ' => (Icons.hub_outlined, const Color(0xFF0C91A1)),
  _ => (Icons.settings_suggest_outlined, const Color(0xFF6554D9)),
};

IconData _itemIcon(OperationItem item) => switch (item.entity) {
  OperationEntity.shopProfileConfig => Icons.storefront_outlined,
  OperationEntity.documentConfig => Icons.receipt_long_outlined,
  OperationEntity.membershipConfig => Icons.stars_outlined,
  OperationEntity.checkoutConfig => Icons.account_balance_wallet_outlined,
  OperationEntity.perLiterPromotionConfig => Icons.local_offer_outlined,
  OperationEntity.billPromotionConfig => Icons.discount_outlined,
  OperationEntity.automaticBackupConfig => Icons.cloud_sync_outlined,
  OperationEntity.branch => Icons.store_outlined,
  OperationEntity.accessGroup => Icons.shield_outlined,
  OperationEntity.pump => Icons.local_gas_station_outlined,
  OperationEntity.nozzle => Icons.gas_meter_outlined,
  OperationEntity.paymentConfig => Icons.qr_code_rounded,
  OperationEntity.assistantConfig => Icons.auto_awesome_rounded,
  _ => _settingIcon('${item.record['key']}'),
};

bool _isSettingsItem(OperationItem item) =>
    item.entity == OperationEntity.setting ||
    item.entity == OperationEntity.shopProfileConfig ||
    item.entity == OperationEntity.documentConfig ||
    item.entity == OperationEntity.membershipConfig ||
    item.entity == OperationEntity.checkoutConfig ||
    item.entity == OperationEntity.perLiterPromotionConfig ||
    item.entity == OperationEntity.billPromotionConfig ||
    item.entity == OperationEntity.automaticBackupConfig;

IconData _settingIcon(String key) {
  if (key.contains('phone')) return Icons.phone_outlined;
  if (key.contains('address')) return Icons.location_on_outlined;
  if (key.contains('paper') || key.contains('receipt')) {
    return Icons.print_outlined;
  }
  if (key.contains('tax') || key.contains('vat')) return Icons.percent_rounded;
  if (key.contains('point')) return Icons.stars_outlined;
  if (key.startsWith('pay_')) return Icons.payments_outlined;
  if (key.contains('promotion')) return Icons.discount_outlined;
  if (key.contains('backup')) return Icons.cloud_outlined;
  return Icons.tune_rounded;
}

Color _badgeColor(String badge) {
  final text = badge.toLowerCase();
  if (text.contains('เปิด') || text.contains('พร้อม')) {
    return const Color(0xFF138A58);
  }
  if (text.contains('ปิด') || text.contains('ยังไม่')) {
    return const Color(0xFFC25B32);
  }
  return const Color(0xFF6554D9);
}
