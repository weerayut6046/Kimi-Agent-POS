import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../auth/domain/staff_session.dart';
import '../data/operations_repository.dart';

Future<bool> showManualSaleSheet({
  required BuildContext context,
  required OperationsRepository repository,
  required StaffSession staff,
}) async {
  final responses = await Future.wait<Object?>([
    repository.queryProcedure(
      'catalog.listProducts',
      branchId: staff.branch.id,
    ),
    repository.queryProcedure('catalog.getSettings', branchId: staff.branch.id),
  ]);
  if (!context.mounted) return false;
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _ManualSaleSheet(
      repository: repository,
      staff: staff,
      products: _maps(
        responses[0],
      ).where((row) => row['active'] != false).toList(growable: false),
      settings: _map(responses[1]),
    ),
  );
  return saved == true;
}

class _ManualSaleSheet extends StatefulWidget {
  const _ManualSaleSheet({
    required this.repository,
    required this.staff,
    required this.products,
    required this.settings,
  });

  final OperationsRepository repository;
  final StaffSession staff;
  final List<Map<String, dynamic>> products;
  final Map<String, dynamic> settings;

  @override
  State<_ManualSaleSheet> createState() => _ManualSaleSheetState();
}

class _ManualSaleSheetState extends State<_ManualSaleSheet> {
  final _qty = TextEditingController(text: '1');
  final _discount = TextEditingController(text: '0');
  final _received = TextEditingController();
  final _memberSearch = TextEditingController();
  final _customerSearch = TextEditingController();
  final _lines = <int, double>{};
  Map<String, dynamic>? _member;
  Map<String, dynamic>? _customer;
  int? _productId;
  String _paymentMethod = 'cash';
  bool _saving = false;
  bool _searchingMember = false;
  bool _searchingCustomer = false;
  String? _error;

  List<String> get _paymentMethods => [
    for (final method in const ['cash', 'qr', 'card', 'credit', 'thungngern'])
      if (_text(widget.settings['pay_${method}_enabled'], fallback: '1') != '0')
        method,
  ];

  double get _subtotal => _lines.entries.fold(
    0,
    (sum, entry) => sum + _number(_product(entry.key)?['price']) * entry.value,
  );

  double get _discountValue => _number(_discount.text);

  double get _total => (_subtotal - _discountValue).clamp(0, double.infinity);

  Map<String, dynamic>? _product(int id) {
    for (final product in widget.products) {
      if (_int(product['id']) == id) return product;
    }
    return null;
  }

  @override
  void initState() {
    super.initState();
    if (_paymentMethods.isNotEmpty) _paymentMethod = _paymentMethods.first;
  }

  @override
  void dispose() {
    _qty.dispose();
    _discount.dispose();
    _received.dispose();
    _memberSearch.dispose();
    _customerSearch.dispose();
    super.dispose();
  }

  void _addProduct() {
    final id = _productId;
    final quantity = _number(_qty.text);
    if (id == null || quantity <= 0) {
      setState(() => _error = 'กรุณาเลือกสินค้าและระบุจำนวนมากกว่า 0');
      return;
    }
    final product = _product(id);
    if (product == null) return;
    final category = _text(product['category']);
    final stock = _number(product['stockQty']);
    final next = (_lines[id] ?? 0) + quantity;
    if (category != 'fuel' && next > stock) {
      setState(
        () => _error =
            'สต็อก ${_text(product['name'])} ไม่พอ (เหลือ ${_decimal(stock)} ${_text(product['unit'])})',
      );
      return;
    }
    setState(() {
      _lines[id] = next;
      _productId = null;
      _qty.text = '1';
      _error = null;
    });
  }

