import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../domain/system_access_status.dart';

class ShiftAccessBlockedPage extends StatelessWidget {
  const ShiftAccessBlockedPage({
    required this.staffName,
    required this.branchName,
    required this.onRefresh,
    required this.onLogout,
    this.status,
    this.errorMessage,
    super.key,
  });

  final String staffName;
  final String branchName;
  final SystemAccessStatus? status;
  final String? errorMessage;
  final VoidCallback onRefresh;
  final VoidCallback onLogout;

  String _workDate(String value) {
    final date = DateTime.tryParse(value);
    return date == null ? value : DateFormat('d MMMM y', 'th_TH').format(date);
  }

  String _openedAt(DateTime value) {
    final bangkok = value.toUtc().add(const Duration(hours: 7));
    return DateFormat('d MMM y เวลา HH:mm น.', 'th_TH').format(bangkok);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final shift = status?.activeShift;
    final unavailable = status == null;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(28),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 68,
                        height: 68,
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFF3E8),
                          borderRadius: BorderRadius.circular(22),
                        ),
                        child: Icon(
                          unavailable
                              ? Icons.cloud_off_rounded
                              : Icons.lock_clock_rounded,
                          size: 34,
                          color: const Color(0xFFDB6B23),
                        ),
                      ),
                      const SizedBox(height: 20),
                      Text(
                        unavailable
                            ? 'ตรวจสอบสิทธิ์ไม่สำเร็จ'
                            : 'ยังเข้าใช้งานระบบไม่ได้',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.w900,
                          color: const Color(0xFF17172B),
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        unavailable
                            ? (errorMessage ??
                                  'ไม่สามารถตรวจสอบสถานะกะได้ กรุณาลองอีกครั้ง')
                            : (status?.message ??
                                  'มีกะของพนักงานคนอื่นกำลังใช้งานอยู่'),
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: const Color(0xFF6E6A7C),
                          height: 1.55,
                        ),
                      ),
                      if (shift != null) ...[
                        const SizedBox(height: 20),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF8F7FC),
                            borderRadius: BorderRadius.circular(18),
                            border: Border.all(color: const Color(0xFFE8E4F1)),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'กะที่กำลังใช้งาน #${shift.id}',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w800,
                                  color: Color(0xFF29263A),
                                ),
                              ),
                              const SizedBox(height: 8),
                              Text('ผู้เปิดกะ: ${shift.staffName}'),
                              const SizedBox(height: 4),
                              Text('เปิดเมื่อ: ${_openedAt(shift.openedAt)}'),
                              const SizedBox(height: 4),
                              Text(
                                'วันที่ตรวจตารางงาน: ${_workDate(status!.workDate)}',
                              ),
                            ],
                          ),
                        ),
                      ],
                      const SizedBox(height: 18),
                      Text(
                        '$staffName · $branchName',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: const Color(0xFF858194),
                        ),
                      ),
                      const SizedBox(height: 22),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton.icon(
                          onPressed: onRefresh,
                          icon: const Icon(Icons.refresh_rounded),
                          label: const Text('ตรวจสอบอีกครั้ง'),
                        ),
                      ),
                      const SizedBox(height: 10),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: onLogout,
                          icon: const Icon(Icons.logout_rounded),
                          label: const Text('ออกจากระบบ'),
                        ),
                      ),
                      if (!unavailable) ...[
                        const SizedBox(height: 16),
                        Text(
                          'หากคุณมีตารางงานวันนี้ ให้ผู้จัดการตรวจสอบตารางงานในระบบ',
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: const Color(0xFF858194),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
