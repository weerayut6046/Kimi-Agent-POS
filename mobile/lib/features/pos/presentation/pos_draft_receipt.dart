import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../domain/pos_cart.dart';
import '../domain/promotion.dart';

class PosDraftReceipt extends StatelessWidget {
  const PosDraftReceipt({
    required this.cart,
    required this.promotion,
    required this.onQuantityChanged,
    required this.onRemove,
    super.key,
  });

  final PosCart cart;
  final PromotionSummary promotion;
  final void Function(int productId, double quantity) onQuantityChanged;
  final ValueChanged<int> onRemove;

  @override
  Widget build(BuildContext context) {
    const paperBorder = Color(0xFFF1D8A8);
    final total = cart.totalAfterDiscount(promotion.discount);
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFDF6),
        border: Border.all(color: paperBorder),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.receipt_long_rounded),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'บิลร่าง',
                  style: Theme.of(
                    context,
                  ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
                ),
              ),
              if (!cart.isEmpty)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFEDCC),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Text(
                    'รอชำระ',
                    style: TextStyle(
                      color: Color(0xFF76400D),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
            ],
          ),
          const Divider(height: 18, color: paperBorder),
          Expanded(
            child: cart.isEmpty
                ? const Center(
                    child: Text('แตะหรือสแกนสินค้าเพื่อเริ่มรายการขาย'),
                  )
                : ListView.separated(
                    padding: EdgeInsets.zero,
                    itemCount: cart.lines.length,
                    separatorBuilder: (_, _) =>
                        const Divider(height: 16, color: paperBorder),
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
          const Divider(height: 18, color: paperBorder),
          if (!cart.isEmpty)
            PosReceiptTotalLine(
              label: 'ยอดก่อนส่วนลด',
              value: formatPosMoney(cart.subtotal),
            ),
          if (promotion.discount > 0)
            PosReceiptTotalLine(
              label: 'ส่วนลดโปรโมชั่น',
              value: '−${formatPosMoney(promotion.discount)}',
            ),
          Semantics(
            liveRegion: true,
            child: PosReceiptTotalLine(
              label: 'ยอดชำระ',
              value: formatPosMoney(total),
              emphasized: true,
            ),
          ),
        ],
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
          '${formatPosMoney(line.product.price)} / ${line.product.unit}',
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
                '${formatPosQuantity(line.quantity)} ${line.product.unit}',
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
              formatPosMoney(line.amount),
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
          ],
        ),
      ],
    );
  }
}

class PosReceiptTotalLine extends StatelessWidget {
  const PosReceiptTotalLine({
    super.key,
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

String formatPosMoney(double value) =>
    NumberFormat.currency(locale: 'th_TH', symbol: '฿').format(value);

String formatPosQuantity(double value) =>
    NumberFormat('0.###', 'th_TH').format(value);
