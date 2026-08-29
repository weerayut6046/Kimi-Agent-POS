import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/realtime/branch_realtime.dart';
import '../../../shared/widgets/app_page_hero.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/staff_session.dart';
import '../../dashboard/presentation/dashboard_page.dart';
import '../../operations/application/operations_provider.dart';
import '../../operations/domain/operations_models.dart';
import '../../operations/presentation/operations_page.dart';
import '../../pos/presentation/pos_page.dart';
import '../../shifts/presentation/shift_page.dart';
import 'assistant_chat_sheet.dart';

class AppShell extends ConsumerStatefulWidget {
  const AppShell({required this.staff, super.key});

  final StaffSession staff;

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  int _selectedIndex = 0;

  List<_Destination> get _destinations {
    final destinations = <_Destination>[];
    if (widget.staff.can('dashboard')) {
      destinations.add(
        _Destination(
          label: 'ภาพรวม',
          icon: Icons.space_dashboard_outlined,
          selectedIcon: Icons.space_dashboard_rounded,
          page: DashboardPage(staff: widget.staff),
        ),
      );
    }
    if (widget.staff.can('pos')) {
      destinations.add(
        _Destination(
          label: 'ขาย',
          icon: Icons.point_of_sale_outlined,
          selectedIcon: Icons.point_of_sale_rounded,
          page: PosPage(staff: widget.staff),
        ),
      );
    }
    if (widget.staff.can('shifts')) {
      destinations.add(
        _Destination(
          label: 'กะงาน',
          icon: Icons.schedule_outlined,
          selectedIcon: Icons.schedule_rounded,
          page: ShiftPage(staff: widget.staff),
        ),
      );
    }
    destinations.add(
      _Destination(
        label: 'เพิ่มเติม',
        icon: Icons.grid_view_outlined,
        selectedIcon: Icons.grid_view_rounded,
        page: MorePage(staff: widget.staff),
      ),
    );
    return destinations;
  }

  void _navigateFromAssistant(String path) {
    final primaryLabel = switch (path) {
      '/' => 'ภาพรวม',
      '/pos' => 'ขาย',
      '/shifts' => 'กะงาน',
      _ => null,
    };
    if (primaryLabel != null) {
      final index = _destinations.indexWhere(
        (destination) => destination.label == primaryLabel,
      );
      if (index >= 0) setState(() => _selectedIndex = index);
      return;
    }
    final module = switch (path) {
      '/workforce' => OperationsModule.workforce,
      '/stock' => OperationsModule.stock,
      '/stock-count' => OperationsModule.stockCount,
      '/members' => OperationsModule.members,
      '/member-card-batches' => OperationsModule.memberCards,
      '/customers' => OperationsModule.customers,
      '/debts' => OperationsModule.debts,
      '/sales' => OperationsModule.sales,
      '/expenses' => OperationsModule.expenses,
      '/reports' => OperationsModule.reports,
      '/fuel-stock-report' => OperationsModule.fuelStockReport,
      '/tank-reconciliation' => OperationsModule.tankReconciliation,
      '/tax-invoices' => OperationsModule.taxInvoices,
      '/documents' => OperationsModule.documents,
      '/audit' => OperationsModule.audit,
      '/security' => OperationsModule.security,
      '/settings' => OperationsModule.settings,
      _ => null,
    };
    if (module == null || !widget.staff.can(module.permission)) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('ไม่สามารถเปิดหน้านี้ได้')));
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => OperationsPage(module: module, staff: widget.staff),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Keep one branch-scoped Realtime channel alive for the authenticated app.
    ref.watch(branchRealtimeRevisionProvider(widget.staff.branch.id));
    final destinations = _destinations;
    final selectedIndex = _selectedIndex.clamp(0, destinations.length - 1);

    return Scaffold(
      appBar: AppBar(
        toolbarHeight: 72,
        titleSpacing: 14,
        elevation: 0,
        flexibleSpace: const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [Color(0xFF141436), Color(0xFF211D58), Color(0xFF123E50)],
            ),
            boxShadow: [
              BoxShadow(
                color: Color(0x33211958),
                blurRadius: 28,
                offset: Offset(0, 12),
              ),
            ],
          ),
        ),
        title: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(13),
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    Color(0xFF7BE2E7),
                    Color(0xFF7457F0),
                    Color(0xFF4D48C8),
                  ],
                ),
                border: Border.all(color: const Color(0x3DFFFFFF)),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x35000000),
                    blurRadius: 16,
                    offset: Offset(0, 7),
                  ),
                ],
              ),
              child: const Icon(
                Icons.water_drop_rounded,
                color: Colors.white,
                size: 21,
              ),
            ),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'PumpPOS',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
                      letterSpacing: -0.35,
                    ),
                  ),
                  Text(
                    widget.staff.branch.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Color(0xA6FFFFFF),
                      fontSize: 11.5,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          PopupMenuButton<String>(
            tooltip: widget.staff.name,
            onSelected: (value) {
              if (value == 'logout') {
                ref.read(authControllerProvider.notifier).signOut();
              }
            },
            itemBuilder: (context) => [
              PopupMenuItem<String>(
                enabled: false,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.staff.name,
                      style: const TextStyle(
                        color: Color(0xFF18182E),
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      '${widget.staff.role.name} · ${widget.staff.branch.code}',
                      style: const TextStyle(fontSize: 11.5),
                    ),
                  ],
                ),
              ),
              const PopupMenuDivider(),
              const PopupMenuItem<String>(
                value: 'logout',
                child: ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.logout_rounded),
                  title: Text('ออกจากระบบ'),
                ),
              ),
            ],
            icon: Container(
              width: 39,
              height: 39,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(13),
                gradient: const LinearGradient(
                  colors: [Color(0x407C63F2), Color(0x2422C7D5)],
                ),
                border: Border.all(color: const Color(0x24FFFFFF)),
              ),
              child: Text(
                _initials(widget.staff.name),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: IndexedStack(
        index: selectedIndex,
        children: destinations.map((item) => item.page).toList(),
      ),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('assistant-chat-button'),
        onPressed: () => showAssistantChatSheet(
          context: context,
          staff: widget.staff,
          repository: ref.read(operationsRepositoryProvider),
          onNavigate: _navigateFromAssistant,
        ),
        icon: const Icon(Icons.auto_awesome_rounded),
        label: const Text('ผู้ช่วย AI'),
      ),
      floatingActionButtonLocation: FloatingActionButtonLocation.endFloat,
      bottomNavigationBar: _BottomDock(
        destinations: destinations,
        selectedIndex: selectedIndex,
        onSelected: (index) {
          setState(() => _selectedIndex = index);
        },
      ),
    );
  }

  static String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return 'P';
    return parts.take(2).map((part) => part.characters.first).join();
  }
}

