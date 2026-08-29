import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../../shared/widgets/app_page_hero.dart';
import '../../auth/domain/staff_session.dart';
import '../../dashboard/application/dashboard_provider.dart';
import '../../shifts/application/shift_provider.dart';
import '../application/pos_provider.dart';
import '../domain/pos_cart.dart';
import '../domain/pos_models.dart';
import '../domain/promotion.dart';

class PosPage extends ConsumerStatefulWidget {
  const PosPage({required this.staff, super.key});

  final StaffSession staff;

  @override
  ConsumerState<PosPage> createState() => _PosPageState();
}

class _PosPageState extends ConsumerState<PosPage> {
  PosCart _cart = const PosCart();
  ProductCategory _category = ProductCategory.fuel;
  String _search = '';

  @override
  Widget build(BuildContext context) {
    final provider = posBootstrapProvider(widget.staff.branch.id);
    final bootstrap = ref.watch(provider);

    return bootstrap.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) =>
          _LoadError(error: error, onRetry: () => ref.invalidate(provider)),
      data: (data) {
        final products = data.products.where((product) {
          final search = _search.trim().toLowerCase();
          return product.active &&
              product.category == _category &&
              (search.isEmpty ||
                  product.name.toLowerCase().contains(search) ||
                  product.code.toLowerCase().contains(search));
        }).toList();
        final stockIssue = _cart.stockIssue(data.products);

        return LayoutBuilder(
          builder: (context, constraints) {
            final wide = constraints.maxWidth >= 940;
            final catalog = _CatalogPane(
              bootstrap: data,
              products: products,
              category: _category,
              search: _search,
              cart: _cart,
              bottomPadding: wide || _cart.isEmpty ? 18 : 92,
              onRefresh: () => ref.refresh(provider.future),
              onCategoryChanged: (value) => setState(() => _category = value),
              onSearchChanged: (value) => setState(() => _search = value),
              onSearchSubmitted: (value) => _searchBarcode(data, value),
              onProductTap: (product) => _addProduct(data, product),
            );
            if (wide) {
              return Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(child: catalog),
                  SizedBox(
                    width: 390,
                    child: _CartPanel(
                      cart: _cart,
                      settings: data.settings,
                      stockIssue: stockIssue,
                      onQuantityChanged: _setQuantity,
                      onRemove: _remove,
                      onCheckout: () => _checkout(data),
                    ),
                  ),
                ],
              );
            }

            return Stack(
              children: [
                catalog,
                if (!_cart.isEmpty)
                  Positioned(
                    left: 14,
                    right: 14,
                    bottom: 12,
                    child: _MobileCartButton(
                      itemCount: _cart.lineCount,
                      total: _money(_cart.subtotal),
                      onPressed: () => _openMobileCart(data),
                    ),
                  ),
              ],
            );
          },
        );
      },
    );
  }

  Future<void> _addProduct(PosBootstrap bootstrap, PosProduct product) async {
    if (bootstrap.currentShift == null) {
      _message('กรุณาเปิดกะก่อนเริ่มการขาย');
      return;
    }
    try {
      var quantity = 1.0;
      if (product.isFuel) {
        final result = await showDialog<double>(
          context: context,
          builder: (context) => _FuelAmountDialog(product: product),
        );
        if (result == null || !mounted) return;
        quantity = result;
      }
      setState(() => _cart = _cart.add(product, quantity));
    } on PosCartException catch (error) {
      _message(error.message);
    }
  }

  void _setQuantity(int productId, double quantity) {
    try {
      setState(() => _cart = _cart.setQuantity(productId, quantity));
    } on PosCartException catch (error) {
      _message(error.message);
    }
  }

  void _remove(int productId) {
    setState(() => _cart = _cart.remove(productId));
  }

  Future<void> _searchBarcode(PosBootstrap bootstrap, String rawValue) async {
    final code = rawValue.trim();
    if (code.length < 3) return;
    final local = bootstrap.products
        .where((product) => product.code.toLowerCase() == code.toLowerCase())
        .firstOrNull;
    if (local != null) {
      setState(() => _category = local.category);
      await _addProduct(bootstrap, local);
      return;
    }
    if (!RegExp(r'^\d{8,14}$').hasMatch(code)) {
      _message('บาร์โค้ดสำหรับค้นหาออนไลน์ต้องเป็นตัวเลข 8–14 หลัก');
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('กำลังค้นหาสินค้าจาก Open Facts...')),
    );
    try {
      final repository = ref.read(posRepositoryProvider);
      final external = await repository.searchExternalProduct(
        branchId: widget.staff.branch.id,
        barcode: code,
      );
      if (!mounted) return;
      if (external == null) {
        _message('ไม่พบสินค้านี้ในฐาน Open Facts');
        return;
      }
      final imported = await showDialog<PosProduct>(
        context: context,
        barrierDismissible: false,
        builder: (context) => _ExternalProductDialog(
          barcode: code,
          external: external,
          branchId: widget.staff.branch.id,
        ),
      );
      if (imported == null || !mounted) return;
      setState(() {
        _category = imported.category;
        _search = '';
        if (bootstrap.currentShift != null) {
          _cart = _cart.add(imported, 1);
        }
      });
      ref.invalidate(posBootstrapProvider(widget.staff.branch.id));
      _message(
        bootstrap.currentShift == null
            ? 'นำเข้าสินค้าแล้ว กรุณาเปิดกะก่อนขาย'
            : 'นำเข้าสินค้าและเพิ่มลงตะกร้าแล้ว',
      );
    } catch (error) {
      _message('$error');
    }
  }

  Future<void> _openMobileCart(PosBootstrap bootstrap) async {
    final provider = posBootstrapProvider(widget.staff.branch.id);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) => Consumer(
        builder: (context, ref, _) {
          final liveBootstrap = ref.watch(provider).value ?? bootstrap;
          return FractionallySizedBox(
            heightFactor: 0.88,
            child: StatefulBuilder(
              builder: (context, setSheetState) => _CartPanel(
                cart: _cart,
                settings: liveBootstrap.settings,
                stockIssue: _cart.stockIssue(liveBootstrap.products),
                onQuantityChanged: (id, quantity) {
                  _setQuantity(id, quantity);
                  setSheetState(() {});
                },
                onRemove: (id) {
                  _remove(id);
                  setSheetState(() {});
                  if (_cart.isEmpty) Navigator.pop(context);
                },
                onCheckout: () async {
                  Navigator.pop(context);
                  await _checkout(liveBootstrap);
                },
              ),
            ),
          );
        },
      ),
    );
  }

  Future<void> _checkout(PosBootstrap bootstrap) async {
    if (_cart.isEmpty) return;
    if (bootstrap.currentShift == null) {
      _message('กรุณาเปิดกะก่อนชำระเงิน');
      return;
    }
    final stockIssue = _cart.stockIssue(bootstrap.products);
    if (stockIssue != null) {
      _message(stockIssue);
      return;
    }

    final receipt = await showDialog<SaleReceipt>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _CheckoutDialog(
        staff: widget.staff,
        bootstrap: bootstrap,
        cart: _cart,
      ),
    );
    if (receipt == null || !mounted) return;

    setState(() => _cart = const PosCart());
    ref.invalidate(posBootstrapProvider(widget.staff.branch.id));
    ref.invalidate(shiftBootstrapProvider(widget.staff.branch.id));
    ref.invalidate(dashboardProvider(widget.staff.branch.id));
    await showDialog<void>(
      context: context,
      builder: (context) => _ReceiptDialog(receipt: receipt),
    );
  }

  void _message(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }
}

