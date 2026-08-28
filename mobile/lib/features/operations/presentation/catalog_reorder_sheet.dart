import 'package:flutter/material.dart';

import '../data/operations_repository.dart';

Future<bool> showCatalogReorderSheet({
  required BuildContext context,
  required OperationsRepository repository,
  required int branchId,
  required bool tanks,
}) async {
  final rows = _maps(
    await repository.queryProcedure(
      tanks ? 'catalog.listTanks' : 'catalog.listProducts',
      branchId: branchId,
    ),
  );
  if (!context.mounted || rows.isEmpty) return false;
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _ReorderSheet(
      repository: repository,
      branchId: branchId,
      tanks: tanks,
      initialRows: rows,
    ),
  );
  return saved == true;
}

class _ReorderSheet extends StatefulWidget {
  const _ReorderSheet({
    required this.repository,
    required this.branchId,
    required this.tanks,
    required this.initialRows,
  });

  final OperationsRepository repository;
  final int branchId;
  final bool tanks;
  final List<Map<String, dynamic>> initialRows;

  @override
  State<_ReorderSheet> createState() => _ReorderSheetState();
}

class _ReorderSheetState extends State<_ReorderSheet> {
  late final List<Map<String, dynamic>> _rows = [...widget.initialRows];
  bool _saving = false;
  String? _error;

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.repository.mutateProcedure(
        widget.tanks ? 'catalog.reorderTanks' : 'catalog.reorderProducts',
        branchId: widget.branchId,
        input: {
          widget.tanks ? 'tankIds' : 'productIds': [
            for (final row in _rows) _int(row['id']),
          ],
        },
      );
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = '$error';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: MediaQuery.sizeOf(context).height * .86,
      decoration: const BoxDecoration(
        color: Color(0xFFF8F8FC),
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 12, 12),
            child: Row(
              children: [
                CircleAvatar(
                  child: Icon(
                    widget.tanks
                        ? Icons.oil_barrel_outlined
                        : Icons.inventory_2_outlined,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.tanks ? 'จัดลำดับถังน้ำมัน' : 'จัดลำดับสินค้า',
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const Text(
                        'กดค้างที่ไอคอนด้านขวาแล้วลากเพื่อสลับตำแหน่ง',
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: _saving ? null : () => Navigator.pop(context),
                  icon: const Icon(Icons.close_rounded),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: ReorderableListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: _rows.length,
              onReorderItem: (oldIndex, newIndex) {
                setState(() {
                  final row = _rows.removeAt(oldIndex);
                  _rows.insert(newIndex, row);
                });
              },
              itemBuilder: (context, index) {
                final row = _rows[index];
                final product = _map(row['product']);
                return Card(
                  key: ValueKey('${widget.tanks}-${row['id']}'),
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    leading: CircleAvatar(child: Text('${index + 1}')),
                    title: Text(
                      _text(row['name'], fallback: 'รายการ'),
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    subtitle: Text(
                      widget.tanks
                          ? _text(
                              product['name'],
                              fallback: 'ไม่ระบุชนิดน้ำมัน',
                            )
                          : '${_text(row['code'])} · ${_text(row['category'])}',
                    ),
                    trailing: ReorderableDragStartListener(
                      index: index,
                      child: const Padding(
                        padding: EdgeInsets.all(8),
                        child: Icon(Icons.drag_handle_rounded),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 18),
              child: Text(
                _error!,
                style: const TextStyle(color: Color(0xFFC94B4B)),
              ),
            ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _saving ? null : _save,
                  icon: _saving
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.save_outlined),
                  label: Text(_saving ? 'กำลังบันทึก...' : 'บันทึกลำดับ'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

Map<String, dynamic> _map(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return const {};
}

List<Map<String, dynamic>> _maps(Object? value) {
  if (value is! List) return const [];
  return value.map(_map).where((row) => row.isNotEmpty).toList(growable: false);
}

int _int(Object? value) =>
    value is num ? value.toInt() : int.tryParse(value?.toString() ?? '') ?? 0;

String _text(Object? value, {String fallback = ''}) {
  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? fallback : text;
}
