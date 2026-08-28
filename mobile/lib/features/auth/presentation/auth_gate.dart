import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../shell/presentation/app_shell.dart';
import '../application/auth_controller.dart';
import 'auth_error_message.dart';
import 'login_page.dart';

class AuthGate extends ConsumerWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    return auth.when(
      data: (staff) =>
          staff == null ? const LoginPage() : AppShell(staff: staff),
      loading: () => const _AuthLoadingPage(),
      error: (error, _) =>
          LoginPage(errorMessage: friendlyAuthErrorMessage(error)),
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