class _Destination {
  const _Destination({
    required this.label,
    required this.icon,
    required this.selectedIcon,
    required this.page,
  });

  final String label;
  final IconData icon;
  final IconData selectedIcon;
  final Widget page;
}

class _BottomDock extends StatelessWidget {
  const _BottomDock({
    required this.destinations,
    required this.selectedIndex,
    required this.onSelected,
  });

  final List<_Destination> destinations;
  final int selectedIndex;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: Color(0xF7FFFFFF),
        border: Border(top: BorderSide(color: Color(0xFFECEAF3))),
        boxShadow: [
          BoxShadow(
            color: Color(0x1A211B58),
            blurRadius: 28,
            offset: Offset(0, -8),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        minimum: const EdgeInsets.fromLTRB(8, 8, 8, 7),
        child: Row(
          children: [
            for (var index = 0; index < destinations.length; index++)
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 2),
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: () => onSelected(index),
                      borderRadius: BorderRadius.circular(18),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 220),
                        curve: Curves.easeOutCubic,
                        height: 58,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(18),
                          gradient: selectedIndex == index
                              ? const LinearGradient(
                                  begin: Alignment.topLeft,
                                  end: Alignment.bottomRight,
                                  colors: [
                                    Color(0xFF7557F0),
                                    Color(0xFF5B52D9),
                                  ],
                                )
                              : null,
                          boxShadow: selectedIndex == index
                              ? const [
                                  BoxShadow(
                                    color: Color(0x356656E8),
                                    blurRadius: 16,
                                    offset: Offset(0, 7),
                                  ),
                                ]
                              : null,
                        ),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              selectedIndex == index
                                  ? destinations[index].selectedIcon
                                  : destinations[index].icon,
                              color: selectedIndex == index
                                  ? Colors.white
                                  : const Color(0xFF737188),
                              size: 22,
                            ),
                            const SizedBox(height: 3),
                            Text(
                              destinations[index].label,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: selectedIndex == index
                                    ? Colors.white
                                    : const Color(0xFF737188),
                                fontSize: 10.5,
                                fontWeight: selectedIndex == index
                                    ? FontWeight.w800
                                    : FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class MorePage extends StatelessWidget {
  const MorePage({required this.staff, super.key});

  final StaffSession staff;

  static const _items = <_MoreItem>[
    _MoreItem(OperationsModule.workforce),
    _MoreItem(OperationsModule.stock),
    _MoreItem(OperationsModule.stockCount),
    _MoreItem(OperationsModule.members),
    _MoreItem(OperationsModule.memberCards),
    _MoreItem(OperationsModule.customers),
    _MoreItem(OperationsModule.debts),
    _MoreItem(OperationsModule.sales),
    _MoreItem(OperationsModule.expenses),
    _MoreItem(OperationsModule.reports),
    _MoreItem(OperationsModule.fuelStockReport),
    _MoreItem(OperationsModule.tankReconciliation),
    _MoreItem(OperationsModule.taxInvoices),
    _MoreItem(OperationsModule.documents),
    _MoreItem(OperationsModule.audit),
    _MoreItem(OperationsModule.security),
    _MoreItem(OperationsModule.settings),
  ];

  @override
  Widget build(BuildContext context) {
    final allowedItems = _items
        .where(
          (item) => staff.can(item.permission) && item.isVisibleFor(staff.role),
        )
        .toList();

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
      children: [
        AppPageHero(
          eyebrow: 'Workspace',
          title: 'เมนูเพิ่มเติม',
          subtitle: 'สิทธิ์ ${staff.role.name} · ${staff.branch.code}',
          icon: Icons.grid_view_rounded,
          status: '${allowedItems.length} เมนู',
        ),
        const SizedBox(height: 16),
        if (allowedItems.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(22),
              child: Text('บัญชีนี้ไม่มีสิทธิ์เข้าถึงเมนูเพิ่มเติม'),
            ),
          )
        else
          LayoutBuilder(
            builder: (context, constraints) {
              final columns = constraints.maxWidth >= 760 ? 3 : 2;
              return GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: allowedItems.length,
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: columns,
                  crossAxisSpacing: 11,
                  mainAxisSpacing: 11,
                  childAspectRatio: columns == 2 ? 1.12 : 1.3,
                ),
                itemBuilder: (context, index) {
                  final item = allowedItems[index];
                  return _MoreMenuCard(
                    key: ValueKey('more-${item.module.name}'),
                    item: item,
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (context) =>
                              OperationsPage(module: item.module, staff: staff),
                        ),
                      );
                    },
                  );
                },
              );
            },
          ),
      ],
    );
  }
}