class _CatalogPane extends StatelessWidget {
  const _CatalogPane({
    required this.bootstrap,
    required this.products,
    required this.category,
    required this.search,
    required this.cart,
    required this.bottomPadding,
    required this.onRefresh,
    required this.onCategoryChanged,
    required this.onSearchChanged,
    required this.onSearchSubmitted,
    required this.onProductTap,
  });

  final PosBootstrap bootstrap;
  final List<PosProduct> products;
  final ProductCategory category;
  final String search;
  final PosCart cart;
  final double bottomPadding;
  final Future<void> Function() onRefresh;
  final ValueChanged<ProductCategory> onCategoryChanged;
  final ValueChanged<String> onSearchChanged;
  final ValueChanged<String> onSearchSubmitted;
  final ValueChanged<PosProduct> onProductTap;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.fromLTRB(16, 16, 16, bottomPadding),
        children: [
          AppPageHero(
            eyebrow: 'Point of sale',
            title: 'หน้าขาย',
            subtitle: bootstrap.currentShift == null
                ? 'เปิดกะก่อนเริ่มทำรายการขาย'
                : 'กะ #${bootstrap.currentShift!.id} · ${bootstrap.currentShift!.staffName}',
            icon: Icons.point_of_sale_rounded,
            status: bootstrap.currentShift == null
                ? 'ยังไม่เปิดกะ'
                : 'พร้อมขาย',
            statusColor: bootstrap.currentShift == null
                ? const Color(0xFFFBBF24)
                : const Color(0xFF6EE7B7),
            child: Row(
              children: [
                Expanded(
                  child: AppHeroStat(
                    label: 'สินค้าในตะกร้า',
                    value: '${cart.lineCount} รายการ',
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: AppHeroStat(
                    label: 'ยอดรวม',
                    value: _money(cart.subtotal),
                  ),
                ),
              ],
            ),
          ),
          if (bootstrap.currentShift == null) ...[
            const SizedBox(height: 12),
            const _NoShiftBanner(),
          ],
          const SizedBox(height: 14),
          TextField(
            onChanged: onSearchChanged,
            onSubmitted: onSearchSubmitted,
            textInputAction: TextInputAction.search,
            decoration: const InputDecoration(
              hintText: 'ค้นหาชื่อ รหัส หรือยิงบาร์โค้ดแล้วกด Enter',
              prefixIcon: Icon(Icons.search_rounded),
            ),
          ),
          const SizedBox(height: 12),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: SegmentedButton<ProductCategory>(
              segments: [
                for (final item in ProductCategory.values)
                  ButtonSegment(
                    value: item,
                    label: Text(item.label),
                    icon: Icon(_categoryIcon(item)),
                  ),
              ],
              selected: {category},
              onSelectionChanged: (value) => onCategoryChanged(value.first),
            ),
          ),
          const SizedBox(height: 14),
          if (products.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 60),
              child: Center(child: Text('ไม่พบสินค้าในหมวดนี้')),
            )
          else
            LayoutBuilder(
              builder: (context, constraints) {
                final columns = switch (constraints.maxWidth) {
                  >= 1000 => 4,
                  >= 620 => 3,
                  _ => 2,
                };
                return GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: products.length,
                  gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: columns,
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                    childAspectRatio: columns == 2 ? 0.88 : 0.98,
                  ),
                  itemBuilder: (context, index) => _ProductCard(
                    product: products[index],
                    onTap: () => onProductTap(products[index]),
                  ),
                );
              },
            ),
        ],
      ),
    );
  }
}

class _ProductCard extends StatelessWidget {
  const _ProductCard({required this.product, required this.onTap});

