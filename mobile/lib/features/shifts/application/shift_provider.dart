import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../../../core/realtime/branch_realtime.dart';
import '../data/shift_repository.dart';
import '../domain/shift_models.dart';

final shiftRepositoryProvider = Provider<ShiftRepository>((ref) {
  return ShiftRepository(ref.watch(trpcClientProvider));
});

final shiftBootstrapProvider = FutureProvider.autoDispose
    .family<ShiftBootstrap, int>((ref, branchId) {
      ref.watch(branchRealtimeRevisionProvider(branchId));
      return ref.watch(shiftRepositoryProvider).load(branchId);
    });
