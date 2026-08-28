import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../data/shift_repository.dart';
import '../domain/shift_models.dart';

final shiftRepositoryProvider = Provider<ShiftRepository>((ref) {
  return ShiftRepository(ref.watch(trpcClientProvider));
});

final shiftBootstrapProvider = FutureProvider.family<ShiftBootstrap, int>((
  ref,
  branchId,
) {
  return ref.watch(shiftRepositoryProvider).load(branchId);
});