class _MoreMenuCard extends StatelessWidget {
  const _MoreMenuCard({required this.item, required this.onTap, super.key});

  final _MoreItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(21),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Colors.white, Color(0xFFF7F5FF)],
        ),
        border: Border.all(color: const Color(0xFFE7E2F5)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0D211B58),
            blurRadius: 20,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(21),
          child: Padding(
            padding: const EdgeInsets.all(15),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 41,
                      height: 41,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(14),
                        gradient: const LinearGradient(
                          colors: [Color(0xFFEDE8FF), Color(0xFFE5FAFC)],
                        ),
                      ),
                      child: Icon(
                        item.icon,
                        color: const Color(0xFF6554D9),
                        size: 21,
                      ),
                    ),
                    const Spacer(),
                    const Icon(
                      Icons.arrow_outward_rounded,
                      color: Color(0xFFAAA6B7),
                      size: 18,
                    ),
                  ],
                ),
                const Spacer(),
                Text(
                  item.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF242238),
                    fontSize: 15,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                const Text(
                  'ข้อมูลจริงจากสาขาปัจจุบัน',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: Color(0xFF8A8799), fontSize: 10.5),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MoreItem {
  const _MoreItem(this.module);

  final OperationsModule module;

  String get permission => module.permission;
  String get label => module.title;
  IconData get icon => module.icon;

  bool isVisibleFor(StaffRole role) => switch (module) {
    OperationsModule.audit ||
    OperationsModule.security => role == StaffRole.admin,
    OperationsModule.memberCards ||
    OperationsModule.documents ||
    OperationsModule.fuelStockReport ||
    OperationsModule.tankReconciliation => role != StaffRole.cashier,
    _ => true,
  };
}
