enum StaffRole { admin, manager, cashier }

class BranchSummary {
  const BranchSummary({
    required this.id,
    required this.code,
    required this.name,
    required this.address,
    required this.phone,
    required this.taxId,
    required this.active,
  });

  factory BranchSummary.fromJson(Map<String, dynamic> json) {
    return BranchSummary(
      id: _requiredInt(json, 'id'),
      code: _requiredString(json, 'code'),
      name: _requiredString(json, 'name'),
      address: _requiredString(json, 'address'),
      phone: _requiredString(json, 'phone'),
      taxId: _requiredString(json, 'taxId'),
      active: json['active'] == true,
    );
  }

  final int id;
  final String code;
  final String name;
  final String address;
  final String phone;
  final String taxId;
  final bool active;
}

class StaffSession {
  const StaffSession({
    required this.id,
    required this.name,
    required this.username,
    required this.role,
    required this.menuPermissions,
    required this.branch,
    required this.branches,
  });

  factory StaffSession.fromJson(Map<String, dynamic> json) {
    final roleName = _requiredString(json, 'role');
    StaffRole? role;
    for (final item in StaffRole.values) {
      if (item.name == roleName) role = item;
    }
    if (role == null) throw const FormatException('Unknown staff role');

    final branchJson = json['branch'];
    if (branchJson is! Map<String, dynamic>) {
      throw const FormatException('Invalid staff branch');
    }
    final branchesJson = json['branches'];
    if (branchesJson is! List<dynamic>) {
      throw const FormatException('Invalid staff branches');
    }
    final permissionsJson = json['menuPermissions'];
    if (permissionsJson is! List<dynamic>) {
      throw const FormatException('Invalid menu permissions');
    }

    return StaffSession(
      id: _requiredInt(json, 'id'),
      name: _requiredString(json, 'name'),
      username: _requiredString(json, 'username'),
      role: role,
      menuPermissions: Set<String>.unmodifiable(
        permissionsJson.whereType<String>(),
      ),
      branch: BranchSummary.fromJson(branchJson),
      branches: List<BranchSummary>.unmodifiable(
        branchesJson.map((item) {
          if (item is! Map<String, dynamic>) {
            throw const FormatException('Invalid branch item');
          }
          return BranchSummary.fromJson(item);
        }),
      ),
    );
  }

  final int id;
  final String name;
  final String username;
  final StaffRole role;
  final Set<String> menuPermissions;
  final BranchSummary branch;
  final List<BranchSummary> branches;

  bool can(String permission) => menuPermissions.contains(permission);
}

int _requiredInt(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is int) return value;
  if (value is num) return value.toInt();
  throw FormatException('Invalid $key');
}

String _requiredString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is String) return value;
  throw FormatException('Invalid $key');
}
