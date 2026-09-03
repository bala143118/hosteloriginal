import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/user_model.dart';
import '../services/api_service.dart';

class AuthProvider extends ChangeNotifier {
  final ApiService _apiService;

  UserModel? _user;
  bool _isLoading = false;
  String? _errorMessage;

  UserModel? get user => _user;
  bool get isAuthenticated => _user != null;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;

  AuthProvider(this._apiService) {
    _loadStoredUser();
  }

  Future<void> _loadStoredUser() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('jwt_token');
      final email = prefs.getString('user_email');
      final name = prefs.getString('user_name');
      final role = prefs.getString('user_role');
      final userId = prefs.getString('user_id');

      if (token != null && email != null) {
        _user = UserModel(
          userId: userId ?? 'USR-001',
          name: name ?? 'Security Officer',
          email: email,
          role: role ?? 'admin',
          token: token,
        );
        notifyListeners();
      }
    } catch (_) {}
  }

  Future<bool> login(String email, String password, String role) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    final result = await _apiService.login(email, password, role);

    _isLoading = false;
    if (result['success'] == true) {
      final Map<String, dynamic> data = result['data'];
      _user = UserModel.fromJson(data);

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('jwt_token', _user?.token ?? 'demo_token');
      await prefs.setString('user_email', _user?.email ?? email);
      await prefs.setString('user_name', _user?.name ?? 'Security Officer');
      await prefs.setString('user_role', _user?.role ?? role);
      await prefs.setString('user_id', _user?.userId ?? 'USR-001');

      notifyListeners();
      return true;
    } else {
      _errorMessage = result['error'];
      notifyListeners();
      return false;
    }
  }

  Future<bool> register({
    required String name,
    required String email,
    required String password,
    required String role,
    String? roomNumber,
    String? hostelBlock,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    final result = await _apiService.register(
      name: name,
      email: email,
      password: password,
      role: role,
      roomNumber: roomNumber,
      hostelBlock: hostelBlock,
    );

    _isLoading = false;
    if (result['success'] == true) {
      final Map<String, dynamic> data = result['data'];
      _user = UserModel.fromJson(data);

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('jwt_token', _user?.token ?? 'demo_token');
      await prefs.setString('user_email', _user?.email ?? email);
      await prefs.setString('user_name', _user?.name ?? name);
      await prefs.setString('user_role', _user?.role ?? role);
      await prefs.setString('user_id', _user?.userId ?? 'USR-001');

      notifyListeners();
      return true;
    } else {
      _errorMessage = result['error'];
      notifyListeners();
      return false;
    }
  }

  void setDemoUser() {
    _user = UserModel(
      userId: 'DEMO-001',
      name: 'Sabitha Officer',
      email: 'sabitha@gmail.com',
      role: 'admin',
      token: 'demo_token_xyz',
    );
    _errorMessage = null;
    notifyListeners();
  }

  Future<void> logout() async {
    _user = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
    notifyListeners();
  }
}
