import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../data/dashboard_repository.dart';
import '../domain/dashboard_summary.dart';

final dashboardRepositoryProvider = Provider<DashboardRepository>(
  (ref) => DashboardRepository(ref.watch(trpcClientProvider)),
);

final dashboardProvider = FutureProvider.autoDispose
    .family<DashboardSummary, int>((ref, branchId) {
      return ref.watch(dashboardRepositoryProvider).load(branchId);
    });
