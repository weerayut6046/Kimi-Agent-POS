import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../shared/widgets/app_page_hero.dart';
import '../../auth/domain/staff_session.dart';
import '../application/operations_provider.dart';
import '../domain/operations_models.dart';
import 'operation_action_sheets.dart';
import 'settings_mobile_content.dart';

class _StaffBranchOption {
  const _StaffBranchOption({
    required this.id,
    required this.name,
    required this.code,
    required this.active,
  });

  final int id;
  final String name;
  final String code;
  final bool active;
}

class _StaffAccessGroupOption {
  const _StaffAccessGroupOption({
    required this.id,
    required this.name,
    required this.role,
  });

  final int id;
  final String name;
  final String role;
}

List<Map<String, dynamic>> _staffMaps(Object? value) {
  if (value is! List) return const <Map<String, dynamic>>[];
  return value
      .whereType<Map>()
      .map((row) => Map<String, dynamic>.from(row))
      .toList();
}

int _staffInt(Object? value) => switch (value) {
  final int number => number,
  final num number => number.round(),
  final String text => int.tryParse(text) ?? 0,
  _ => 0,
};

class OperationsPage extends ConsumerStatefulWidget {
  const OperationsPage({required this.module, required this.staff, super.key});

  final OperationsModule module;
  final StaffSession staff;

  @override
  ConsumerState<OperationsPage> createState() => _OperationsPageState();
}

class _OperationsPageState extends ConsumerState<OperationsPage> {
  final _searchController = TextEditingController();
  late DateTime _selectedDate;
  late Future<OperationsSnapshot> _snapshot;
  String _query = '';
  final Set<int> _deletingStaffIds = <int>{};

  bool get _canManageStaff =>
      widget.module == OperationsModule.workforce &&
      widget.staff.role == StaffRole.admin;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _selectedDate = DateTime(now.year, now.month, now.day);
    _snapshot = _load();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<OperationsSnapshot> _load() {
    return ref
        .read(operationsRepositoryProvider)
        .load(
          module: widget.module,
          branchId: widget.staff.branch.id,
          date: _selectedDate,
          role: widget.staff.role.name,
        );
  }

  Future<void> _refresh() async {
    final next = _load();
    setState(() {
      _snapshot = next;
    });
    await next;
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 365)),
      locale: const Locale('th', 'TH'),
      helpText: widget.module == OperationsModule.workforce
          ? 'เลือกวันเริ่มต้นของตารางงาน'
          : 'เลือกวันที่แสดงข้อมูล',
    );
    if (picked == null || picked == _selectedDate) return;
    setState(() {
      _selectedDate = picked;
      _snapshot = _load();
    });
  }

  Future<void> _openStaffEditor([StaffRecordData? existing]) async {
    final repository = ref.read(operationsRepositoryProvider);
    late final List<_StaffBranchOption> branches;
    late final List<_StaffAccessGroupOption> accessGroups;
    try {
      final responses = await Future.wait<Object?>([
        repository.queryProcedure(
          'auth.listAllBranches',
          branchId: widget.staff.branch.id,
        ),
        repository.queryProcedure(
          'auth.listAccessGroups',
          branchId: widget.staff.branch.id,
        ),
      ]);
      branches = _staffMaps(responses[0])
          .map(
            (row) => _StaffBranchOption(
              id: _staffInt(row['id']),
              name: '${row['name'] ?? 'สาขา'}',
              code: '${row['code'] ?? ''}',
              active: row['active'] != false,
            ),
          )
          .where((branch) => branch.id > 0 && branch.active)
          .toList();
      if (!branches.any((branch) => branch.id == widget.staff.branch.id)) {
        branches.add(
          _StaffBranchOption(
            id: widget.staff.branch.id,
            name: widget.staff.branch.name,
            code: widget.staff.branch.code,
            active: true,
          ),
        );
      }
      accessGroups = _staffMaps(responses[1])
          .map(
            (row) => _StaffAccessGroupOption(
              id: _staffInt(row['id']),
              name: '${row['name'] ?? 'กลุ่มสิทธิ์'}',
              role: '${row['role'] ?? 'cashier'}',
            ),
          )
          .where((group) => group.id > 0)
          .toList();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'โหลดข้อมูลสิทธิ์พนักงานไม่สำเร็จ: ${_staffErrorMessage(error)}',
          ),
          backgroundColor: const Color(0xFFC94B4B),
        ),
      );
      return;
    }
    if (!mounted) return;
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (context) => _StaffEditorSheet(
        existing: existing,
        currentStaffId: widget.staff.id,
        currentBranchId: widget.staff.branch.id,
        branches: branches,
        accessGroups: accessGroups,
        onSave: (value, password) async {
          if (existing == null) {
            await repository.createStaff(
              branchId: widget.staff.branch.id,
              name: value.name,
              username: value.username,
              password: password,
              role: value.role,
              accessGroupId: value.accessGroupId,
              menuPermissions: value.menuPermissions,
              branchIds: value.branchIds,
            );
          } else {
            await repository.updateStaff(
              branchId: widget.staff.branch.id,
              staff: value,
              password: password,
            );
          }
        },
      ),
    );
    if (!mounted || saved != true) return;
    await _refresh();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          existing == null ? 'เพิ่มพนักงานแล้ว' : 'แก้ไขพนักงานแล้ว',
        ),
      ),
    );
  }

  Future<void> _deleteStaff(StaffRecordData target) async {
    if (target.id == widget.staff.id) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่ได้')),
      );
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        icon: const Icon(
          Icons.delete_forever_outlined,
          color: Color(0xFFC94B4B),
        ),
        title: const Text('ยืนยันลบพนักงาน'),
        content: Text(
          'ต้องการลบ “${target.name}” (@${target.username}) หรือไม่?\n\n'
          'บัญชีและสิทธิ์เข้าใช้งานจะถูกลบถาวร หากมีประวัติเงินเดือน ระบบจะไม่อนุญาตให้ลบและควรปิดใช้งานแทน',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('ยกเลิก'),
          ),
          FilledButton.icon(
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFC94B4B),
            ),
            onPressed: () => Navigator.pop(context, true),
            icon: const Icon(Icons.delete_outline_rounded),
            label: const Text('ลบพนักงาน'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _deletingStaffIds.add(target.id));
    try {
      await ref
          .read(operationsRepositoryProvider)
          .deleteStaff(branchId: widget.staff.branch.id, staffId: target.id);
      await _refresh();
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('ลบพนักงานแล้ว')));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_staffErrorMessage(error)),
          backgroundColor: const Color(0xFFC94B4B),
        ),
      );
    } finally {
      if (mounted) setState(() => _deletingStaffIds.remove(target.id));
    }
  }

  Future<void> _openOperationCreateActions() async {
    final changed = await showOperationCreateActions(
      context: context,
      module: widget.module,
      staff: widget.staff,
      repository: ref.read(operationsRepositoryProvider),
      date: _selectedDate,
    );
    if (changed && mounted) await _refresh();
  }

  Future<void> _manageOperationItem(OperationItem item) async {
    final changed = await showOperationItemActions(
      context: context,
      item: item,
      staff: widget.staff,
      repository: ref.read(operationsRepositoryProvider),
    );
    if (changed && mounted) await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final module = widget.module;
    return Scaffold(
      appBar: AppBar(
        title: Text(module.title),
        actions: [
          if (_canManageStaff)
            IconButton(
              key: const Key('add-staff'),
              tooltip: 'เพิ่มพนักงาน',
              onPressed: _openStaffEditor,
              icon: const Icon(Icons.person_add_alt_1_rounded),
            ),
          if (module != OperationsModule.settings &&
              hasOperationCreateActions(module, widget.staff))
            IconButton(
              key: const Key('add-operation'),
              tooltip: _createActionLabel(module),
              onPressed: _openOperationCreateActions,
              icon: const Icon(Icons.add_circle_outline_rounded),
            ),
          IconButton(
            tooltip: 'รีเฟรชข้อมูล',
            onPressed: _refresh,
            icon: const Icon(Icons.refresh_rounded),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: FutureBuilder<OperationsSnapshot>(
        future: _snapshot,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting &&
              !snapshot.hasData) {
            return _StateList(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const CircularProgressIndicator(),
                  const SizedBox(height: 16),
                  Text('กำลังโหลด${module.title}…'),
                ],
              ),
            );
          }
          if (snapshot.hasError) {
            return _StateList(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.cloud_off_rounded,
                    size: 52,
                    color: Color(0xFF8A8799),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'โหลด${module.title}ไม่สำเร็จ',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 7),
                  Text(
                    '${snapshot.error}',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 18),
                  FilledButton.tonalIcon(
                    onPressed: _refresh,
                    icon: const Icon(Icons.refresh_rounded),
                    label: const Text('ลองอีกครั้ง'),
                  ),
                ],
              ),
            );
          }
          final data = snapshot.data;
          if (data == null) return const SizedBox.shrink();
          return _OperationsContent(
            module: module,
            staff: widget.staff,
            snapshot: data,
            query: _query,
            searchController: _searchController,
            selectedDate: _selectedDate,
            onQueryChanged: (value) => setState(() => _query = value),
            onPickDate: module.supportsDate ? _pickDate : null,
            onRefresh: _refresh,
            onEditStaff: _canManageStaff ? _openStaffEditor : null,
            onDeleteStaff: _canManageStaff ? _deleteStaff : null,
            onAddStaff: _canManageStaff ? _openStaffEditor : null,
            onAddOperation:
                hasOperationCreateActions(module, widget.staff) &&
                    module != OperationsModule.workforce
                ? _openOperationCreateActions
                : null,
            onManageItem: _manageOperationItem,
            deletingStaffIds: _deletingStaffIds,
          );
        },
      ),
    );
  }
}

