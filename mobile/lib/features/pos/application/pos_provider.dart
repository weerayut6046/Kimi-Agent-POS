import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../../../core/realtime/branch_realtime.dart';
import '../data/pos_repository.dart';
import '../domain/pos_models.dart';

final posRepositoryProvider = Provider<PosRepository>((ref) {
  return PosRepository(ref.watch(trpcClientProvider));
});

final posBootstrapProvider = FutureProvider.autoDispose
    .family<PosBootstrap, int>((ref, branchId) {
      ref.watch(branchRealtimeRevisionProvider(branchId));
      return ref.watch(posRepositoryProvider).load(branchId);
    });