  final PosProduct product;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = _productColor(product);
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(21),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Colors.white, color.withValues(alpha: 0.055)],
        ),
        border: Border.all(color: color.withValues(alpha: 0.15)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0D211B58),
            blurRadius: 20,
            offset: Offset(0, 8),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: product.canSell ? onTap : null,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(height: 7, color: color),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(13),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        CircleAvatar(
                          radius: 20,
                          backgroundColor: color.withValues(alpha: 0.12),
                          foregroundColor: color,
                          child: Icon(
                            product.isFuel
                                ? Icons.local_gas_station_rounded
                                : Icons.inventory_2_rounded,
                          ),
                        ),
                        const Spacer(),
                        DecoratedBox(
                          decoration: BoxDecoration(
                            color: const Color(0xFFF2F0F8),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 7,
                              vertical: 4,
                            ),
                            child: Text(
                              product.code,
                              maxLines: 1,
                              style: Theme.of(context).textTheme.labelSmall,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Text(
                      product.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    const Spacer(),
                    Text(
                      '${_money(product.price)} / ${product.unit}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: color,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    if (!product.isFuel)
                      Text(
                        product.stockQty > 0
                            ? 'คงเหลือ ${_quantity(product.stockQty)} ${product.unit}'
                            : 'สินค้าหมด',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: product.stockQty > 0
                              ? Colors.black54
                              : const Color(0xFFB42318),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MobileCartButton extends StatelessWidget {
  const _MobileCartButton({
    required this.itemCount,
    required this.total,
    required this.onPressed,
  });

  final int itemCount;
  final String total;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 60,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(19),
        gradient: const LinearGradient(
          colors: [Color(0xFF7658F1), Color(0xFF5A51D8), Color(0xFF19B9CB)],
        ),
        border: Border.all(color: const Color(0x3DFFFFFF)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x4A4C3BB5),
            blurRadius: 28,
            offset: Offset(0, 13),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(19),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 17),
            child: Row(
              children: [
                Badge(
                  label: Text('$itemCount'),
                  backgroundColor: const Color(0xFFFF8A65),
                  child: const Icon(
                    Icons.shopping_cart_rounded,
                    color: Colors.white,
                    size: 23,
                  ),
                ),
                const SizedBox(width: 13),
                const Text(
                  'ดูตะกร้า',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const Spacer(),
                Text(
                  total,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(width: 5),
                const Icon(
                  Icons.chevron_right_rounded,
                  color: Color(0xCCFFFFFF),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CartPanel extends StatelessWidget {
  const _CartPanel({
    required this.cart,
    required this.settings,
    required this.stockIssue,
    required this.onQuantityChanged,
    required this.onRemove,
    required this.onCheckout,
  });

  final PosCart cart;
  final Map<String, String> settings;
  final String? stockIssue;
  final void Function(int productId, double quantity) onQuantityChanged;
  final ValueChanged<int> onRemove;
  final VoidCallback onCheckout;

  @override
  Widget build(BuildContext context) {
    final promotion = PromotionSummary.calculate(settings, cart);
    final total = (cart.subtotal - promotion.discount).clamp(0, cart.subtotal);

    return ColoredBox(
      color: Colors.white,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const Icon(Icons.shopping_cart_rounded),
                const SizedBox(width: 9),
                Text(
                  'ตะกร้าปัจจุบัน',
                  style: Theme.of(
                    context,
                  ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Expanded(
              child: cart.isEmpty
                  ? const Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.shopping_basket_outlined,
                            size: 54,
                            color: Colors.black26,
                          ),
                          SizedBox(height: 10),
                          Text('แตะสินค้าเพื่อเพิ่มลงตะกร้า'),
                        ],
                      ),
                    )
                  : ListView.separated(
                      itemCount: cart.lines.length,
                      separatorBuilder: (_, _) => const Divider(height: 20),
                      itemBuilder: (context, index) {
                        final line = cart.lines[index];
                        return _CartLineTile(
                          line: line,
                          onQuantityChanged: (quantity) =>
                              onQuantityChanged(line.product.id, quantity),
                          onRemove: () => onRemove(line.product.id),
                        );
                      },
                    ),
            ),
            if (stockIssue != null) ...[
              const SizedBox(height: 8),
              _InlineError(message: stockIssue!),
            ],
            if (promotion.labels.isNotEmpty) ...[
              const SizedBox(height: 8),
              for (final label in promotion.labels)
                Padding(
                  padding: const EdgeInsets.only(bottom: 3),
                  child: Text(
                    label,
                    style: const TextStyle(
                      color: Color(0xFF138A58),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
            ],
            const Divider(height: 22),
            _TotalLine(label: 'ยอดก่อนส่วนลด', value: _money(cart.subtotal)),
            if (promotion.discount > 0)
              _TotalLine(
                label: 'ส่วนลดโปรโมชั่น',
                value: '−${_money(promotion.discount)}',
              ),
            const SizedBox(height: 7),
            _TotalLine(
              label: 'ยอดชำระ',
              value: _money(total.toDouble()),
              emphasized: true,
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: cart.isEmpty || stockIssue != null ? null : onCheckout,
              icon: const Icon(Icons.payment_rounded),
              label: const Padding(
                padding: EdgeInsets.symmetric(vertical: 13),
                child: Text('ชำระเงิน'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CartLineTile extends StatelessWidget {
  const _CartLineTile({
    required this.line,
    required this.onQuantityChanged,
    required this.onRemove,
  });

  final CartLine line;
  final ValueChanged<double> onQuantityChanged;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final step = 1.0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                line.product.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
            IconButton(
              tooltip: 'นำออก',
              visualDensity: VisualDensity.compact,
              onPressed: onRemove,
              icon: const Icon(Icons.delete_outline_rounded),
            ),
          ],
        ),
        Text(
          '${_money(line.product.price)} / ${line.product.unit}',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 7),
        Row(
          children: [
            IconButton.filledTonal(
              visualDensity: VisualDensity.compact,
              onPressed: () => onQuantityChanged(line.quantity - step),
              icon: const Icon(Icons.remove_rounded),
            ),
            Expanded(
              child: Text(
                '${_quantity(line.quantity)} ${line.product.unit}',
                textAlign: TextAlign.center,
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
            IconButton.filledTonal(
              visualDensity: VisualDensity.compact,
              onPressed: () => onQuantityChanged(line.quantity + step),
              icon: const Icon(Icons.add_rounded),
            ),
            const SizedBox(width: 9),
            Text(
              _money(line.amount),
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
          ],
        ),
      ],
    );
  }
}

class _FuelAmountDialog extends StatefulWidget {
  const _FuelAmountDialog({required this.product});

  final PosProduct product;

  @override
  State<_FuelAmountDialog> createState() => _FuelAmountDialogState();
}

class _FuelAmountDialogState extends State<_FuelAmountDialog> {
  final _value = TextEditingController();
  bool _byAmount = true;

  @override
  void dispose() {
    _value.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final entered = double.tryParse(_value.text) ?? 0;
    final liters = _byAmount && widget.product.price > 0
        ? entered / widget.product.price
        : entered;
    final total = _byAmount ? entered : entered * widget.product.price;

    return AlertDialog(
      title: Text(widget.product.name),
      content: SingleChildScrollView(
        child: SizedBox(
          width: 360,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('ราคา ${_money(widget.product.price)} ต่อลิตร'),
              const SizedBox(height: 14),
              SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(value: true, label: Text('ระบุเป็นบาท')),
                  ButtonSegment(value: false, label: Text('ระบุเป็นลิตร')),
                ],
                selected: {_byAmount},
                onSelectionChanged: (value) {
                  setState(() {
                    _byAmount = value.first;
                    _value.clear();
                  });
                },
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _value,
                autofocus: true,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: _byAmount ? 'จำนวนเงิน (บาท)' : 'ปริมาณ (ลิตร)',
                  prefixIcon: Icon(
                    _byAmount
                        ? Icons.payments_outlined
                        : Icons.water_drop_outlined,
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Text(
                entered > 0
                    ? '${_quantity(liters)} ลิตร · ${_money(total)}'
                    : 'กรอกจำนวนที่ต้องการ',
                textAlign: TextAlign.center,
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('ยกเลิก'),
        ),
        FilledButton(
          onPressed: entered > 0 && liters.isFinite
              ? () => Navigator.pop(context, liters)
              : null,
          child: const Text('เพิ่มลงตะกร้า'),
        ),
      ],
    );
  }
}

class _ExternalProductDialog extends ConsumerStatefulWidget {
  const _ExternalProductDialog({
    required this.barcode,
    required this.external,
    required this.branchId,
  });

  final String barcode;
  final Map<String, dynamic> external;
  final int branchId;

  @override
  ConsumerState<_ExternalProductDialog> createState() =>
      _ExternalProductDialogState();
}

class _ExternalProductDialogState
    extends ConsumerState<_ExternalProductDialog> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  final _unit = TextEditingController(text: 'ชิ้น');
  final _price = TextEditingController();
  final _cost = TextEditingController(text: '0');
  final _stock = TextEditingController(text: '1');
  final _lowStock = TextEditingController(text: '0');
  ProductCategory _category = ProductCategory.other;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: _externalText('name'));
  }

  String _externalText(String key) =>
      widget.external[key]?.toString().trim() ?? '';

  @override
  void dispose() {
    _name.dispose();
    _unit.dispose();
    _price.dispose();
    _cost.dispose();
    _stock.dispose();
    _lowStock.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final product = await ref
          .read(posRepositoryProvider)
          .importExternalProduct(
            branchId: widget.branchId,
            barcode: widget.barcode,
            name: _name.text,
            category: _category,
            unit: _unit.text,
            price: double.parse(_price.text.trim()),
            cost: double.tryParse(_cost.text.trim()) ?? 0,
            stockQty: double.parse(_stock.text.trim()),
            lowStockAt: double.tryParse(_lowStock.text.trim()) ?? 0,
            imageUrl: _externalText('imageUrl').isEmpty
                ? null
                : _externalText('imageUrl'),
          );
      if (mounted) Navigator.pop(context, product);
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
    final imageUrl = _externalText('imageUrl');
    return AlertDialog(
      title: const Text('นำเข้าสินค้าจากฐานภายนอก'),
      content: SingleChildScrollView(
        child: SizedBox(
          width: 470,
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (imageUrl.isNotEmpty)
                  Center(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(14),
                      child: Image.network(
                        imageUrl,
                        width: 110,
                        height: 110,
                        fit: BoxFit.contain,
                        errorBuilder: (_, _, _) => const SizedBox.shrink(),
                      ),
                    ),
                  ),
                Text(
                  'บาร์โค้ด ${widget.barcode} · ${_externalText('providerLabel')}',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                if (_externalText('brand').isNotEmpty ||
                    _externalText('quantity').isNotEmpty)
                  Text(
                    [
                      _externalText('brand'),
                      _externalText('quantity'),
                    ].where((value) => value.isNotEmpty).join(' · '),
                    textAlign: TextAlign.center,
                  ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _name,
                  decoration: const InputDecoration(
                    labelText: 'ชื่อสินค้า *',
                    prefixIcon: Icon(Icons.inventory_2_outlined),
                  ),
                  validator: (value) => value == null || value.trim().isEmpty
                      ? 'กรุณากรอกชื่อสินค้า'
                      : null,
                ),
                const SizedBox(height: 9),
                DropdownButtonFormField<ProductCategory>(
                  initialValue: _category,
                  decoration: const InputDecoration(
                    labelText: 'หมวดสินค้า',
                    prefixIcon: Icon(Icons.category_outlined),
                  ),
                  items: const [
                    DropdownMenuItem(
                      value: ProductCategory.other,
                      child: Text('สินค้าอื่น'),
                    ),
                    DropdownMenuItem(
                      value: ProductCategory.lubricant,
                      child: Text('น้ำมันเครื่อง'),
                    ),
                  ],
                  onChanged: _busy
                      ? null
                      : (value) => setState(
                          () => _category = value ?? ProductCategory.other,
                        ),
                ),
                const SizedBox(height: 9),
                TextFormField(
                  controller: _unit,
                  decoration: const InputDecoration(
                    labelText: 'หน่วย *',
                    prefixIcon: Icon(Icons.straighten_outlined),
                  ),
                  validator: (value) => value == null || value.trim().isEmpty
                      ? 'กรุณากรอกหน่วย'
                      : null,
                ),
                const SizedBox(height: 9),
                Row(
                  children: [
                    Expanded(
                      child: _ExternalNumberField(
                        controller: _price,
                        label: 'ราคาขาย *',
                        min: .01,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _ExternalNumberField(
                        controller: _cost,
                        label: 'ต้นทุน',
                        min: 0,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 9),
                Row(
                  children: [
                    Expanded(
                      child: _ExternalNumberField(
                        controller: _stock,
                        label: 'สต๊อกเริ่มต้น *',
                        min: 1,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _ExternalNumberField(
                        controller: _lowStock,
                        label: 'แจ้งเตือนเมื่อเหลือ',
                        min: 0,
                      ),
                    ),
                  ],
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  _InlineError(message: _error!),
                ],
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.pop(context),
          child: const Text('ยกเลิก'),
        ),
        FilledButton.icon(
          onPressed: _busy ? null : _save,
          icon: _busy
              ? const SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.download_done_rounded),
          label: Text(_busy ? 'กำลังนำเข้า...' : 'นำเข้าและเพิ่มลงบิล'),
        ),
      ],
    );
  }
}

class _ExternalNumberField extends StatelessWidget {
  const _ExternalNumberField({
    required this.controller,
    required this.label,
    required this.min,
  });

  final TextEditingController controller;
  final String label;
  final double min;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      decoration: InputDecoration(labelText: label),
      validator: (value) {
        final parsed = double.tryParse(value?.trim() ?? '');
        return parsed == null || parsed < min ? 'ต้องไม่น้อยกว่า $min' : null;
      },
    );
  }
}

class _CheckoutDialog extends ConsumerStatefulWidget {
  const _CheckoutDialog({
    required this.staff,
    required this.bootstrap,
    required this.cart,
  });

  final StaffSession staff;
  final PosBootstrap bootstrap;
  final PosCart cart;

  @override
  ConsumerState<_CheckoutDialog> createState() => _CheckoutDialogState();
}

class _CheckoutDialogState extends ConsumerState<_CheckoutDialog> {
  final _received = TextEditingController();
  final _memberQuery = TextEditingController();
  final _customerQuery = TextEditingController();
  final _points = TextEditingController(text: '0');
  PaymentMethod? _paymentMethod;
  Future<PromptPayQr>? _qrRequest;
  PosMember? _member;
  PosCustomer? _customer;
  Map<String, dynamic>? _creditDetail;
  List<PosMember> _memberResults = const [];
  List<PosCustomer> _customerResults = const [];
  String? _loyaltyChoice;
  bool _searchingMember = false;
  bool _searchingCustomer = false;
  bool _submitting = false;
  String? _error;

  PromotionSummary get _promotion =>
      PromotionSummary.calculate(widget.bootstrap.settings, widget.cart);
  double get _pointValue =>
      _positiveSetting(widget.bootstrap.settings['point_redeem_value'], 1);
  int get _maxRedeemPoints {
    if (_member == null || _member!.expired || _promotion.blocksLoyalty) {
      return 0;
    }
    final byTotal = ((widget.cart.subtotal - _promotion.discount) / _pointValue)
        .floor();
    return byTotal < _member!.points ? byTotal : _member!.points;
  }

  int get _redeemPoints {
    if (_loyaltyChoice != 'redeem') return 0;
    final requested = int.tryParse(_points.text.trim()) ?? 0;
    return requested.clamp(0, _maxRedeemPoints);
  }

  double get _total =>
      (widget.cart.subtotal -
              _promotion.discount -
              (_redeemPoints * _pointValue))
          .clamp(0, widget.cart.subtotal)
          .toDouble();

  @override
  void initState() {
    super.initState();
    final methods = widget.bootstrap.enabledPaymentMethods;
    _paymentMethod = methods.isEmpty ? null : methods.first;
    _received.text = _total.toStringAsFixed(2);
    if (_paymentMethod == PaymentMethod.qr) _loadQr();
  }

  @override
  void dispose() {
    _received.dispose();
    _memberQuery.dispose();
    _customerQuery.dispose();
    _points.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final methods = widget.bootstrap.enabledPaymentMethods;
    final received = double.tryParse(_received.text) ?? 0;
    final change = (received - _total).clamp(0, double.infinity);

    return AlertDialog(
      title: const Text('ชำระเงิน'),
      content: SingleChildScrollView(
        child: SizedBox(
          width: 460,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _TotalLine(
                label: 'ยอดชำระ',
                value: _money(_total),
                emphasized: true,
              ),
              if (_promotion.labels.isNotEmpty) ...[
                const SizedBox(height: 7),
                for (final label in _promotion.labels)
                  Text(label, style: const TextStyle(color: Color(0xFF138A58))),
              ],
              const SizedBox(height: 14),
              Text(
                'สมาชิกและคะแนน',
                style: Theme.of(
                  context,
                ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 8),
              if (_member == null) ...[
                TextField(
                  controller: _memberQuery,
                  enabled: !_submitting,
                  textInputAction: TextInputAction.search,
                  onSubmitted: (_) => _searchMember(),
                  decoration: InputDecoration(
                    labelText: 'เบอร์โทรหรือรหัสบัตรสมาชิก',
                    prefixIcon: const Icon(Icons.card_membership_outlined),
                    suffixIcon: IconButton(
                      tooltip: 'ค้นหาสมาชิก',
                      onPressed: _searchingMember ? null : _searchMember,
                      icon: _searchingMember
                          ? const Padding(
                              padding: EdgeInsets.all(12),
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.search_rounded),
                    ),
                  ),
                ),
                if (_memberResults.isNotEmpty)
                  Container(
                    margin: const EdgeInsets.only(top: 6),
                    decoration: BoxDecoration(
                      border: Border.all(color: const Color(0xFFE4E0EF)),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Column(
                      children: [
                        for (final member in _memberResults)
                          ListTile(
                            dense: true,
                            title: Text(
                              member.name,
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            subtitle: Text(
                              '${member.phone} · ${member.points} แต้ม${member.expired ? ' · บัตรหมดอายุ' : ''}',
                            ),
                            onTap: member.expired
                                ? null
                                : () {
                                    setState(() {
                                      _member = member;
                                      _memberResults = const [];
                                      _loyaltyChoice = null;
                                      _points.text = '0';
                                      _error = null;
                                    });
                                  },
                          ),
                      ],
                    ),
                  ),
              ] else ...[
                Container(
                  padding: const EdgeInsets.fromLTRB(12, 8, 6, 8),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF0EDFF),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.verified_user_outlined,
                        color: Color(0xFF6554D9),
                      ),
                      const SizedBox(width: 9),
                      Expanded(
                        child: Text(
                          '${_member!.name} · ${_member!.points} แต้ม',
                          style: const TextStyle(fontWeight: FontWeight.w900),
                        ),
                      ),
                      IconButton(
                        tooltip: 'นำสมาชิกออกจากบิล',
                        onPressed: _submitting
                            ? null
                            : () => setState(() {
                                _member = null;
                                _loyaltyChoice = null;
                                _points.text = '0';
                              }),
                        icon: const Icon(Icons.close_rounded),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                if (_promotion.blocksLoyalty)
                  const _PaymentNote(
                    icon: Icons.local_offer_outlined,
                    text: 'บิลโปรโมชั่นนี้ไม่สามารถสะสมหรือใช้แต้มร่วมได้',
                  )
                else ...[
                  Wrap(
                    spacing: 8,
                    children: [
                      ChoiceChip(
                        label: const Text('สะสมแต้ม'),
                        selected: _loyaltyChoice == 'earn',
                        onSelected: _submitting
                            ? null
                            : (_) => setState(() {
                                _loyaltyChoice = 'earn';
                                _points.text = '0';
                                _syncTotal();
                              }),
                      ),
                      ChoiceChip(
                        label: const Text('ใช้แต้ม'),
                        selected: _loyaltyChoice == 'redeem',
                        onSelected: _submitting
                            ? null
                            : (_) => setState(() {
                                _loyaltyChoice = 'redeem';
                                _syncTotal();
                              }),
                      ),
                    ],
                  ),
                  if (_loyaltyChoice == 'redeem') ...[
                    const SizedBox(height: 8),
                    TextField(
                      controller: _points,
                      enabled: !_submitting,
                      keyboardType: TextInputType.number,
                      onChanged: (_) => setState(_syncTotal),
                      decoration: InputDecoration(
                        labelText: 'จำนวนแต้มที่ใช้ (สูงสุด $_maxRedeemPoints)',
                        prefixIcon: const Icon(Icons.stars_outlined),
                        helperText:
                            'ส่วนลด ${_money(_redeemPoints * _pointValue)}',
                      ),
                    ),
                  ],
                ],
              ],
              const SizedBox(height: 16),
              if (methods.isEmpty)
                const _InlineError(
                  message: 'ผู้ดูแลปิดช่องทางชำระเงินที่ Mobile รองรับทั้งหมด',
                )
              else
                Wrap(
                  spacing: 7,
                  runSpacing: 7,
                  children: [
                    for (final method in methods)
                      ChoiceChip(
                        avatar: Icon(_paymentIcon(method), size: 18),
                        label: Text(method.label),
                        selected: _paymentMethod == method,
                        onSelected: _submitting
                            ? null
                            : (_) {
                                setState(() {
                                  _paymentMethod = method;
                                  _error = null;
                                });
                                if (method == PaymentMethod.qr) _loadQr();
                              },
                      ),
                  ],
                ),
              const SizedBox(height: 15),
              if (_paymentMethod == PaymentMethod.cash) ...[
                TextField(
                  controller: _received,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(
                    labelText: 'รับเงิน (บาท)',
                    prefixIcon: Icon(Icons.payments_outlined),
                  ),
                ),
                const SizedBox(height: 9),
                Text(
                  'เงินทอน ${_money(change.toDouble())}',
                  textAlign: TextAlign.right,
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
              ],
              if (_paymentMethod == PaymentMethod.qr)
                _QrPayment(request: _qrRequest),
              if (_paymentMethod == PaymentMethod.card)
                const _PaymentNote(
                  icon: Icons.credit_card_rounded,
                  text:
                      'ตรวจสอบว่าเครื่องรับบัตรอนุมัติรายการแล้วก่อนบันทึกการขาย',
                ),
              if (_paymentMethod == PaymentMethod.credit) ...[
                const _PaymentNote(
                  icon: Icons.account_balance_wallet_outlined,
                  text:
                      'ระบบจะตรวจยอดค้างและวงเงินเครดิตจากเซิร์ฟเวอร์ก่อนบันทึก',
                ),
                const SizedBox(height: 9),
                if (_customer == null) ...[
                  TextField(
                    controller: _customerQuery,
                    enabled: !_submitting,
                    textInputAction: TextInputAction.search,
                    onSubmitted: (_) => _searchCustomer(),
                    decoration: InputDecoration(
                      labelText: 'ค้นหาชื่อ เบอร์โทร หรือทะเบียนรถ',
                      prefixIcon: const Icon(Icons.business_outlined),
                      suffixIcon: IconButton(
                        tooltip: 'ค้นหาลูกค้า',
                        onPressed: _searchingCustomer ? null : _searchCustomer,
                        icon: _searchingCustomer
                            ? const Padding(
                                padding: EdgeInsets.all(12),
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.search_rounded),
                      ),
                    ),
                  ),
                  if (_customerResults.isNotEmpty)
                    Container(
                      margin: const EdgeInsets.only(top: 6),
                      decoration: BoxDecoration(
                        border: Border.all(color: const Color(0xFFE4E0EF)),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Column(
                        children: [
                          for (final customer in _customerResults)
                            ListTile(
                              dense: true,
                              title: Text(
                                customer.name,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              subtitle: Text(
                                [
                                  customer.phone,
                                  customer.vehiclePlate,
                                  if (customer.creditLimit > 0)
                                    'วงเงิน ${_money(customer.creditLimit)}',
                                ].where((part) => part.isNotEmpty).join(' · '),
                              ),
                              onTap: () => _selectCustomer(customer),
                            ),
                        ],
                      ),
                    ),
                ] else
                  ListTile(
                    tileColor: const Color(0xFFF0EDFF),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                    leading: const Icon(Icons.business_rounded),
                    title: Text(
                      _customer!.name,
                      style: const TextStyle(fontWeight: FontWeight.w900),
                    ),
                    subtitle: Text(
                      _creditDetail == null
                          ? 'กำลังตรวจสอบยอดค้าง...'
                          : [
                              'ค้าง ${_money(_number(_creditDetail?['outstanding']))}',
                              _customer!.creditLimit > 0
                                  ? 'วงเงิน ${_money(_customer!.creditLimit)}'
                                  : 'ไม่จำกัดวงเงิน',
                            ].join(' · '),
                    ),
                    trailing: IconButton(
                      tooltip: 'เปลี่ยนลูกค้า',
                      onPressed: _submitting
                          ? null
                          : () => setState(() {
                              _customer = null;
                              _creditDetail = null;
                            }),
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ),
              ],
              if (_paymentMethod == PaymentMethod.thungngern)
                const _PaymentNote(
                  icon: Icons.qr_code_scanner_rounded,
                  text:
                      'สร้าง QR ถุงเงินและรอระบบยืนยันเงินเข้า หรือยืนยันรับเงินด้วยตนเอง',
                ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                _InlineError(message: _error!),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _submitting ? null : () => Navigator.pop(context),
          child: const Text('ยกเลิก'),
        ),
        FilledButton.icon(
          onPressed: _submitting || _paymentMethod == null ? null : _submit,
          icon: _submitting
              ? const SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.check_circle_outline_rounded),
          label: Text(_submitting ? 'กำลังบันทึก...' : 'ยืนยันรับชำระ'),
        ),
      ],
    );
  }

  void _loadQr() {
    setState(() {
      _qrRequest = ref
          .read(posRepositoryProvider)
          .promptPayQr(branchId: widget.staff.branch.id, amount: _total);
    });
  }

  void _syncTotal() {
    if (_paymentMethod == PaymentMethod.cash) {
      _received.text = _total.toStringAsFixed(2);
    }
    if (_paymentMethod == PaymentMethod.qr) {
      scheduleMicrotask(_loadQr);
    }
  }

  Future<void> _searchMember() async {
    final query = _memberQuery.text.trim();
    if (query.length < 3) {
      setState(() => _error = 'กรอกเบอร์โทรหรือรหัสบัตรอย่างน้อย 3 ตัวอักษร');
      return;
    }
    setState(() {
      _searchingMember = true;
      _error = null;
    });
    try {
      final rows = await ref
          .read(posRepositoryProvider)
          .findMembers(branchId: widget.staff.branch.id, query: query);
      if (mounted) {
        setState(() {
          _memberResults = rows;
          if (rows.isEmpty) _error = 'ไม่พบสมาชิก';
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _searchingMember = false);
    }
  }

  Future<void> _searchCustomer() async {
    final query = _customerQuery.text.trim();
    if (query.length < 2) {
      setState(() => _error = 'กรอกคำค้นหาลูกค้าอย่างน้อย 2 ตัวอักษร');
      return;
    }
    setState(() {
      _searchingCustomer = true;
      _error = null;
    });
    try {
      final rows = await ref
          .read(posRepositoryProvider)
          .findCustomers(branchId: widget.staff.branch.id, query: query);
      if (mounted) {
        setState(() {
          _customerResults = rows;
          if (rows.isEmpty) _error = 'ไม่พบลูกค้าเครดิต';
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _searchingCustomer = false);
    }
  }

  Future<void> _selectCustomer(PosCustomer customer) async {
    setState(() {
      _customer = customer;
      _customerResults = const [];
      _creditDetail = null;
      _error = null;
    });
    try {
      final detail = await ref
          .read(posRepositoryProvider)
          .customerCreditDetail(
            branchId: widget.staff.branch.id,
            customerId: customer.id,
          );
      if (mounted && _customer?.id == customer.id) {
        setState(() => _creditDetail = detail);
      }
    } catch (error) {
      if (mounted && _customer?.id == customer.id) {
        setState(() => _error = '$error');
      }
    }
  }

  Future<void> _submit() async {
    final method = _paymentMethod;
    final shift = widget.bootstrap.currentShift;
    if (method == null || shift == null) return;
    final received = double.tryParse(_received.text) ?? 0;
    if (method == PaymentMethod.cash && received < _total) {
      setState(() => _error = 'จำนวนเงินรับไม่พอ');
      return;
    }
    if (_member != null && _member!.expired) {
      setState(() => _error = 'บัตรสมาชิกหมดอายุแล้ว กรุณานำสมาชิกออกจากบิล');
      return;
    }
    if (_member != null &&
        !_promotion.blocksLoyalty &&
        _loyaltyChoice == null) {
      setState(() => _error = 'กรุณาเลือกว่าจะสะสมแต้ม หรือใช้แต้มเป็นส่วนลด');
      return;
    }
    if (_loyaltyChoice == 'redeem' && _redeemPoints <= 0) {
      setState(() => _error = 'กรุณาระบุจำนวนแต้มที่ต้องการใช้');
      return;
    }
    if (method == PaymentMethod.credit && _customer == null) {
      setState(() => _error = 'ขายเชื่อต้องเลือกลูกค้าก่อนชำระ');
      return;
    }
    if (method == PaymentMethod.qr) {
      try {
        final qr = await _qrRequest;
        if (qr?.payload == null) {
          setState(() {
            _error = 'ยังไม่ได้ตั้งค่า QR รับเงินของสาขา';
          });
          return;
        }
      } catch (error) {
        setState(() => _error = '$error');
        return;
      }
    }

    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      if (method == PaymentMethod.thungngern) {
        final repository = ref.read(posRepositoryProvider);
        final session = await repository.startThungngern(
          branchId: widget.staff.branch.id,
          shiftId: shift.id,
          staffName: widget.staff.name,
          cart: widget.cart,
          member: _member,
          pointsToRedeem: _promotion.blocksLoyalty ? 0 : _redeemPoints,
          loyaltyChoice: _promotion.blocksLoyalty ? null : _loyaltyChoice,
          discount: _promotion.discount,
        );
        if (!mounted) return;
        final receipt = await showDialog<SaleReceipt>(
          context: context,
          barrierDismissible: false,
          builder: (context) => _ThungngernDialog(
            branchId: widget.staff.branch.id,
            session: session,
          ),
        );
        if (!mounted) return;
        if (receipt != null) {
          Navigator.pop(context, receipt);
        } else {
          setState(() => _submitting = false);
        }
        return;
      }
      final receipt = await ref
          .read(posRepositoryProvider)
          .createSale(
            branchId: widget.staff.branch.id,
            shiftId: shift.id,
            staffName: widget.staff.name,
            cart: widget.cart,
            paymentMethod: method,
            received: received,
            member: _member,
            customer: method == PaymentMethod.credit ? _customer : null,
            pointsToRedeem: _promotion.blocksLoyalty ? 0 : _redeemPoints,
            loyaltyChoice: _promotion.blocksLoyalty ? null : _loyaltyChoice,
            discount: _promotion.discount,
          );
      if (mounted) Navigator.pop(context, receipt);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = '$error';
      });
    }
  }
}

class _ThungngernDialog extends ConsumerStatefulWidget {
  const _ThungngernDialog({required this.branchId, required this.session});

  final int branchId;
  final ThungngernSession session;

  @override
  ConsumerState<_ThungngernDialog> createState() => _ThungngernDialogState();
}

class _ThungngernDialogState extends ConsumerState<_ThungngernDialog> {
  final _slipQr = TextEditingController();
  Timer? _timer;
  bool _busy = false;
  bool _finished = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(
      const Duration(seconds: 3),
      (_) => unawaited(_poll()),
    );
  }

  @override
  void dispose() {
    _timer?.cancel();
    _slipQr.dispose();
    super.dispose();
  }

  Future<void> _poll() async {
    if (_busy || _finished) return;
    try {
      final receipt = await ref
          .read(posRepositoryProvider)
          .thungngernSessionStatus(
            branchId: widget.branchId,
            sessionId: widget.session.id,
          );
      if (receipt != null && mounted) {
        _finished = true;
        Navigator.pop(context, receipt);
      }
    } catch (_) {
      // การ poll ครั้งถัดไปจะลองใหม่ และผู้ใช้ยังยืนยันด้วยตนเองได้
    }
  }

  Future<void> _confirm() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('ยืนยันว่าได้รับเงินแล้ว?'),
        content: Text(
          'ตรวจสอบยอด ${_money(widget.session.amount)} ในบัญชีร้านก่อนยืนยัน',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('กลับไปตรวจสอบ'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('ยืนยันรับเงิน'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _complete(
      () => ref
          .read(posRepositoryProvider)
          .confirmThungngern(
            branchId: widget.branchId,
            sessionId: widget.session.id,
          ),
    );
  }

  Future<void> _verifySlip() async {
    if (_slipQr.text.trim().length < 10) {
      setState(() => _error = 'กรุณาสแกนหรือวางข้อมูล QR จากสลิป');
      return;
    }
    await _complete(
      () => ref
          .read(posRepositoryProvider)
          .verifyThungngernSlip(
            branchId: widget.branchId,
            sessionId: widget.session.id,
            qrCode: _slipQr.text,
          ),
    );
  }

  Future<void> _complete(Future<SaleReceipt> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final receipt = await action();
      if (mounted) {
        _finished = true;
        Navigator.pop(context, receipt);
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = '$error';
        });
      }
    }
  }

  Future<void> _cancel() async {
    setState(() => _busy = true);
    try {
      await ref
          .read(posRepositoryProvider)
          .cancelThungngern(
            branchId: widget.branchId,
            sessionId: widget.session.id,
          );
      if (mounted) Navigator.pop(context);
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
    return AlertDialog(
      title: const Text('รับชำระ QR ถุงเงิน'),
      content: SingleChildScrollView(
        child: SizedBox(
          width: 430,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                _money(widget.session.amount),
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.w900,
                  color: const Color(0xFF4433A5),
                ),
              ),
              Text(
                'อ้างอิง ${widget.session.refCode}',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 10),
              Center(
                child: QrImageView(
                  data: widget.session.payload,
                  size: 220,
                  backgroundColor: Colors.white,
                ),
              ),
              const Text(
                'ระบบกำลังตรวจสอบสถานะเงินเข้าทุก 3 วินาที',
                textAlign: TextAlign.center,
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _slipQr,
                enabled: !_busy,
                minLines: 1,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'ข้อมูล QR จากสลิป (ถ้ามี)',
                  prefixIcon: Icon(Icons.qr_code_scanner_rounded),
                ),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: _busy ? null : _verifySlip,
                icon: const Icon(Icons.verified_outlined),
                label: const Text('ตรวจสลิปกับ Slip2Go'),
              ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                _InlineError(message: _error!),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : _cancel,
          child: const Text('ยกเลิก QR'),
        ),
        FilledButton.icon(
          onPressed: _busy ? null : _confirm,
          icon: _busy
              ? const SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.check_circle_outline_rounded),
          label: const Text('ยืนยันรับเงินเอง'),
        ),
      ],
    );
  }
}

class _QrPayment extends StatelessWidget {
  const _QrPayment({required this.request});

  final Future<PromptPayQr>? request;

  @override
  Widget build(BuildContext context) {
    if (request == null) return const SizedBox.shrink();
    return FutureBuilder<PromptPayQr>(
      future: request,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const SizedBox(
            height: 220,
            child: Center(child: CircularProgressIndicator()),
          );
        }
        if (snapshot.hasError) {
          return _InlineError(message: '${snapshot.error}');
        }
        final payload = snapshot.data?.payload;
        if (payload == null) {
          return const _InlineError(
            message: 'ยังไม่ได้ตั้งค่า QR รับเงินของสาขา',
          );
        }
        return Column(
          children: [
            QrImageView(
              data: payload,
              size: 220,
              backgroundColor: Colors.white,
              errorCorrectionLevel: QrErrorCorrectLevel.M,
            ),
            const Text(
              'ให้ลูกค้าสแกนและตรวจสอบยอดเข้าก่อนกดยืนยัน',
              textAlign: TextAlign.center,
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
          ],
        );
      },
    );
  }
}

class _ReceiptDialog extends StatelessWidget {
  const _ReceiptDialog({required this.receipt});

  final SaleReceipt receipt;

  @override
  Widget build(BuildContext context) {
    final sale = receipt.sale;
    return AlertDialog(
      icon: const CircleAvatar(
        radius: 28,
        backgroundColor: Color(0xFFE5F8EF),
        foregroundColor: Color(0xFF138A58),
        child: Icon(Icons.check_rounded, size: 34),
      ),
      title: const Text('บันทึกการขายสำเร็จ'),
      content: SingleChildScrollView(
        child: SizedBox(
          width: 440,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                sale.receiptNo,
                textAlign: TextAlign.center,
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 14),
              for (final item in receipt.items)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${item.name} × ${_quantity(item.quantity)} ${item.unit}',
                        ),
                      ),
                      Text(_money(item.amount)),
                    ],
                  ),
                ),
              const Divider(height: 22),
              _TotalLine(label: 'ยอดก่อนส่วนลด', value: _money(sale.subtotal)),
              if (sale.discount > 0)
                _TotalLine(label: 'ส่วนลด', value: '−${_money(sale.discount)}'),
              _TotalLine(
                label: 'ยอดสุทธิ',
                value: _money(sale.total),
                emphasized: true,
              ),
              _TotalLine(label: 'ชำระโดย', value: sale.paymentMethod.label),
              if (sale.paymentMethod == PaymentMethod.cash)
                _TotalLine(label: 'เงินทอน', value: _money(sale.changeAmount)),
            ],
          ),
        ),
      ),
      actions: [
        FilledButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('เริ่มบิลใหม่'),
        ),
      ],
    );
  }
}

class _NoShiftBanner extends StatelessWidget {
  const _NoShiftBanner();

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFFFFF4E5),
      child: const Padding(
        padding: EdgeInsets.all(14),
        child: Row(
          children: [
            Icon(Icons.schedule_rounded, color: Color(0xFFB96A00)),
            SizedBox(width: 10),
            Expanded(
              child: Text(
                'ต้องเปิดกะและบันทึกมิเตอร์ตั้งต้นก่อนจึงจะเริ่มขายได้',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PaymentNote extends StatelessWidget {
  const _PaymentNote({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFF2F0FA),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Icon(icon),
          const SizedBox(width: 10),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFEEEE),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFFFC2C2)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline_rounded, color: Color(0xFFB42318)),
          const SizedBox(width: 9),
          Expanded(child: Text(message)),
        ],
      ),
    );
  }
}

class _TotalLine extends StatelessWidget {
  const _TotalLine({
    required this.label,
    required this.value,
    this.emphasized = false,
  });

  final String label;
  final String value;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final style = emphasized
        ? Theme.of(
            context,
          ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900)
        : Theme.of(context).textTheme.bodyMedium;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          Text(value, style: style),
        ],
      ),
    );
  }
}

class _LoadError extends StatelessWidget {
  const _LoadError({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off_rounded, size: 48),
            const SizedBox(height: 12),
            const Text('โหลดหน้าขายไม่สำเร็จ'),
            const SizedBox(height: 6),
            Text('$error', textAlign: TextAlign.center),
            const SizedBox(height: 15),
            FilledButton.tonalIcon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('ลองอีกครั้ง'),
            ),
          ],
        ),
      ),
    );
  }
}

