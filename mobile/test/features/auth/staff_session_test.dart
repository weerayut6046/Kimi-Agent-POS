import 'package:flutter_test/flutter_test.dart';
import 'package:pumppos/features/auth/domain/staff_session.dart';

void main() {
  test('parses the authenticated staff profile and permissions', () {
    final staff = StaffSession.fromJson({
      'id': 12,
      'name': 'ผู้จัดการสถานี',
      'username': 'manager',
      'role': 'manager',
      'menuPermissions': ['dashboard', 'pos', 'reports'],
      'branch': _branchJson,
      'branches': [_branchJson],
    });

    expect(staff.role, StaffRole.manager);
    expect(staff.branch.id, 3);
    expect(staff.can('dashboard'), isTrue);
    expect(staff.can('settings'), isFalse);
  });

  test('rejects unknown staff roles', () {
    expect(
      () => StaffSession.fromJson({
        'id': 12,
        'name': 'Unknown',
        'username': 'unknown',
        'role': 'owner',
        'menuPermissions': <String>[],
        'branch': _branchJson,
        'branches': [_branchJson],
      }),
      throwsFormatException,
    );
  });
}

const _branchJson = <String, Object>{
  'id': 3,
  'code': 'BKK-01',
  'name': 'สถานีทดสอบ',
  'address': 'กรุงเทพฯ',
  'phone': '020000000',
  'taxId': '0100000000000',
  'active': true,
};
