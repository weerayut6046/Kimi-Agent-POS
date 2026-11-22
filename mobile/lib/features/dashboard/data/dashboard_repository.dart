import '../../../core/network/trpc_client.dart';
import '../domain/dashboard_summary.dart';

class DashboardRepository {
  const DashboardRepository(this.client);
  final TrpcClient client;
  Future<DashboardSummary> load(int branchId) async =>
      DashboardSummary.fromJson(
        await client.query('pos.dashboard', branchId: branchId)
            as Map<String, dynamic>,
      );
}
