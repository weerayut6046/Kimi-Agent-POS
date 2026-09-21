import '../../../core/network/trpc_client.dart';
import '../domain/shift_models.dart';

class ShiftRepository {
  const ShiftRepository(this._trpc);

  final TrpcClient _trpc;

  Future<ShiftBootstrap> load(int branchId) async {
    final responses = await Future.wait<Object?>([
      _trpc.query('pos.currentShift', branchId: branchId),
      _trpc.query('catalog.listPumps', branchId: branchId),
      _trpc.query('attendance.myStatus', branchId: branchId),
    ]);
    final currentJson = responses[0];
    final pumpsJson = responses[1];
    final attendanceJson = _jsonMap(responses[2]);
    final openAttendance = _optionalMap(attendanceJson['openSession']);
    final bangkokToday = DateTime.now()
        .toUtc()
        .add(const Duration(hours: 7))
        .toIso8601String()
        .substring(0, 10);
    final faceClockedIn =
        openAttendance?['workDate'] == bangkokToday &&
        openAttendance?['clockInMethod'] == 'face';
    if (pumpsJson is! List<dynamic>) {
      throw const FormatException('Invalid pump response');
    }
    final nozzles = <ShiftNozzle>[];
    for (final pumpItem in pumpsJson) {
      final pump = _jsonMap(pumpItem);
      final pumpName = pump['name'] as String? ?? 'ไม่ทราบตู้';
      final nozzleItems = pump['nozzles'];
      if (nozzleItems is! List<dynamic>) continue;
      nozzles.addAll(
        nozzleItems
            .map(
              (item) =>
                  ShiftNozzle.fromJson(_jsonMap(item), pumpName: pumpName),
            )
            .where((nozzle) => nozzle.active),
      );
    }
    return ShiftBootstrap(
      currentShift: currentJson == null
          ? null
          : CurrentShift.fromJson(_jsonMap(currentJson)),
      nozzles: List<ShiftNozzle>.unmodifiable(nozzles),
      faceClockedIn: faceClockedIn,
      faceClockInAt: DateTime.tryParse(
        openAttendance?['clockInAt'] as String? ?? '',
      ),
    );
  }

  Future<void> openShift({
    required int branchId,
    required int staffId,
    required String staffName,
    required double openingFloat,
    required List<ShiftOpeningReading> readings,
  }) async {
    await _trpc.mutation(
      'pos.openShift',
      input: <String, Object?>{
        'staffId': staffId,
        'staffName': staffName,
        'openingFloat': _round(openingFloat, 2),
        'readings': [
          for (final reading in readings)
            {
              'nozzleId': reading.nozzleId,
              'openMeter': _round(reading.openMeter, 3),
              'openMoney': _round(reading.openMoney, 2),
            },
        ],
      },
      branchId: branchId,
    );
  }

  Future<void> closeShift({
    required int branchId,
    required int shiftId,
    required List<ShiftClosingReading> readings,
    double? countedCash,
    double? transferAmount,
    Map<String, int>? cashCounts,
    String? note,
  }) async {
    await _trpc.mutation(
      'pos.closeShift',
      input: <String, Object?>{
        'shiftId': shiftId,
        'readings': [
          for (final reading in readings)
            {
              'nozzleId': reading.nozzleId,
              'closeMeter': _round(reading.closeMeter, 3),
              'closeMoney': _round(reading.closeMoney, 2),
            },
        ],
        if (countedCash != null) 'countedCash': _round(countedCash, 2),
        if (transferAmount != null) 'transferAmount': _round(transferAmount, 2),
        if (cashCounts != null && cashCounts.isNotEmpty)
          'cashCounts': cashCounts,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
        'lubricantItems': <Object>[],
      },
      branchId: branchId,
    );
  }

  Future<Object?> queryProcedure(
    String procedure, {
    required int branchId,
    Object? input,
  }) => _trpc.query(procedure, branchId: branchId, input: input);

  Future<Object?> mutateProcedure(
    String procedure, {
    required int branchId,
    Object? input,
  }) => _trpc.mutation(procedure, branchId: branchId, input: input);
}

class ShiftOpeningReading {
  const ShiftOpeningReading({
    required this.nozzleId,
    required this.openMeter,
    required this.openMoney,
  });

  final int nozzleId;
  final double openMeter;
  final double openMoney;
}

class ShiftClosingReading {
  const ShiftClosingReading({
    required this.nozzleId,
    required this.closeMeter,
    required this.closeMoney,
  });

  final int nozzleId;
  final double closeMeter;
  final double closeMoney;
}

Map<String, dynamic> _jsonMap(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  throw const FormatException('Invalid JSON object');
}

Map<String, dynamic>? _optionalMap(Object? value) {
  if (value == null) return null;
  return _jsonMap(value);
}

double _round(double value, int digits) {
  final factor = digits == 3 ? 1000 : 100;
  return (value * factor + 1e-9).round() / factor;
}
