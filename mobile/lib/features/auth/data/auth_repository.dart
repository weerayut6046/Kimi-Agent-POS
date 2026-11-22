import 'package:supabase_flutter/supabase_flutter.dart';
import '../../../core/network/trpc_client.dart';
import '../domain/staff_session.dart';
import '../domain/system_access_status.dart';

class AuthRepository {
  const AuthRepository({required this.supabase, required this.trpc});
  final SupabaseClient supabase;
  final TrpcClient trpc;
  bool get hasSession => supabase.auth.currentSession != null;
  Future<void> signIn({
    required String username,
    required String password,
  }) async {
    final normalized = username.trim().toLowerCase();
    if (!RegExp(r'^[a-z0-9][a-z0-9._-]{2,63}$').hasMatch(normalized)) {
      throw const FormatException('ชื่อผู้ใช้ไม่ถูกต้อง');
    }
    final refreshToken = await trpc.staffPinSession(normalized, password);
    await supabase.auth.setSession(refreshToken);
  }

  Future<StaffSession> currentStaff() async => StaffSession.fromJson(
    await trpc.query('auth.currentStaff') as Map<String, dynamic>,
  );
  Future<SystemAccessStatus> systemAccess({required int branchId}) async =>
      SystemAccessStatus.fromJson(
        await trpc.query('auth.systemAccess', branchId: branchId)
            as Map<String, dynamic>,
      );
  Future<void> signOut() => supabase.auth.signOut();
}