class _OperationsContent extends StatelessWidget {
  const _OperationsContent({
    required this.module,
    required this.staff,
    required this.snapshot,
    required this.query,
    required this.searchController,
    required this.selectedDate,
    required this.onQueryChanged,
    required this.onPickDate,
    required this.onRefresh,
    required this.onEditStaff,
    required this.onDeleteStaff,
    required this.onAddStaff,
    required this.onAddOperation,
    required this.onManageItem,
    required this.deletingStaffIds,
  });

  final OperationsModule module;
  final StaffSession staff;
  final OperationsSnapshot snapshot;
  final String query;
  final TextEditingController searchController;
  final DateTime selectedDate;
  final ValueChanged<String> onQueryChanged;
  final VoidCallback? onPickDate;
  final Future<void> Function() onRefresh;
  final ValueChanged<StaffRecordData>? onEditStaff;
  final ValueChanged<StaffRecordData>? onDeleteStaff;
  final VoidCallback? onAddStaff;
  final Future<void> Function()? onAddOperation;
  final ValueChanged<OperationItem> onManageItem;
  final Set<int> deletingStaffIds;

  Widget _buildOperationCard(OperationItem item) {
    final record = item.staff;
    return _OperationCard(
      item: item,
      showStaffActions: onEditStaff != null && record != null,
      onEdit: record == null ? null : () => onEditStaff?.call(record),
      onDelete: record == null || record.id == staff.id || onDeleteStaff == null
          ? null
          : () => onDeleteStaff?.call(record),
      deleting: record != null && deletingStaffIds.contains(record.id),
      onManage: hasOperationItemActions(item, staff)
          ? () => onManageItem(item)
          : null,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (module == OperationsModule.settings) {
      return SettingsMobileContent(
        staff: staff,
        snapshot: snapshot,
        query: query,
        searchController: searchController,
        onQueryChanged: onQueryChanged,
        onRefresh: onRefresh,
        onOpenTools: onAddOperation,
        onManageItem: onManageItem,
        canManageItem: (item) => hasOperationItemActions(item, staff),
      );
    }
    final groups = [
      for (final group in snapshot.groups)
        OperationGroup(
          title: group.title,
          items: group.items.where((item) => item.matches(query)).toList(),
        ),
    ];
    final filteredCount = groups.fold<int>(
      0,
      (sum, group) => sum + group.items.length,
    );
    final moduleSubtitle =
        module == OperationsModule.workforce && staff.role != StaffRole.admin
        ? 'ข้อมูลส่วนตัว ตารางงาน และเงินเดือนของคุณ'
        : module.subtitle;

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
        children: [
          AppPageHero(
            eyebrow: module.eyebrow,
            title: module.title,
            subtitle: '$moduleSubtitle\n${staff.branch.name}',
            icon: module.icon,
            status: '${snapshot.itemCount} รายการ',
          ),
          if (onAddStaff != null) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                key: const Key('add-staff-body'),
                onPressed: onAddStaff,
                icon: const Icon(Icons.person_add_alt_1_rounded),
                label: const Text('เพิ่มพนักงาน'),
              ),
            ),
          ],
          if (onAddOperation != null) ...[
            const SizedBox(height: 9),
            SizedBox(
              width: double.infinity,
              child: FilledButton.tonalIcon(
                key: const Key('add-operation-body'),
                onPressed: onAddOperation,
                icon: const Icon(Icons.add_circle_outline_rounded),
                label: Text(_createActionLabel(module)),
              ),
            ),
          ],
          const SizedBox(height: 15),
          if (snapshot.metrics.isNotEmpty)
            _MetricsGrid(metrics: snapshot.metrics),
          if (snapshot.metrics.isNotEmpty) const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const Key('operations-search'),
                  controller: searchController,
                  onChanged: onQueryChanged,
                  decoration: InputDecoration(
                    hintText: 'ค้นหาใน${module.title}',
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
                  ),
                ),
              ),
              if (onPickDate != null) ...[
                const SizedBox(width: 9),
                _DateButton(date: selectedDate, onPressed: onPickDate!),
              ],
            ],
          ),
          if (snapshot.note case final note?) ...[
            const SizedBox(height: 11),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
              decoration: BoxDecoration(
                color: const Color(0xFFF0F7FA),
                borderRadius: BorderRadius.circular(15),
                border: Border.all(color: const Color(0xFFD9EDF0)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(
                    Icons.info_outline_rounded,
                    size: 18,
                    color: Color(0xFF0C7F8C),
                  ),
                  const SizedBox(width: 9),
                  Expanded(
                    child: Text(
                      note,
                      style: const TextStyle(
                        color: Color(0xFF38646A),
                        fontSize: 12,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 16),
          if (filteredCount == 0)
            _EmptyResult(hasQuery: query.trim().isNotEmpty)
          else
            for (final group in groups)
              if (group.items.isNotEmpty) ...[
                _GroupHeader(title: group.title, count: group.items.length),
                const SizedBox(height: 8),
                for (var index = 0; index < group.items.length; index++) ...[
                  _buildOperationCard(group.items[index]),
                  if (index != group.items.length - 1)
                    const SizedBox(height: 8),
                ],
                const SizedBox(height: 18),
              ],
        ],
      ),
    );
  }
}

