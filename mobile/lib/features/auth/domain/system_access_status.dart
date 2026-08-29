class ActiveSystemShift {
  const ActiveSystemShift({
    required this.id,
    required this.staffName,
    required this.openedAt,
  });

  factory ActiveSystemShift.fromJson(Map<String, dynamic> json) {
    final id = json['id'];
    final staffName = json['staffName'];
    final openedAt = json['openedAt'];
    if (id is! num || staffName is! String || openedAt is! String) {
      throw const FormatException('Invalid active shift');
    }
    return ActiveSystemShift(
      id: id.toInt(),
      staffName: staffName,
      openedAt: DateTime.parse(openedAt),
    );
  }

  final int id;
  final String staffName;
  final DateTime openedAt;
}

class SystemAccessStatus {
  const SystemAccessStatus({
    required this.allowed,
    required this.reason,
    required this.workDate,
    required this.hasWorkSchedule,
    required this.message,
    required this.activeShift,
  });

  factory SystemAccessStatus.fromJson(Map<String, dynamic> json) {
    final allowed = json['allowed'];
    final reason = json['reason'];
    final workDate = json['workDate'];
    final hasWorkSchedule = json['hasWorkSchedule'];
    final message = json['message'];
    final activeShiftJson = json['activeShift'];
    if (allowed is! bool ||
        reason is! String ||
        workDate is! String ||
        hasWorkSchedule is! bool ||
        (message != null && message is! String) ||
        (activeShiftJson != null && activeShiftJson is! Map<String, dynamic>)) {
      throw const FormatException('Invalid system access response');
    }

    return SystemAccessStatus(
      allowed: allowed,
      reason: reason,
      workDate: workDate,
      hasWorkSchedule: hasWorkSchedule,
      message: message as String?,
      activeShift: activeShiftJson == null
          ? null
          : ActiveSystemShift.fromJson(activeShiftJson),
    );
  }

  final bool allowed;
  final String reason;
  final String workDate;
  final bool hasWorkSchedule;
  final String? message;
  final ActiveSystemShift? activeShift;
}
