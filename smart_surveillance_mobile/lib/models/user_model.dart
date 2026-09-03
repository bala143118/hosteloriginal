class UserModel {
  final String userId;
  final String name;
  final String email;
  final String role;
  final String? token;

  UserModel({
    required this.userId,
    required this.name,
    required this.email,
    required this.role,
    this.token,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      userId: json['userId'] ?? json['id'] ?? 'USR-001',
      name: json['name'] ?? 'Security Officer',
      email: json['email'] ?? 'admin@hostelfix.edu',
      role: json['role'] ?? 'admin',
      token: json['token'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'userId': userId,
      'name': name,
      'email': email,
      'role': role,
      'token': token,
    };
  }
}