class _MetricsGrid extends StatelessWidget {
  const _MetricsGrid({required this.metrics});

  final List<OperationMetric> metrics;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 720 ? 4 : 2;
        final width = (constraints.maxWidth - (columns - 1) * 9) / columns;
        return Wrap(
          spacing: 9,
          runSpacing: 9,
          children: [
            for (final metric in metrics)
              SizedBox(
                width: width,
                height: 106,
                child: _MetricCard(metric: metric),
              ),
          ],
        );
      },
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.metric});

  final OperationMetric metric;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [metric.color.withValues(alpha: 0.11), Colors.white],
        ),
        border: Border.all(color: metric.color.withValues(alpha: 0.17)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0D211B58),
            blurRadius: 18,
            offset: Offset(0, 7),
          ),
        ],
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: metric.color.withValues(alpha: 0.13),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(metric.icon, color: metric.color, size: 19),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  metric.value,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF242238),
                    fontSize: 16,
                    height: 1.1,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
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
  }
}

class _DateButton extends StatelessWidget {
  const _DateButton({required this.date, required this.onPressed});

  final DateTime date;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 56,
      child: OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 13),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.calendar_today_rounded, size: 17),
            const SizedBox(height: 2),
            Text(
              DateFormat('d MMM', 'th_TH').format(date),
              style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800),
            ),
          ],
        ),
      ),
    );
  }
}

class _GroupHeader extends StatelessWidget {
  const _GroupHeader({required this.title, required this.count});

  final String title;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w900),
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
          decoration: BoxDecoration(
            color: const Color(0xFFEDE9FE),
            borderRadius: BorderRadius.circular(99),
          ),
          child: Text(
            '$count รายการ',
            style: const TextStyle(
              color: Color(0xFF5E4FC4),
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ],
    );
  }
}

class _OperationCard extends StatelessWidget {
  const _OperationCard({
    required this.item,
    this.showStaffActions = false,
    this.onEdit,
    this.onDelete,
    this.deleting = false,
    this.onManage,
  });

  final OperationItem item;
  final bool showStaffActions;
  final VoidCallback? onEdit;
  final VoidCallback? onDelete;
  final bool deleting;
  final VoidCallback? onManage;

  @override
  Widget build(BuildContext context) {
    final tank = item.tank;
    if (tank != null) {
      return _TankOperationCard(item: item, tank: tank, onManage: onManage);
    }
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(19),
      child: InkWell(
        onTap: item.fields.isEmpty ? null : () => _showDetails(context, item),
        borderRadius: BorderRadius.circular(19),
        child: Ink(
          padding: const EdgeInsets.fromLTRB(14, 13, 13, 13),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(19),
            border: Border.all(color: const Color(0xFFE8E5F1)),
          ),
          child: Row(
            children: [
              Container(
                width: 43,
                height: 43,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFFEDE8FF), Color(0xFFE5FAFC)],
                  ),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Text(
                  item.title.trim().isEmpty
                      ? '•'
                      : item.title.trim().characters.first,
                  style: const TextStyle(
                    color: Color(0xFF6252D1),
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            item.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Color(0xFF28263B),
                              fontSize: 14,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        if (item.badge case final badge?) ...[
                          const SizedBox(width: 7),
                          _Badge(label: badge),
                        ],
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      item.subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFF777487),
                        fontSize: 11.5,
                        height: 1.35,
                      ),
                    ),
                  ],
                ),
              ),
              if (item.trailing case final trailing?) ...[
                const SizedBox(width: 10),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 105),
                  child: Text(
                    trailing,
                    maxLines: 2,
                    textAlign: TextAlign.right,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Color(0xFF403A75),
                      fontSize: 12,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ],
              if (showStaffActions) ...[
                const SizedBox(width: 3),
                if (deleting)
                  const SizedBox(
                    width: 36,
                    height: 36,
                    child: Padding(
                      padding: EdgeInsets.all(9),
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                else
                  PopupMenuButton<String>(
                    key: ValueKey('staff-actions-${item.id}'),
                    tooltip: 'จัดการพนักงาน',
                    onSelected: (value) {
                      if (value == 'edit') onEdit?.call();
                      if (value == 'delete') onDelete?.call();
                    },
                    itemBuilder: (context) => [
                      const PopupMenuItem(
                        value: 'edit',
                        child: ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(Icons.edit_outlined),
                          title: Text('แก้ไขพนักงาน'),
                        ),
                      ),
                      PopupMenuItem(
                        value: 'delete',
                        enabled: onDelete != null,
                        child: ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(
                            Icons.delete_outline_rounded,
                            color: Color(0xFFC94B4B),
                          ),
                          title: Text(
                            onDelete == null
                                ? 'ลบบัญชีตัวเองไม่ได้'
                                : 'ลบพนักงาน',
                            style: const TextStyle(color: Color(0xFFC94B4B)),
                          ),
                        ),
                      ),
                    ],
                    icon: const Icon(
                      Icons.more_vert_rounded,
                      color: Color(0xFF777487),
                    ),
                  ),
              ] else if (onManage != null) ...[
                const SizedBox(width: 3),
                IconButton(
                  key: ValueKey(
                    'operation-actions-${item.entity.name}-${item.id}',
                  ),
                  tooltip: 'จัดการรายการ',
                  onPressed: onManage,
                  icon: const Icon(
                    Icons.more_vert_rounded,
                    color: Color(0xFF777487),
                  ),
                ),
              ] else if (item.fields.isNotEmpty) ...[
                const SizedBox(width: 5),
                const Icon(
                  Icons.chevron_right_rounded,
                  color: Color(0xFFB3AFBF),
                  size: 19,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  static Future<void> _showDetails(BuildContext context, OperationItem item) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (context) => _DetailsSheet(item: item),
    );
  }
}