  Future<void> _findMember() async {
    final query = _memberSearch.text.trim();
    if (query.length < 3) {
      setState(() => _error = 'กรอกเบอร์โทรหรือเลขบัตรสมาชิกอย่างน้อย 3 ตัว');
      return;
    }
    setState(() {
      _searchingMember = true;
      _error = null;
    });
    try {
      final rows = _maps(
        await widget.repository.queryProcedure(
          'membership.findByPhone',
          branchId: widget.staff.branch.id,
          input: {'phone': query},
        ),
      );
      if (!mounted) return;
      final selected = await _selectRecord(
        title: 'เลือกสมาชิก',
        rows: rows,
        label: (row) => _text(row['name'], fallback: 'สมาชิก'),
        subtitle: (row) =>
            '${_text(row['memberCode'])} · ${_text(row['phone'])} · ${_int(row['points'])} แต้ม',
      );
      if (selected != null && mounted) {
        setState(() {
          _member = selected;
          _memberSearch.clear();
        });
      } else if (rows.isEmpty && mounted) {
        setState(() => _error = 'ไม่พบสมาชิก');
      }
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _searchingMember = false);
    }
  }

  Future<void> _findCustomer() async {
    final query = _customerSearch.text.trim();
    if (query.length < 2) {
      setState(() => _error = 'กรอกชื่อลูกค้าหรือทะเบียนรถอย่างน้อย 2 ตัว');
      return;
    }
    setState(() {
      _searchingCustomer = true;
      _error = null;
    });
    try {
      final rows = _maps(
        await widget.repository.queryProcedure(
          'customers.list',
          branchId: widget.staff.branch.id,
          input: {'q': query, 'limit': 30},
        ),
      );
      if (!mounted) return;
      final selected = await _selectRecord(
        title: 'เลือกลูกค้าเครดิต',
        rows: rows,
        label: (row) => _text(row['name'], fallback: 'ลูกค้า'),
        subtitle: (row) =>
            '${_text(row['phone'])} · ${_text(row['vehiclePlate'])} · วงเงิน ${_money(_number(row['creditLimit']))}',
      );
      if (selected != null && mounted) {
        setState(() {
          _customer = selected;
          _customerSearch.clear();
        });
      } else if (rows.isEmpty && mounted) {
        setState(() => _error = 'ไม่พบลูกค้า');
      }
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _searchingCustomer = false);
    }
  }

  Future<Map<String, dynamic>?> _selectRecord({
    required String title,
    required List<Map<String, dynamic>> rows,
    required String Function(Map<String, dynamic>) label,
    required String Function(Map<String, dynamic>) subtitle,
  }) {
    return showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      useSafeArea: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 8),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  title,
                  style: Theme.of(
                    context,
                  ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
                ),
              ),
            ),
            Flexible(
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: rows.length,
                itemBuilder: (context, index) => ListTile(
                  title: Text(
                    label(rows[index]),
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  subtitle: Text(subtitle(rows[index])),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => Navigator.pop(context, rows[index]),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _save() async {
    if (_lines.isEmpty) {
      setState(() => _error = 'กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ');
      return;
    }
    if (_discountValue < 0 || _discountValue > _subtotal) {
      setState(() => _error = 'ส่วนลดต้องไม่ติดลบและไม่เกินยอดขาย');
      return;
    }
    if (_paymentMethod == 'credit' && _customer == null) {
      setState(() => _error = 'ขายเชื่อต้องเลือกลูกค้าเครดิต');
      return;
    }
    final received = _received.text.trim().isEmpty
        ? _total
        : _number(_received.text);
    if (_paymentMethod == 'cash' && received < _total) {
      setState(() => _error = 'ยอดรับเงินสดน้อยกว่ายอดสุทธิ');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.repository.mutateProcedure(
        'pos.createSale',
        branchId: widget.staff.branch.id,
        input: <String, Object?>{
          'staffName': widget.staff.name,
          if (_member != null) 'memberId': _int(_member!['id']),
          if (_paymentMethod == 'credit') 'customerId': _int(_customer!['id']),
          'items': [
            for (final line in _lines.entries)
              {'productId': line.key, 'qty': _round3(line.value)},
          ],
          'discount': _round2(_discountValue),
          'paymentMethod': _paymentMethod,
          'received': _paymentMethod == 'cash' ? _round2(received) : 0,
        },
      );
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = '$error';
          _saving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.viewInsetsOf(context).bottom;
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * .94,
      ),
      decoration: const BoxDecoration(
        color: Color(0xFFF7F7FB),
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(20, 18, 12, 16),
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [Color(0xFF17152E), Color(0xFF3157A9)],
              ),
              borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
            ),
            child: Row(
              children: [
                const CircleAvatar(
                  backgroundColor: Colors.white12,
                  foregroundColor: Colors.white,
                  child: Icon(Icons.add_shopping_cart_rounded),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'BACKDATED BILL',
                        style: TextStyle(
                          color: Color(0xFFB9D5FF),
                          fontSize: 10,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 1.5,
                        ),
                      ),
                      Text(
                        'เพิ่มบิลย้อนหลัง',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 21,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: _saving ? null : () => Navigator.pop(context),
                  icon: const Icon(Icons.close_rounded, color: Colors.white),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              padding: EdgeInsets.fromLTRB(16, 16, 16, 18 + bottom),
              children: [
                _Section(
                  title: 'รายการสินค้า',
                  icon: Icons.shopping_cart_outlined,
                  child: Column(
                    children: [
                      DropdownButtonFormField<int>(
                        initialValue: _productId,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: 'สินค้า'),
                        items: [
                          for (final product in widget.products)
                            DropdownMenuItem(
                              value: _int(product['id']),
                              child: Text(
                                '${_text(product['name'])} — ${_money(_number(product['price']))}/${_text(product['unit'])}',
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                        ],
                        onChanged: (value) =>
                            setState(() => _productId = value),
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: _qty,
                              keyboardType:
                                  const TextInputType.numberWithOptions(
                                    decimal: true,
                                  ),
                              decoration: const InputDecoration(
                                labelText: 'จำนวน',
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          FilledButton.icon(
                            onPressed: _addProduct,
                            icon: const Icon(Icons.add_rounded),
                            label: const Text('เพิ่ม'),
                          ),
                        ],
                      ),
                      if (_lines.isNotEmpty) ...[
                        const SizedBox(height: 12),
                        for (final entry in _lines.entries)
                          Builder(
                            builder: (context) {
                              final product = _product(entry.key)!;
                              return ListTile(
                                contentPadding: EdgeInsets.zero,
                                title: Text(
                                  _text(product['name']),
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                subtitle: Text(
                                  '${_decimal(entry.value)} ${_text(product['unit'])} × ${_money(_number(product['price']))}',
                                ),
                                trailing: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      _money(
                                        entry.value * _number(product['price']),
                                      ),
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                    IconButton(
                                      tooltip: 'ลบรายการ',
                                      onPressed: () => setState(
                                        () => _lines.remove(entry.key),
                                      ),
                                      icon: const Icon(
                                        Icons.close_rounded,
                                        color: Color(0xFFC94B4B),
                                      ),
                                    ),
                                  ],
                                ),
                              );
                            },
                          ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                _Section(
                  title: 'สมาชิก (ไม่บังคับ)',
                  icon: Icons.card_membership_outlined,
                  child: _member == null
                      ? Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _memberSearch,
                                onSubmitted: (_) => _findMember(),
                                decoration: const InputDecoration(
                                  labelText: 'เบอร์โทร / เลขบัตร',
                                ),
                              ),
                            ),
                            IconButton(
                              onPressed: _searchingMember ? null : _findMember,
                              icon: _searchingMember
                                  ? const SizedBox.square(
                                      dimension: 20,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                      ),
                                    )
                                  : const Icon(Icons.search_rounded),
                            ),
                          ],
                        )
                      : ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(
                            child: Icon(Icons.person_outline_rounded),
                          ),
                          title: Text(
                            _text(_member!['name']),
                            style: const TextStyle(fontWeight: FontWeight.w900),
                          ),
                          subtitle: Text(
                            '${_text(_member!['memberCode'])} · ${_int(_member!['points'])} แต้ม',
                          ),
                          trailing: IconButton(
                            onPressed: () => setState(() => _member = null),
                            icon: const Icon(Icons.close_rounded),
                          ),
                        ),
                ),
                const SizedBox(height: 12),
                _Section(
                  title: 'การชำระเงิน',
                  icon: Icons.payments_outlined,
                  child: Column(
                    children: [
                      DropdownButtonFormField<String>(
                        initialValue: _paymentMethod,
                        decoration: const InputDecoration(
                          labelText: 'วิธีชำระเงิน',
                        ),
                        items: [
                          for (final method in _paymentMethods)
                            DropdownMenuItem(
                              value: method,
                              child: Text(_paymentLabel(method)),
                            ),
                        ],
                        onChanged: (value) => setState(
                          () => _paymentMethod = value ?? _paymentMethod,
                        ),
                      ),
                      if (_paymentMethod == 'credit') ...[
                        const SizedBox(height: 10),
                        if (_customer == null)
                          Row(
                            children: [
                              Expanded(
                                child: TextField(
                                  controller: _customerSearch,
                                  onSubmitted: (_) => _findCustomer(),
                                  decoration: const InputDecoration(
                                    labelText: 'ค้นหาลูกค้าเครดิต',
                                  ),
                                ),
                              ),
                              IconButton(
                                onPressed: _searchingCustomer
                                    ? null
                                    : _findCustomer,
                                icon: _searchingCustomer
                                    ? const SizedBox.square(
                                        dimension: 20,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                        ),
                                      )
                                    : const Icon(Icons.search_rounded),
                              ),
                            ],
                          )
                        else
                          ListTile(
                            contentPadding: EdgeInsets.zero,
                            leading: const CircleAvatar(
                              child: Icon(Icons.business_outlined),
                            ),
                            title: Text(
                              _text(_customer!['name']),
                              style: const TextStyle(
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            subtitle: Text(
                              'วงเงิน ${_money(_number(_customer!['creditLimit']))}',
                            ),
                            trailing: IconButton(
                              onPressed: () => setState(() => _customer = null),
                              icon: const Icon(Icons.close_rounded),
                            ),
                          ),
                      ],
                      const SizedBox(height: 10),
                      TextField(
                        controller: _discount,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        onChanged: (_) => setState(() {}),
                        decoration: const InputDecoration(
                          labelText: 'ส่วนลด (บาท)',
                        ),
                      ),
                      if (_paymentMethod == 'cash') ...[
                        const SizedBox(height: 10),
                        TextField(
                          controller: _received,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          decoration: InputDecoration(
                            labelText: 'รับเงิน (เว้นว่าง = รับพอดี)',
                            hintText: _money(_total),
                          ),
                        ),
                      ],
                      const SizedBox(height: 12),
                      _SummaryRow(label: 'ยอดขาย', value: _money(_subtotal)),
                      _SummaryRow(
                        label: 'ส่วนลด',
                        value: _money(_discountValue),
                      ),
                      _SummaryRow(
                        label: 'ยอดสุทธิ',
                        value: _money(_total),
                        emphasized: true,
                      ),
                    ],
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    _error!,
                    style: const TextStyle(
                      color: Color(0xFFC94B4B),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                FilledButton.icon(
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
                  label: Text(_saving ? 'กำลังบันทึก...' : 'บันทึกบิล'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({
    required this.title,
    required this.icon,
    required this.child,
  });

  final String title;
  final IconData icon;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE7E5EF)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, color: const Color(0xFF6554D9)),
                const SizedBox(width: 9),
                Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            child,
          ],
        ),
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({
    required this.label,
    required this.value,
    this.emphasized = false,
  });

  final String label;
  final String value;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(child: Text(label)),
          Text(
            value,
            style: TextStyle(
              fontWeight: FontWeight.w900,
              fontSize: emphasized ? 17 : 14,
              color: emphasized ? const Color(0xFF2F2478) : null,
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

String _text(Object? value, {String fallback = ''}) {
  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? fallback : text;
}

int _int(Object? value) =>
    value is num ? value.toInt() : int.tryParse(value?.toString() ?? '') ?? 0;

double _number(Object? value) => value is num
    ? value.toDouble()
    : double.tryParse(value?.toString() ?? '') ?? 0;

double _round2(double value) => (value * 100).roundToDouble() / 100;

double _round3(double value) => (value * 1000).roundToDouble() / 1000;

String _decimal(double value) =>
    NumberFormat('#,##0.###', 'th_TH').format(value);

String _money(double value) =>
    '฿${NumberFormat('#,##0.00', 'th_TH').format(value)}';

String _paymentLabel(String method) => switch (method) {
  'cash' => 'เงินสด',
  'qr' => 'QR โอนเงิน',
  'card' => 'บัตร',
  'credit' => 'ขายเชื่อ',
  'thungngern' => 'QR ถุงเงิน',
  _ => method,
};
