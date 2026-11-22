import '../../../core/network/trpc_client.dart';
import '../domain/pos_cart.dart';
import '../domain/pos_models.dart';

typedef _Row = Map<String, dynamic>;

class PosRepository {
  const PosRepository(this.client);
  final TrpcClient client;
  Future<PosBootstrap> load(int branchId) async {
    final rows = await Future.wait([
      for (final api in [
        'catalog.listProducts',
        'catalog.getSettings',
        'pos.currentShift',
        'payments.thungngernStatus',
      ])
        client.query(api, branchId: branchId),
    ]);
    return PosBootstrap(
      products: (rows[0] as List)
          .cast<_Row>()
          .map(PosProduct.fromJson)
          .toList(),
      settings: (rows[1] as _Row).map((k, v) => MapEntry(k, v.toString())),
      currentShift: rows[2] == null ? null : PosShift.fromJson(rows[2] as _Row),
      thungngernEnabled: (rows[3] as _Row)['enabled'] == true,
    );
  }

  Future<Map<String, dynamic>?> searchExternalProduct({
    required int branchId,
    required String barcode,
  }) async =>
      await client.query(
            'catalog.searchExternalProduct',
            branchId: branchId,
            input: {'barcode': barcode},
          )
          as _Row?;
  Future<PosProduct> importExternalProduct({
    required int branchId,
    required String barcode,
    required String name,
    required ProductCategory category,
    required String unit,
    required double price,
    required double cost,
    required double stockQty,
    required double lowStockAt,
    String? imageUrl,
  }) async => PosProduct.fromJson(
    await client.mutation(
          'catalog.importExternalProduct',
          branchId: branchId,
          input: {
            'barcode': barcode,
            'name': name,
            'category': category.name,
            'unit': unit,
            'price': price,
            'cost': cost,
            'stockQty': stockQty,
            'lowStockAt': lowStockAt,
            'imageUrl': imageUrl,
          },
        )
        as _Row,
  );
  Future<List<PosMember>> findMembers({
    required int branchId,
    required String query,
  }) async =>
      (await client.query(
                'membership.listMembers',
                branchId: branchId,
                input: {'search': query},
              )
              as List)
          .cast<_Row>()
          .map(PosMember.fromJson)
          .toList();
  Future<List<PosCustomer>> findCustomers({
    required int branchId,
    required String query,
  }) async =>
      (await client.query(
                'customers.list',
                branchId: branchId,
                input: {'q': query},
              )
              as List)
          .cast<_Row>()
          .map(PosCustomer.fromJson)
          .toList();
  Future<Map<String, dynamic>> customerCreditDetail({
    required int branchId,
    required int customerId,
  }) async =>
      await client.query(
            'credit.detail',
            branchId: branchId,
            input: {'customerId': customerId},
          )
          as _Row;
  Future<PromptPayQr> promptPayQr({
    required int branchId,
    required double amount,
  }) async => PromptPayQr.fromJson(
    await client.query(
          'payments.promptpayQr',
          branchId: branchId,
          input: {'amount': amount},
        )
        as _Row,
  );
  _Row _sale(
    int shiftId,
    String staffName,
    PosCart cart,
    PosMember? member,
    double discount,
    int points,
    String? choice,
  ) => {
    'shiftId': shiftId,
    'staffName': staffName,
    'items': [
      for (final line in cart.lines)
        {'productId': line.product.id, 'qty': line.quantity},
    ],
    'discount': discount,
    'pointsToRedeem': points,
    if (member != null) 'memberId': member.id,
    'loyaltyChoice': ?choice,
  };
  Future<SaleReceipt> createSale({
    required int branchId,
    required int shiftId,
    required String staffName,
    required PosCart cart,
    required PaymentMethod paymentMethod,
    required double received,
    PosCustomer? customer,
    PosMember? member,
    int pointsToRedeem = 0,
    double discount = 0,
    String? loyaltyChoice,
  }) async => SaleReceipt.fromJson(
    await client.mutation(
          'pos.createSale',
          branchId: branchId,
          input: {
            ..._sale(
              shiftId,
              staffName,
              cart,
              member,
              discount,
              pointsToRedeem,
              loyaltyChoice,
            ),
            'paymentMethod': paymentMethod.name,
            'received': received,
            if (customer != null) 'customerId': customer.id,
          },
        )
        as _Row,
  );
  Future<ThungngernSession> startThungngern({
    required int branchId,
    required int shiftId,
    required String staffName,
    required PosCart cart,
    PosMember? member,
    int pointsToRedeem = 0,
    double discount = 0,
    String? loyaltyChoice,
  }) async => ThungngernSession.fromJson(
    await client.mutation(
          'payments.startThungngern',
          branchId: branchId,
          input: _sale(
            shiftId,
            staffName,
            cart,
            member,
            discount,
            pointsToRedeem,
            loyaltyChoice,
          ),
        )
        as _Row,
  );
  Future<SaleReceipt?> thungngernSessionStatus({
    required int branchId,
    required int sessionId,
  }) async {
    final result =
        await client.query(
              'payments.sessionStatus',
              branchId: branchId,
              input: {'sessionId': sessionId},
            )
            as _Row;
    final receipt = result['receipt'];
    return receipt == null ? null : SaleReceipt.fromJson(receipt as _Row);
  }

  Future<SaleReceipt> _complete(
    String procedure,
    int branchId,
    _Row input,
  ) async {
    final result =
        await client.mutation(procedure, branchId: branchId, input: input)
            as _Row;
    return SaleReceipt.fromJson(result['receipt'] as _Row);
  }

  Future<SaleReceipt> confirmThungngern({
    required int branchId,
    required int sessionId,
  }) => _complete('payments.manualConfirm', branchId, {'sessionId': sessionId});
  Future<SaleReceipt> verifyThungngernSlip({
    required int branchId,
    required int sessionId,
    required String qrCode,
  }) => _complete('payments.verifySlip', branchId, {
    'sessionId': sessionId,
    'qrCode': qrCode,
  });
  Future<void> cancelThungngern({
    required int branchId,
    required int sessionId,
  }) async {
    await client.mutation(
      'payments.cancelSession',
      branchId: branchId,
      input: {'sessionId': sessionId},
    );
  }
}