IconData _categoryIcon(ProductCategory category) => switch (category) {
  ProductCategory.fuel => Icons.local_gas_station_rounded,
  ProductCategory.lubricant => Icons.oil_barrel_rounded,
  ProductCategory.other => Icons.inventory_2_rounded,
};

IconData _paymentIcon(PaymentMethod method) => switch (method) {
  PaymentMethod.cash => Icons.payments_rounded,
  PaymentMethod.qr => Icons.qr_code_rounded,
  PaymentMethod.card => Icons.credit_card_rounded,
  PaymentMethod.credit => Icons.account_balance_wallet_outlined,
  PaymentMethod.thungngern => Icons.qr_code_scanner_rounded,
};

Color _productColor(PosProduct product) {
  if (!product.isFuel) return const Color(0xFF596275);
  final code = product.code.toUpperCase();
  if (code.contains('D') || code.contains('B7')) return const Color(0xFF3569C8);
  if (code.contains('91')) return const Color(0xFF15946B);
  if (code.contains('95')) return const Color(0xFFE26938);
  return const Color(0xFF775CE5);
}

String _money(double value) =>
    NumberFormat.currency(locale: 'th_TH', symbol: '฿').format(value);

String _quantity(double value) => NumberFormat('0.###', 'th_TH').format(value);

double _number(Object? value) =>
    value is num ? value.toDouble() : double.tryParse('$value') ?? 0;

double _positiveSetting(String? value, double fallback) {
  final parsed = double.tryParse(value ?? '');
  return parsed != null && parsed.isFinite && parsed > 0 ? parsed : fallback;
}