class _TankOperationCard extends StatelessWidget {
  const _TankOperationCard({
    required this.item,
    required this.tank,
    this.onManage,
  });

  final OperationItem item;
  final TankLevelData tank;
  final VoidCallback? onManage;

  @override
  Widget build(BuildContext context) {
    final status = tank.isLow
        ? 'ระดับต่ำ'
        : tank.percent >= 80
        ? 'เกือบเต็ม'
        : 'พร้อมใช้งาน';
    final statusColor = tank.isLow
        ? const Color(0xFFC94B4B)
        : const Color(0xFF14815B);
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(23),
        color: Colors.white,
        border: Border.all(
          color: tank.isLow ? const Color(0xFFF2B8B8) : const Color(0xFFE4E1EE),
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x14211B58),
            blurRadius: 24,
            offset: Offset(0, 10),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => _OperationCard._showDetails(context, item),
          child: Column(
            children: [
              Container(
                height: 5,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: tank.isLow
                        ? const [
                            Color(0xFFEF4444),
                            Color(0xFFFB7185),
                            Color(0xFFFB923C),
                          ]
                        : const [
                            Color(0xFF7457F0),
                            Color(0xFF5B64E8),
                            Color(0xFF22C7D5),
                          ],
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(15, 13, 15, 12),
                child: Row(
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(14),
                        gradient: tank.isLow
                            ? const LinearGradient(
                                colors: [Color(0xFFFFE7E7), Color(0xFFFFF2E8)],
                              )
                            : const LinearGradient(
                                colors: [Color(0xFFEDE8FF), Color(0xFFE5FAFC)],
                              ),
                      ),
                      child: Icon(
                        tank.isLow
                            ? Icons.warning_amber_rounded
                            : Icons.local_gas_station_rounded,
                        color: tank.isLow
                            ? const Color(0xFFD94B4B)
                            : const Color(0xFF6554D9),
                        size: 20,
                      ),
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
                            style: const TextStyle(
                              color: Color(0xFF242238),
                              fontSize: 15,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'ถัง #${item.id ?? '-'} · ${tank.productName}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Color(0xFF8A8799),
                              fontSize: 10.5,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: statusColor.withValues(alpha: 0.09),
                        borderRadius: BorderRadius.circular(99),
                        border: Border.all(
                          color: statusColor.withValues(alpha: 0.15),
                        ),
                      ),
                      child: Text(
                        status,
                        style: TextStyle(
                          color: statusColor,
                          fontSize: 9.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    if (onManage != null)
                      IconButton(
                        key: ValueKey('operation-actions-tank-${item.id}'),
                        tooltip: 'จัดการถัง',
                        onPressed: onManage,
                        icon: const Icon(Icons.more_vert_rounded),
                      ),
                  ],
                ),
              ),
              const Divider(height: 1, color: Color(0xFFF0EEF5)),
              Container(
                margin: const EdgeInsets.all(13),
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 13),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(20),
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFFFFFFFF), Color(0xFFF8F7FD)],
                  ),
                  border: Border.all(color: const Color(0xFFEAE7F1)),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x0B211B58),
                      blurRadius: 16,
                      offset: Offset(0, 7),
                    ),
                  ],
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    _TankLevelVisual(
                      key: ValueKey('tank-visual-${item.id}'),
                      percent: tank.percent,
                      productName: tank.productName,
                      productCode: tank.productCode,
                      tankName: item.title,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'น้ำมันคงเหลือ',
                            style: TextStyle(
                              color: Color(0xFF9692A3),
                              fontSize: 9.5,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.8,
                            ),
                          ),
                          const SizedBox(height: 3),
                          FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerLeft,
                            child: Text.rich(
                              TextSpan(
                                children: [
                                  TextSpan(
                                    text: _tankNumber.format(
                                      tank.currentLiters,
                                    ),
                                    style: TextStyle(
                                      color: tank.isLow
                                          ? const Color(0xFFC94B4B)
                                          : const Color(0xFF242238),
                                      fontSize: 23,
                                      fontWeight: FontWeight.w900,
                                      letterSpacing: -0.7,
                                    ),
                                  ),
                                  const TextSpan(
                                    text: ' ลิตร',
                                    style: TextStyle(
                                      color: Color(0xFF9692A3),
                                      fontSize: 10.5,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          const SizedBox(height: 11),
                          Row(
                            children: [
                              Expanded(
                                child: _TankStat(
                                  icon: Icons.speed_rounded,
                                  label: 'ความจุ',
                                  value:
                                      '${_tankNumber.format(tank.capacityLiters)} ล.',
                                  color: const Color(0xFF6554D9),
                                ),
                              ),
                              const SizedBox(width: 7),
                              Expanded(
                                child: _TankStat(
                                  icon: Icons.notifications_active_outlined,
                                  label: 'แจ้งเตือน',
                                  value:
                                      '${_tankNumber.format(tank.lowAlertAt)} ล.',
                                  color: const Color(0xFFE67E22),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 7),
                          _TankValueStat(tank: tank),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TankStat extends StatelessWidget {
  const _TankStat({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: const Color(0xFFF7F6FA),
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: const Color(0xFFEDEBF2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(height: 3),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: Color(0xFF9995A5), fontSize: 8.5),
          ),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Color(0xFF4B4858),
              fontSize: 10,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _TankValueStat extends StatelessWidget {
  const _TankValueStat({required this.tank});

  final TankLevelData tank;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFECF9F2),
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: const Color(0xFFD5F0E1)),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.payments_outlined,
            size: 14,
            color: Color(0xFF159267),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'มูลค่าราคาขาย',
                  style: TextStyle(color: Color(0xFF6B9B85), fontSize: 8.5),
                ),
                Text(
                  tank.pricePerLiter <= 0
                      ? '—'
                      : '฿${_tankMoney.format(tank.saleValue)}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF147A58),
                    fontSize: 10.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TankLevelVisual extends StatelessWidget {
  const _TankLevelVisual({
    required this.percent,
    required this.productName,
    required this.productCode,
    required this.tankName,
    super.key,
  });

  final double percent;
  final String productName;
  final String productCode;
  final String tankName;

  @override
  Widget build(BuildContext context) {
    final safePercent = percent.clamp(0, 100).toDouble();
    final tone = _fuelTone(productCode, productName, tankName);
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: safePercent),
      duration: const Duration(milliseconds: 850),
      curve: Curves.easeOutCubic,
      builder: (context, animatedPercent, _) => Semantics(
        image: true,
        label: '$productName ระดับน้ำมัน ${safePercent.round()} เปอร์เซ็นต์',
        child: SizedBox(
          width: 101,
          height: 168,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              const Positioned(left: 25, bottom: 0, child: _TankLeg()),
              const Positioned(right: 25, bottom: 0, child: _TankLeg()),
              Positioned(
                left: 5,
                right: 5,
                top: 12,
                bottom: 13,
                child: Container(
                  padding: const EdgeInsets.all(4),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(27),
                    gradient: const LinearGradient(
                      colors: [Color(0xFF4C4A65), Color(0xFF27263F)],
                    ),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x292B265A),
                        blurRadius: 20,
                        offset: Offset(0, 11),
                      ),
                    ],
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(22),
                    child: Stack(
                      children: [
                        const Positioned.fill(
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                colors: [
                                  Color(0xFFE9EAF1),
                                  Color(0xFFFFFFFF),
                                  Color(0xFFDFE1EA),
                                ],
                              ),
                            ),
                          ),
                        ),
                        Positioned.fill(
                          child: Align(
                            alignment: Alignment.bottomCenter,
                            child: FractionallySizedBox(
                              widthFactor: 1,
                              heightFactor: (animatedPercent / 100).clamp(
                                0.012,
                                1,
                              ),
                              child: DecoratedBox(
                                decoration: BoxDecoration(
                                  gradient: LinearGradient(
                                    begin: Alignment.topLeft,
                                    end: Alignment.bottomRight,
                                    colors: [
                                      tone.light,
                                      tone.color,
                                      Color.lerp(
                                            tone.color,
                                            const Color(0xFF202056),
                                            0.35,
                                          ) ??
                                          tone.color,
                                    ],
                                  ),
                                ),
                                child: const Stack(
                                  children: [
                                    Positioned(
                                      left: 18,
                                      bottom: 17,
                                      child: _TankBubble(size: 7),
                                    ),
                                    Positioned(
                                      right: 20,
                                      bottom: 44,
                                      child: _TankBubble(size: 5),
                                    ),
                                    Positioned(
                                      left: 45,
                                      bottom: 68,
                                      child: _TankBubble(size: 6),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                        for (final top in <double>[34, 68, 102])
                          Positioned(
                            top: top,
                            left: 0,
                            right: 0,
                            child: Container(
                              height: 1,
                              color: const Color(0x202D2B49),
                            ),
                          ),
                        Positioned(
                          top: 15,
                          bottom: 18,
                          left: 10,
                          child: Container(
                            width: 7,
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(99),
                              gradient: const LinearGradient(
                                colors: [Color(0x70FFFFFF), Color(0x10FFFFFF)],
                              ),
                            ),
                          ),
                        ),
                        Center(
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 7,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: const Color(0xD9FFFFFF),
                              borderRadius: BorderRadius.circular(9),
                              border: Border.all(color: Colors.white),
                              boxShadow: const [
                                BoxShadow(
                                  color: Color(0x20221F4D),
                                  blurRadius: 10,
                                  offset: Offset(0, 5),
                                ),
                              ],
                            ),
                            child: Text(
                              '${animatedPercent.round()}%',
                              style: const TextStyle(
                                color: Color(0xFF292640),
                                fontSize: 11,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              Positioned(
                left: 31,
                top: 2,
                child: Container(
                  width: 39,
                  height: 16,
                  decoration: BoxDecoration(
                    borderRadius: const BorderRadius.vertical(
                      top: Radius.circular(9),
                    ),
                    gradient: const LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Color(0xFF5D5A75), Color(0xFF29283F)],
                    ),
                    border: Border.all(color: const Color(0x50FFFFFF)),
                    boxShadow: const [
                      BoxShadow(color: Color(0x25211F49), blurRadius: 8),
                    ],
                  ),
                ),
              ),
              Positioned(
                right: -1,
                bottom: 16 + animatedPercent * 1.32,
                child: Row(
                  children: [
                    Container(
                      width: 18,
                      height: 2,
                      color: tone.color.withValues(alpha: 0.62),
                    ),
                    Container(
                      width: 12,
                      height: 12,
                      decoration: BoxDecoration(
                        color: tone.color,
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 2.5),
                        boxShadow: [
                          BoxShadow(
                            color: tone.color.withValues(alpha: 0.28),
                            blurRadius: 8,
                            spreadRadius: 3,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TankLeg extends StatelessWidget {
  const _TankLeg();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 13,
      height: 24,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(4),
        gradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFF4A4862), Color(0xFF25243B)],
        ),
      ),
    );
  }
}

class _TankBubble extends StatelessWidget {
  const _TankBubble({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: const Color(0x45FFFFFF),
        shape: BoxShape.circle,
        border: Border.all(color: const Color(0x35FFFFFF)),
      ),
    );
  }
}

class _FuelTone {
  const _FuelTone(this.color, this.light);

  final Color color;
  final Color light;
}

_FuelTone _fuelTone(String code, String productName, String tankName) {
  final fuel = '$code $productName $tankName'.toUpperCase().replaceAll(
    RegExp(r'[\s_.\-/()]'),
    '',
  );
  if (fuel.contains('GSH95') ||
      fuel.contains('GASOHOL95') ||
      fuel.contains('แก๊สโซฮอล์95') ||
      fuel.contains('แกสโซฮอล์95')) {
    return const _FuelTone(Color(0xFFF97316), Color(0xFFFDBA74));
  }
  if (fuel.contains('DB7') ||
      fuel.contains('DIESELB7') ||
      fuel.contains('ดีเซลB7') ||
      fuel.contains('B7')) {
    return const _FuelTone(Color(0xFFEAB308), Color(0xFFFDE047));
  }
  if (fuel.contains('GSH91') ||
      fuel.contains('GASOHOL91') ||
      fuel.contains('แก๊สโซฮอล์91') ||
      fuel.contains('แกสโซฮอล์91')) {
    return const _FuelTone(Color(0xFF16A34A), Color(0xFF4ADE80));
  }
  if (fuel.contains('E20')) {
    return const _FuelTone(Color(0xFF65A30D), Color(0xFFBEF264));
  }
  if (fuel.contains('E85')) {
    return const _FuelTone(Color(0xFF9333EA), Color(0xFFD8B4FE));
  }
  if (fuel.contains('B20')) {
    return const _FuelTone(Color(0xFF2563EB), Color(0xFF60A5FA));
  }
  if (fuel.contains('เบนซิน') || fuel.contains('BENZINE')) {
    return const _FuelTone(Color(0xFFDC2626), Color(0xFFFB7185));
  }
  return const _FuelTone(Color(0xFF6D5DF4), Color(0xFF22D3EE));
}

final _tankNumber = NumberFormat('#,##0.###', 'th_TH');
final _tankMoney = NumberFormat('#,##0.00', 'th_TH');

class _Badge extends StatelessWidget {
  const _Badge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final danger =
        label.contains('ยกเลิก') ||
        label.contains('วิกฤต') ||
        label.contains('ขาด') ||
        label.contains('ค้าง');
    final warning =
        label.contains('ต่ำ') ||
        label.contains('หมด') ||
        label.contains('เฝ้า') ||
        label.contains('ปิด');
    final color = danger
        ? const Color(0xFFC94B4B)
        : warning
        ? const Color(0xFFB96A00)
        : const Color(0xFF14815B);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: color,
          fontSize: 9,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _DetailsSheet extends StatelessWidget {
  const _DetailsSheet({required this.item});

  final OperationItem item;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.82,
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
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
              children: [
                Text(
                  item.title,
                  style: Theme.of(
                    context,
                  ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 5),
                Text(
                  item.subtitle,
                  style: const TextStyle(color: Color(0xFF777487)),
                ),
                const SizedBox(height: 18),
                for (final entry in item.fields.entries) ...[
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 12,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF8F7FB),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFFECEAF2)),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(
                          width: 105,
                          child: Text(
                            entry.key,
                            style: const TextStyle(
                              color: Color(0xFF777487),
                              fontSize: 11.5,
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: SelectableText(
                            entry.value,
                            style: const TextStyle(
                              color: Color(0xFF28263B),
                              fontSize: 12.5,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 7),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

const _staffPermissionLabels = <String, String>{
  'dashboard': 'ภาพรวมสถานี',
  'pos': 'ขายหน้าลาน',
  'shifts': 'จัดการกะ',
  'workforce': 'พนักงานและตารางงาน',
  'stock': 'สต็อกและถัง',
  'members': 'สมาชิก',
  'customers': 'ลูกค้าธุรกิจ',
  'debts': 'ลูกหนี้เครดิต',
  'sales': 'ประวัติการขาย',
  'reports': 'รายงาน',
  'expenses': 'ค่าใช้จ่าย',
  'tax_invoices': 'ใบกำกับภาษี',
  'documents': 'เอกสาร',
  'audit': 'บันทึกการใช้งาน',
  'security': 'ความปลอดภัย',
  'settings': 'ตั้งค่าระบบ',
};

List<String> _defaultStaffPermissions(String role) {
  return _staffPermissionLabels.keys.where((permission) {
    if (role == 'admin') return true;
    if (role == 'manager') {
      return permission != 'audit' && permission != 'security';
    }
    return permission != 'documents' &&
        permission != 'audit' &&
        permission != 'security';
  }).toList();
}

class _StaffEditorSheet extends StatefulWidget {
  const _StaffEditorSheet({
    required this.existing,
    required this.currentStaffId,
    required this.currentBranchId,
    required this.branches,
    required this.accessGroups,
    required this.onSave,
  });

  final StaffRecordData? existing;
  final int currentStaffId;
  final int currentBranchId;
  final List<_StaffBranchOption> branches;
  final List<_StaffAccessGroupOption> accessGroups;
  final Future<void> Function(StaffRecordData value, String password) onSave;

  @override
  State<_StaffEditorSheet> createState() => _StaffEditorSheetState();
}

class _StaffEditorSheetState extends State<_StaffEditorSheet> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _usernameController;
  late final TextEditingController _passwordController;
  late String _role;
  late bool _active;
  late Set<int> _branchIds;
  late Set<String> _menuPermissions;
  int? _accessGroupId;
  bool _obscurePassword = true;
  bool _saving = false;
  String? _error;

  bool get _isEditing => widget.existing != null;
  bool get _isEditingSelf => widget.existing?.id == widget.currentStaffId;

  @override
  void initState() {
    super.initState();
    final existing = widget.existing;
    _nameController = TextEditingController(text: existing?.name ?? '');
    _usernameController = TextEditingController(text: existing?.username ?? '');
    _passwordController = TextEditingController();
    _role = existing?.role ?? 'cashier';
    _active = existing?.active ?? true;
    _branchIds = (existing?.branchIds.isNotEmpty ?? false)
        ? existing!.branchIds.toSet()
        : <int>{widget.currentBranchId};
    _accessGroupId = existing?.accessGroupId;
    _menuPermissions = (existing?.menuPermissions.isNotEmpty ?? false)
        ? existing!.menuPermissions.toSet()
        : _defaultStaffPermissions(_role).toSet();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _usernameController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  String? _validateName(String? value) {
    if ((value ?? '').trim().isEmpty) return 'กรุณากรอกชื่อพนักงาน';
    return null;
  }

  String? _validateUsername(String? value) {
    final username = (value ?? '').trim().toLowerCase();
    if (!RegExp(r'^[a-z0-9][a-z0-9._-]{2,63}$').hasMatch(username)) {
      return 'ใช้ตัวอักษรอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง 3–64 ตัว';
    }
    return null;
  }

  String? _validatePassword(String? value) {
    final password = value ?? '';
    if (_isEditing && password.isEmpty) return null;
    if (password.length < 10) {
      return 'รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร';
    }
    if (password.length > 128) {
      return 'รหัสผ่านต้องไม่เกิน 128 ตัวอักษร';
    }
    if (!RegExp(r'[a-z]').hasMatch(password) ||
        !RegExp(r'[A-Z]').hasMatch(password) ||
        !RegExp(r'\d').hasMatch(password)) {
      return 'ต้องมีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ และตัวเลข';
    }
    return null;
  }

  Future<void> _submit() async {
    if (_saving || !(_formKey.currentState?.validate() ?? false)) return;
    if (_branchIds.isEmpty) {
      setState(
        () => _error = 'กรุณาเลือกสาขาที่พนักงานเข้าใช้งานได้อย่างน้อย 1 สาขา',
      );
      return;
    }
    if (_role != 'admin' &&
        _accessGroupId == null &&
        _menuPermissions.isEmpty) {
      setState(() => _error = 'กรุณาเปิดสิทธิ์อย่างน้อย 1 เมนู');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final existing = widget.existing;
    final value = StaffRecordData(
      id: existing?.id ?? 0,
      name: _nameController.text.trim(),
      username: _usernameController.text.trim().toLowerCase(),
      role: _role,
      active: _active,
      accessGroupId: _role == 'admin' ? null : _accessGroupId,
      branchIds: _branchIds.toList()..sort(),
      menuPermissions: _role == 'admin'
          ? _defaultStaffPermissions('admin').toSet()
          : _menuPermissions,
    );
    try {
      await widget.onSave(value, _passwordController.text);
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = _staffErrorMessage(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    return AnimatedPadding(
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOut,
      padding: EdgeInsets.only(bottom: keyboard),
      child: Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.92,
        ),
        decoration: const BoxDecoration(
          color: Color(0xFFF7F7FB),
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _StaffEditorHeader(isEditing: _isEditing),
            Flexible(
              child: Form(
                key: _formKey,
                child: ListView(
                  shrinkWrap: true,
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
                  children: [
                    if (_error case final error?) ...[
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFEEEE),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFFF4C5C5)),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(
                              Icons.error_outline_rounded,
                              size: 19,
                              color: Color(0xFFC94B4B),
                            ),
                            const SizedBox(width: 9),
                            Expanded(
                              child: Text(
                                error,
                                style: const TextStyle(
                                  color: Color(0xFFA73C3C),
                                  fontSize: 12,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 12),
                    ],
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: const Color(0xFFE6E3ED)),
                      ),
                      child: Column(
                        children: [
                          TextFormField(
                            key: const Key('staff-name'),
                            controller: _nameController,
                            autofocus: !_isEditing,
                            textInputAction: TextInputAction.next,
                            validator: _validateName,
                            decoration: const InputDecoration(
                              labelText: 'ชื่อ-นามสกุล',
                              prefixIcon: Icon(Icons.badge_outlined),
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextFormField(
                            key: const Key('staff-username'),
                            controller: _usernameController,
                            autocorrect: false,
                            enableSuggestions: false,
                            textCapitalization: TextCapitalization.none,
                            textInputAction: TextInputAction.next,
                            validator: _validateUsername,
                            decoration: const InputDecoration(
                              labelText: 'ชื่อผู้ใช้',
                              hintText: 'เช่น somchai01',
                              prefixIcon: Icon(Icons.alternate_email_rounded),
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextFormField(
                            key: const Key('staff-password'),
                            controller: _passwordController,
                            obscureText: _obscurePassword,
                            autocorrect: false,
                            enableSuggestions: false,
                            textInputAction: TextInputAction.done,
                            validator: _validatePassword,
                            onFieldSubmitted: (_) => _submit(),
                            decoration: InputDecoration(
                              labelText: _isEditing
                                  ? 'รหัสผ่านใหม่ (ไม่เปลี่ยนให้เว้นว่าง)'
                                  : 'รหัสผ่าน',
                              helperText:
                                  'อย่างน้อย 10 ตัว มี A–Z, a–z และตัวเลข',
                              prefixIcon: const Icon(
                                Icons.lock_outline_rounded,
                              ),
                              suffixIcon: IconButton(
                                tooltip: _obscurePassword
                                    ? 'แสดงรหัสผ่าน'
                                    : 'ซ่อนรหัสผ่าน',
                                onPressed: () => setState(
                                  () => _obscurePassword = !_obscurePassword,
                                ),
                                icon: Icon(
                                  _obscurePassword
                                      ? Icons.visibility_outlined
                                      : Icons.visibility_off_outlined,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: const Color(0xFFE6E3ED)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'สิทธิ์การใช้งาน',
                            style: TextStyle(
                              color: Color(0xFF28263B),
                              fontSize: 13,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 10),
                          DropdownButtonFormField<String>(
                            key: const Key('staff-role'),
                            initialValue: _role,
                            decoration: const InputDecoration(
                              labelText: 'ระดับผู้ใช้',
                              prefixIcon: Icon(
                                Icons.admin_panel_settings_outlined,
                              ),
                            ),
                            items: const [
                              DropdownMenuItem(
                                value: 'cashier',
                                child: Text('พนักงานขาย'),
                              ),
                              DropdownMenuItem(
                                value: 'manager',
                                child: Text('ผู้จัดการสาขา'),
                              ),
                              DropdownMenuItem(
                                value: 'admin',
                                child: Text('ผู้ดูแลระบบ'),
                              ),
                            ],
                            onChanged: _isEditingSelf
                                ? null
                                : (value) {
                                    if (value != null) {
                                      setState(() {
                                        _role = value;
                                        _accessGroupId = null;
                                        _menuPermissions =
                                            _defaultStaffPermissions(
                                              value,
                                            ).toSet();
                                      });
                                    }
                                  },
                          ),
                          if (_isEditingSelf) ...[
                            const SizedBox(height: 7),
                            const Text(
                              'ไม่สามารถเปลี่ยนระดับสิทธิ์ของบัญชีที่กำลังใช้งานจากมือถือ',
                              style: TextStyle(
                                color: Color(0xFF8A8799),
                                fontSize: 10.5,
                              ),
                            ),
                          ],
                          const SizedBox(height: 14),
                          const Align(
                            alignment: Alignment.centerLeft,
                            child: Text(
                              'สาขาที่เข้าใช้งานได้',
                              style: TextStyle(
                                fontSize: 12.5,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                          const SizedBox(height: 4),
                          ...widget.branches.map((branch) {
                            final selected = _branchIds.contains(branch.id);
                            final isCurrentSelfBranch =
                                _isEditingSelf &&
                                branch.id == widget.currentBranchId;
                            return Material(
                              color: Colors.transparent,
                              child: CheckboxListTile(
                                key: ValueKey('staff-branch-${branch.id}'),
                                contentPadding: EdgeInsets.zero,
                                dense: true,
                                controlAffinity:
                                    ListTileControlAffinity.leading,
                                value: selected,
                                onChanged: isCurrentSelfBranch
                                    ? null
                                    : (checked) {
                                        setState(() {
                                          if (checked == true) {
                                            _branchIds.add(branch.id);
                                          } else {
                                            _branchIds.remove(branch.id);
                                          }
                                        });
                                      },
                                title: Text(
                                  branch.name,
                                  style: const TextStyle(
                                    fontSize: 12.5,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                subtitle: branch.code.isEmpty
                                    ? null
                                    : Text(
                                        branch.code,
                                        style: const TextStyle(fontSize: 10.5),
                                      ),
                              ),
                            );
                          }),
                          if (_role == 'admin') ...[
                            const SizedBox(height: 8),
                            const Row(
                              children: [
                                Icon(
                                  Icons.verified_user_outlined,
                                  size: 18,
                                  color: Color(0xFF138A58),
                                ),
                                SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    'ผู้ดูแลระบบเข้าถึงทุกเมนูโดยอัตโนมัติ',
                                    style: TextStyle(
                                      fontSize: 11.5,
                                      color: Color(0xFF535064),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ] else ...[
                            const SizedBox(height: 10),
                            DropdownButtonFormField<int>(
                              key: ValueKey(
                                'staff-access-group-$_role-$_accessGroupId',
                              ),
                              initialValue:
                                  widget.accessGroups.any(
                                    (group) =>
                                        group.id == _accessGroupId &&
                                        group.role == _role,
                                  )
                                  ? _accessGroupId
                                  : 0,
                              decoration: const InputDecoration(
                                labelText: 'กลุ่มสิทธิ์',
                                prefixIcon: Icon(Icons.groups_2_outlined),
                              ),
                              items: [
                                const DropdownMenuItem(
                                  value: 0,
                                  child: Text('กำหนดรายบุคคล'),
                                ),
                                ...widget.accessGroups
                                    .where((group) => group.role == _role)
                                    .map(
                                      (group) => DropdownMenuItem(
                                        value: group.id,
                                        child: Text(group.name),
                                      ),
                                    ),
                              ],
                              onChanged: (value) => setState(
                                () =>
                                    _accessGroupId = value == 0 ? null : value,
                              ),
                            ),
                            if (_accessGroupId == null) ...[
                              const SizedBox(height: 12),
                              const Align(
                                alignment: Alignment.centerLeft,
                                child: Text(
                                  'เมนูที่อนุญาต',
                                  style: TextStyle(
                                    fontSize: 12.5,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ),
                              const SizedBox(height: 8),
                              Align(
                                alignment: Alignment.centerLeft,
                                child: Wrap(
                                  spacing: 7,
                                  runSpacing: 7,
                                  children: _defaultStaffPermissions(_role)
                                      .map(
                                        (permission) => FilterChip(
                                          key: ValueKey(
                                            'staff-permission-$permission',
                                          ),
                                          label: Text(
                                            _staffPermissionLabels[permission] ??
                                                permission,
                                          ),
                                          selected: _menuPermissions.contains(
                                            permission,
                                          ),
                                          onSelected: (selected) {
                                            setState(() {
                                              if (selected) {
                                                _menuPermissions.add(
                                                  permission,
                                                );
                                              } else {
                                                _menuPermissions.remove(
                                                  permission,
                                                );
                                              }
                                            });
                                          },
                                        ),
                                      )
                                      .toList(),
                                ),
                              ),
                            ],
                          ],
                          if (_isEditing) ...[
                            const SizedBox(height: 8),
                            Material(
                              color: Colors.transparent,
                              child: SwitchListTile.adaptive(
                                key: const Key('staff-active'),
                                contentPadding: EdgeInsets.zero,
                                value: _active,
                                onChanged: _isEditingSelf
                                    ? null
                                    : (value) =>
                                          setState(() => _active = value),
                                title: const Text(
                                  'เปิดใช้งานบัญชี',
                                  style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                subtitle: Text(
                                  _active
                                      ? 'พนักงานเข้าสู่ระบบได้ตามปกติ'
                                      : 'ระงับการเข้าสู่ระบบ แต่ยังเก็บประวัติไว้',
                                  style: const TextStyle(fontSize: 10.5),
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
              decoration: const BoxDecoration(
                color: Colors.white,
                border: Border(top: BorderSide(color: Color(0xFFE7E4ED))),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _saving
                          ? null
                          : () => Navigator.of(context).pop(false),
                      child: const Text('ยกเลิก'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    flex: 2,
                    child: FilledButton.icon(
                      key: const Key('save-staff'),
                      onPressed: _saving ? null : _submit,
                      icon: _saving
                          ? const SizedBox(
                              width: 17,
                              height: 17,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : Icon(
                              _isEditing
                                  ? Icons.save_outlined
                                  : Icons.person_add_alt_1_rounded,
                            ),
                      label: Text(
                        _saving
                            ? 'กำลังบันทึก…'
                            : (_isEditing ? 'บันทึกการแก้ไข' : 'เพิ่มพนักงาน'),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StaffEditorHeader extends StatelessWidget {
  const _StaffEditorHeader({required this.isEditing});

  final bool isEditing;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(18, 18, 12, 18),
      decoration: const BoxDecoration(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF151333), Color(0xFF25205D), Color(0xFF124554)],
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 45,
            height: 45,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(15),
              color: const Color(0x1FFFFFFF),
              border: Border.all(color: const Color(0x2EFFFFFF)),
            ),
            child: Icon(
              isEditing
                  ? Icons.manage_accounts_rounded
                  : Icons.person_add_alt_1_rounded,
              color: Colors.white,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isEditing ? 'EDIT STAFF' : 'NEW STAFF',
                  style: const TextStyle(
                    color: Color(0xFF8BE8EF),
                    fontSize: 9,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.2,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  isEditing ? 'แก้ไขพนักงาน' : 'เพิ่มพนักงาน',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 19,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  isEditing
                      ? 'แก้ไขบัญชีและสถานะการเข้าใช้งาน'
                      : 'สร้างบัญชี Supabase Auth สำหรับสาขานี้',
                  style: const TextStyle(
                    color: Color(0x99FFFFFF),
                    fontSize: 10.5,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'ปิด',
            onPressed: () => Navigator.of(context).pop(false),
            icon: const Icon(Icons.close_rounded, color: Colors.white),
          ),
        ],
      ),
    );
  }
}

String _createActionLabel(OperationsModule module) => switch (module) {
  OperationsModule.workforce => 'เพิ่มตารางงาน',
  OperationsModule.stock => 'เพิ่มสินค้า / ถัง',
  OperationsModule.stockCount => 'เริ่มรอบตรวจนับ',
  OperationsModule.members => 'เพิ่มสมาชิก / ของรางวัล',
  OperationsModule.memberCards => 'สร้างชุดบัตรสมาชิก',
  OperationsModule.customers => 'เพิ่มลูกค้าธุรกิจ',
  OperationsModule.sales => 'เพิ่มบิลย้อนหลัง',
  OperationsModule.expenses => 'บันทึกค่าใช้จ่าย',
  OperationsModule.taxInvoices => 'ออกใบกำกับภาษี',
  OperationsModule.security => 'สแกน / วิเคราะห์',
  _ => 'เพิ่มรายการ',
};

String _staffErrorMessage(Object error) {
  final message = '$error';
  if (message.contains('Username must use')) {
    return 'ชื่อผู้ใช้ต้องเป็นตัวอักษรอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง 3–64 ตัว';
  }
  if (message.contains('too_small') || message.contains('อย่างน้อย 10')) {
    return 'รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร';
  }
  if (message.contains('lowercase') ||
      message.contains('uppercase') ||
      message.contains('ตัวพิมพ์เล็ก')) {
    return 'รหัสผ่านต้องมีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ และตัวเลข';
  }
  return message;
}

class _EmptyResult extends StatelessWidget {
  const _EmptyResult({required this.hasQuery});

  final bool hasQuery;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 38),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(21),
        border: Border.all(color: const Color(0xFFE8E5F1)),
      ),
      child: Column(
        children: [
          const Icon(Icons.inbox_outlined, size: 44, color: Color(0xFFAAA6B7)),
          const SizedBox(height: 11),
          Text(
            hasQuery ? 'ไม่พบรายการที่ค้นหา' : 'ยังไม่มีข้อมูลในสาขานี้',
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}

class _StateList extends StatelessWidget {
  const _StateList({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(30),
      children: [
        SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.65,
          child: Center(child: child),
        ),
      ],
    );
  }
}
