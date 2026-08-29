import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../shell/presentation/app_shell.dart';
import '../application/auth_controller.dart';
import '../domain/staff_session.dart';
import 'auth_error_message.dart';
import 'login_page.dart';
import 'shift_access_blocked_page.dart';

class AuthGate extends ConsumerWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    return auth.when(
      data: (staff) =>
          staff == null ? const LoginPage() : _SystemAccessGate(staff: staff),
      loading: () => const _AuthLoadingPage(),
      error: (error, _) =>
          LoginPage(errorMessage: friendlyAuthErrorMessage(error)),
    );
  }
}

class _SystemAccessGate extends ConsumerWidget {
  const _SystemAccessGate({required this.staff});

  final StaffSession staff;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final access = ref.watch(systemAccessProvider(staff.branch.id));
    return access.when(
      data: (status) {
        if (status.allowed) return AppShell(staff: staff);
        return ShiftAccessBlockedPage(
          staffName: staff.name,
          branchName: staff.branch.name,
          status: status,
          onRefresh: () =>
              ref.invalidate(systemAccessProvider(staff.branch.id)),
          onLogout: () =>
              unawaited(ref.read(authControllerProvider.notifier).signOut()),
        );
      },
      loading: () => const _AuthLoadingPage(),
      error: (error, _) => ShiftAccessBlockedPage(
        staffName: staff.name,
        branchName: staff.branch.name,
        errorMessage: friendlyAuthErrorMessage(error),
        onRefresh: () => ref.invalidate(systemAccessProvider(staff.branch.id)),
        onLogout: () =>
            unawaited(ref.read(authControllerProvider.notifier).signOut()),
      ),
    );
  }
}

class _AuthLoadingPage extends StatelessWidget {
  const _AuthLoadingPage();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 28,
              height: 28,
              child: CircularProgressIndicator(strokeWidth: 3),
            ),
            SizedBox(height: 16),
            Text('กำลังเตรียม PumpPOS...'),
          ],
        ),
      ),
    );
  }
}
