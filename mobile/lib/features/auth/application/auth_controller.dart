import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../core/providers.dart';
import '../data/auth_repository.dart';
import '../domain/staff_session.dart';

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(
    supabase: Supabase.instance.client,
    trpc: ref.watch(trpcClientProvider),
  );
});

final authControllerProvider =
    AsyncNotifierProvider<AuthController, StaffSession?>(AuthController.new);

class AuthController extends AsyncNotifier<StaffSession?> {
  @override
  Future<StaffSession?> build() async {
    final repository = ref.watch(authRepositoryProvider);
    if (!repository.hasSession) return null;
    try {
      return await repository.currentStaff();
    } catch (_) {
      await repository.signOut();
      return null;
    }
  }

  Future<void> signIn({
    required String username,
    required String password,
  }) async {
    state = await AsyncValue.guard(() async {
      final repository = ref.read(authRepositoryProvider);
      try {
        await repository.signIn(username: username, password: password);
        return await repository.currentStaff();
      } catch (_) {
        await repository.signOut();
        rethrow;
      }
    });
  }

  Future<void> signOut() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      await ref.read(authRepositoryProvider).signOut();
      return null;
    });
  }
}
