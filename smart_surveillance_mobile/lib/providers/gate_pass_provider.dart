import 'package:flutter/material.dart';
import '../models/gate_pass_model.dart';
import '../services/api_service.dart';

class GatePassProvider extends ChangeNotifier {
  final ApiService _apiService;
  List<GatePassModel> _passes = [];
  bool _isLoading = false;
  String _selectedFilter = 'All';

  List<GatePassModel> get passes {
    if (_selectedFilter == 'All') return _passes;
    return _passes.where((p) => p.status.toLowerCase() == _selectedFilter.toLowerCase()).toList();
  }

  int get pendingCount => _passes.where((p) => p.status.toLowerCase() == 'pending').length;
  int get approvedCount => _passes.where((p) => p.status.toLowerCase() == 'approved').length;
  bool get isLoading => _isLoading;
  String get selectedFilter => _selectedFilter;

  GatePassProvider(this._apiService) {
    loadGatePasses();
  }

  Future<void> loadGatePasses([String? token]) async {
    _isLoading = true;
    notifyListeners();

    final List<GatePassModel> fetched = await _apiService.fetchGatePasses(token);
    _isLoading = false;

    if (fetched.isNotEmpty) {
      _passes = fetched;
    } else {
      // Demo gate passes
      _passes = [
        GatePassModel(
          id: 'GP-101',
          studentId: 'STU-2024-089',
          studentName: 'Sabitha Student',
          roomNumber: 'A-204',
          block: 'Block A',
          passType: 'Outing',
          reason: 'Library & Project Research',
          outTime: DateTime.now().subtract(const Duration(hours: 2)).toIso8601String(),
          inTime: DateTime.now().add(const Duration(hours: 3)).toIso8601String(),
          status: 'Approved',
          approvedBy: 'Warden Ramesh',
          createdAt: DateTime.now().subtract(const Duration(hours: 3)).toIso8601String(),
        ),
        GatePassModel(
          id: 'GP-102',
          studentId: 'STU-2024-112',
          studentName: 'Kavitha S.',
          roomNumber: 'B-105',
          block: 'Block B',
          passType: 'Home Leave',
          reason: 'Weekend Family Function',
          outTime: DateTime.now().add(const Duration(hours: 18)).toIso8601String(),
          inTime: DateTime.now().add(const Duration(days: 3)).toIso8601String(),
          status: 'Pending',
          createdAt: DateTime.now().subtract(const Duration(hours: 1)).toIso8601String(),
        ),
      ];
    }
    notifyListeners();
  }

  void setFilter(String filter) {
    _selectedFilter = filter;
    notifyListeners();
  }

  Future<bool> createPass({
    required String passType,
    required String reason,
    required String outTime,
    required String inTime,
    String? token,
  }) async {
    final newPass = GatePassModel(
      id: 'GP-${DateTime.now().millisecondsSinceEpoch.toString().substring(7)}',
      studentId: 'STU-ME-01',
      studentName: 'Sabitha Student',
      roomNumber: 'A-204',
      block: 'Block A',
      passType: passType,
      reason: reason,
      outTime: outTime,
      inTime: inTime,
      status: 'Pending',
      createdAt: DateTime.now().toIso8601String(),
    );

    _passes.insert(0, newPass);
    notifyListeners();
    await _apiService.requestGatePass(
      passType: passType,
      reason: reason,
      outTime: outTime,
      inTime: inTime,
      token: token,
    );
    return true;
  }

  Future<void> approvePass(String id, [String? token]) async {
    final idx = _passes.indexWhere((p) => p.id == id);
    if (idx != -1) {
      _passes[idx] = GatePassModel(
        id: _passes[idx].id,
        studentId: _passes[idx].studentId,
        studentName: _passes[idx].studentName,
        roomNumber: _passes[idx].roomNumber,
        block: _passes[idx].block,
        passType: _passes[idx].passType,
        reason: _passes[idx].reason,
        outTime: _passes[idx].outTime,
        inTime: _passes[idx].inTime,
        status: 'Approved',
        approvedBy: 'Warden Admin',
        createdAt: _passes[idx].createdAt,
      );
      notifyListeners();
      await _apiService.approveGatePass(id, token);
    }
  }
}
