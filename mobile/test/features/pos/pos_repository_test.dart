import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:pumppos/core/network/trpc_client.dart';
import 'package:pumppos/features/pos/data/pos_repository.dart';
import 'package:pumppos/features/pos/domain/pos_cart.dart';
import 'package:pumppos/features/pos/domain/pos_models.dart';

void main() {
  test('loads products, settings, and the current shift', () async {
    final repository = PosRepository(
      _client((request) async {
        final procedure = request.url.pathSegments.last;
        return switch (procedure) {
          'catalog.listProducts' => _response([
            {
              'id': 1,
              'code': 'GSH95',
              'name': 'แก๊สโซฮอล์ 95',
              'category': 'fuel',
              'unit': 'ลิตร',
              'price': 37.5,
              'stockQty': 1000,
              'active': true,
              'imageUrl': null,
            },
          ]),
          'catalog.getSettings' => _response({
            'pay_cash_enabled': '1',
            'pay_qr_enabled': '0',
          }),
          'pos.currentShift' => _response({
            'id': 9,
            'staffName': 'แคชเชียร์',
            'openedAt': '2026-08-28T01:00:00.000Z',
          }),
          'payments.thungngernStatus' => _response({'enabled': false}),
          _ => http.Response('Not found', 404),
        };
      }),
    );

    final data = await repository.load(3);

    expect(data.products.single.name, 'แก๊สโซฮอล์ 95');
    expect(data.currentShift?.id, 9);
    expect(data.enabledPaymentMethods, [
      PaymentMethod.cash,
      PaymentMethod.card,
      PaymentMethod.credit,
    ]);
  });

  test('sends the authoritative sale input to pos.createSale', () async {
    late Map<String, dynamic> requestBody;
    final repository = PosRepository(
      _client((request) async {
        requestBody = jsonDecode(request.body) as Map<String, dynamic>;
        return _response({
          'sale': {
            'id': 18,
            'receiptNo': 'R00018',
            'subtotal': 100,
            'discount': 0,
            'vatRate': 7,
            'vatAmount': 6.54,
            'total': 100,
            'paymentMethod': 'cash',
            'received': 120,
            'changeAmt': 20,
            'createdAt': '2026-08-28T02:00:00.000Z',
          },
          'items': [
            {
              'name': 'น้ำดื่ม',
              'qty': 2,
              'unit': 'ขวด',
              'unitPrice': 50,
              'amount': 100,
            },
          ],
        });
      }),
    );

    final receipt = await repository.createSale(
      branchId: 3,
      shiftId: 9,
      staffName: 'แคชเชียร์',
      cart: const PosCart().add(_product, 2),
      paymentMethod: PaymentMethod.cash,
      received: 120,
    );

    final input = requestBody['json'] as Map<String, dynamic>;
    expect(input['shiftId'], 9);
    expect(input['paymentMethod'], 'cash');
    expect(input['discount'], 0);
    expect(input['items'], [
      {'productId': 2, 'qty': 2.0},
    ]);
    expect(receipt.sale.changeAmount, 20);
  });

  test('sends member points and credit customer with a credit sale', () async {
    late Map<String, dynamic> requestBody;
    final repository = PosRepository(
      _client((request) async {
        requestBody = jsonDecode(request.body) as Map<String, dynamic>;
        return _response({
          'sale': {
            'id': 19,
            'receiptNo': 'R00019',
            'subtotal': 100,
            'discount': 10,
            'vatRate': 7,
            'vatAmount': 5.89,
            'total': 90,
            'paymentMethod': 'credit',
            'received': 90,
            'changeAmt': 0,
            'createdAt': '2026-08-28T02:10:00.000Z',
          },
          'items': [
            {
              'name': 'น้ำดื่ม',
              'qty': 2,
              'unit': 'ขวด',
              'unitPrice': 50,
              'amount': 100,
            },
          ],
        });
      }),
    );

    await repository.createSale(
      branchId: 3,
      shiftId: 9,
      staffName: 'ผู้จัดการ',
      cart: const PosCart().add(_product, 2),
      paymentMethod: PaymentMethod.credit,
      received: 0,
      member: _member,
      customer: _customer,
      pointsToRedeem: 10,
      loyaltyChoice: 'redeem',
    );

    final input = requestBody['json'] as Map<String, dynamic>;
    expect(input['memberId'], 7);
    expect(input['customerId'], 12);
    expect(input['pointsToRedeem'], 10);
    expect(input['loyaltyChoice'], 'redeem');
    expect(input['paymentMethod'], 'credit');
    expect(input['received'], 0);
  });

  test('starts a Thungngern session with the current cart snapshot', () async {
    late Map<String, dynamic> requestBody;
    final repository = PosRepository(
      _client((request) async {
        requestBody = jsonDecode(request.body) as Map<String, dynamic>;
        return _response({
          'sessionId': 44,
          'refCode': 'TNG-000044',
          'payload': '000201010212',
          'amount': 95,
          'expiresAt': '2026-08-28T03:00:00.000Z',
        });
      }),
    );

    final session = await repository.startThungngern(
      branchId: 3,
      shiftId: 9,
      staffName: 'แคชเชียร์',
      cart: const PosCart().add(_product, 2),
      member: _member,
      discount: 5,
      loyaltyChoice: 'earn',
    );

    final input = requestBody['json'] as Map<String, dynamic>;
    expect(input['shiftId'], 9);
    expect(input['memberId'], 7);
    expect(input['items'], [
      {'productId': 2, 'qty': 2.0},
    ]);
    expect(input['discount'], 5);
    expect(input['loyaltyChoice'], 'earn');
    expect(session.id, 44);
    expect(session.payload, '000201010212');
  });
}

TrpcClient _client(MockClientHandler handler) {
  return TrpcClient(
    baseUri: Uri.parse('https://example.supabase.co/functions/v1/pos-api'),
    publishableKey: 'sb_publishable_test',
    functionRegion: 'ap-northeast-1',
    accessTokenProvider: () => 'access-token',
    httpClient: MockClient(handler),
  );
}

http.Response _response(Object? data) {
  return http.Response(
    jsonEncode({
      'result': {
        'data': {'json': data},
      },
    }),
    200,
    headers: {'content-type': 'application/json'},
  );
}

const _product = PosProduct(
  id: 2,
  code: 'WATER',
  name: 'น้ำดื่ม',
  category: ProductCategory.other,
  unit: 'ขวด',
  price: 50,
  stockQty: 10,
  active: true,
);

const _member = PosMember(
  id: 7,
  memberCode: '1234567890123456',
  name: 'สมาชิกทดสอบ',
  phone: '0812345678',
  points: 120,
  cardExpiresAt: null,
);

const _customer = PosCustomer(
  id: 12,
  name: 'บริษัททดสอบ',
  phone: '021234567',
  vehiclePlate: '70-1234',
  creditLimit: 50000,
);
