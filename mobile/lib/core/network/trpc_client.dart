import 'dart:convert';

import 'package:http/http.dart' as http;

typedef AccessTokenProvider = String? Function();

class TrpcException implements Exception {
  const TrpcException({
    required this.procedure,
    required this.message,
    this.statusCode,
  });

  final String procedure;
  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class TrpcClient {
  TrpcClient({
    required Uri baseUri,
    required String publishableKey,
    required String functionRegion,
    required AccessTokenProvider accessTokenProvider,
    http.Client? httpClient,
  }) : _baseUri = baseUri,
       _publishableKey = publishableKey,
       _functionRegion = functionRegion,
       _accessTokenProvider = accessTokenProvider,
       _httpClient = httpClient ?? http.Client(),
       _ownsClient = httpClient == null;

  final Uri _baseUri;
  final String _publishableKey;
  final String _functionRegion;
  final AccessTokenProvider _accessTokenProvider;
  final http.Client _httpClient;
  final bool _ownsClient;

  Future<Object?> query(
    String procedure, {
    Object? input,
    int? branchId,
  }) async {
    final queryParameters = input == null
        ? null
        : <String, String>{
            'input': jsonEncode(<String, Object?>{'json': input}),
          };
    final response = await _httpClient.get(
      _procedureUri(procedure, queryParameters),
      headers: _headers(branchId: branchId),
    );
    return _decode(response, procedure);
  }

  Future<Object?> mutation(
    String procedure, {
    Object? input,
    int? branchId,
  }) async {
    final response = await _httpClient.post(
      _procedureUri(procedure),
      headers: _headers(branchId: branchId),
      body: jsonEncode(<String, Object?>{'json': input}),
    );
    return _decode(response, procedure);
  }

  Uri _procedureUri(String procedure, [Map<String, String>? queryParameters]) {
    final basePath = _baseUri.path.replaceFirst(RegExp(r'/+$'), '');
    return _baseUri.replace(
      path: '$basePath/$procedure',
      queryParameters: queryParameters,
    );
  }

  Map<String, String> _headers({int? branchId}) {
    final accessToken = _accessTokenProvider();
    if (accessToken == null || accessToken.isEmpty) {
      throw const TrpcException(
        procedure: 'authentication',
        message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง',
      );
    }
    return <String, String>{
      'authorization': 'Bearer $accessToken',
      'apikey': _publishableKey,
      'content-type': 'application/json',
      'x-region': _functionRegion,
      if (branchId != null) 'x-branch-id': '$branchId',
    };
  }

  Object? _decode(http.Response response, String procedure) {
    Object? decoded;
    try {
      decoded = jsonDecode(utf8.decode(response.bodyBytes));
    } on FormatException {
      throw TrpcException(
        procedure: procedure,
        statusCode: response.statusCode,
        message: 'เซิร์ฟเวอร์ตอบกลับในรูปแบบที่ไม่ถูกต้อง',
      );
    }

    if (decoded is! Map<String, dynamic>) {
      throw TrpcException(
        procedure: procedure,
        statusCode: response.statusCode,
        message: 'ไม่สามารถอ่านข้อมูลจากเซิร์ฟเวอร์ได้',
      );
    }

    final error = decoded['error'];
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        error != null) {
      throw TrpcException(
        procedure: procedure,
        statusCode: response.statusCode,
        message: _errorMessage(error) ?? 'การเชื่อมต่อระบบไม่สำเร็จ',
      );
    }

    final result = decoded['result'];
    if (result is! Map<String, dynamic>) return null;
    final data = result['data'];
    if (data is! Map<String, dynamic>) return null;
    return data['json'];
  }

  String? _errorMessage(Object? error) {
    if (error is! Map<String, dynamic>) return null;
    final json = error['json'];
    if (json is Map<String, dynamic> && json['message'] is String) {
      return json['message'] as String;
    }
    return error['message'] is String ? error['message'] as String : null;
  }

  void close() {
    if (_ownsClient) _httpClient.close();
  }
}
