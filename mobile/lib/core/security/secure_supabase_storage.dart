import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class SecureSupabaseStorage extends LocalStorage {
  SecureSupabaseStorage({FlutterSecureStorage? storage})
    : _storage =
          storage ??
          const FlutterSecureStorage(
            aOptions: AndroidOptions(
              migrateWithBackup: true,
              storageNamespace: 'pumppos_auth',
            ),
            iOptions: IOSOptions(
              accessibility: KeychainAccessibility.unlocked_this_device,
              synchronizable: false,
              accountName: 'com.kimiagent.pos.auth',
            ),
          );

  static const _sessionKey = 'pumppos_supabase_session_v1';
  final FlutterSecureStorage _storage;

  @override
  Future<void> initialize() async {
    // The platform-backed storage initializes lazily on first access.
  }

  @override
  Future<bool> hasAccessToken() => _storage.containsKey(key: _sessionKey);

  @override
  Future<String?> accessToken() => _storage.read(key: _sessionKey);

  @override
  Future<void> persistSession(String persistSessionString) =>
      _storage.write(key: _sessionKey, value: persistSessionString);

  @override
  Future<void> removePersistedSession() => _storage.delete(key: _sessionKey);
}
