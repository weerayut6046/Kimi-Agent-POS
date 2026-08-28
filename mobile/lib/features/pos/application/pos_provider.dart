import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../data/pos_repository.dart';
import '../domain/pos_models.dart';

final posRepositoryProvider = Provider<PosRepository>((ref) {
  return PosRepository(ref.watch(trpcClientProvider));
});

final posBootstrapProvider = FutureProvider.family<PosBootstrap, int>((
  ref,
  branchId,
) {
  return ref.watch(posRepositoryProvider).load(branchId);
});
