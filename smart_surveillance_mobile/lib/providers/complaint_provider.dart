import 'package:flutter/material.dart';
import '../models/complaint_model.dart';
import '../services/api_service.dart';

class ComplaintProvider extends ChangeNotifier {
  final ApiService _apiService;
  List<ComplaintModel> _complaints = [];
  bool _isLoading = false;

  List<ComplaintModel> get complaints => _complaints;
  int get pendingCount => _complaints.where((c) => c.status.toLowerCase() == 'pending').length;
  bool get isLoading => _isLoading;

  ComplaintProvider(this._apiService) {
    loadComplaints();
  }

  Future<void> loadComplaints([String? token]) async {
    _isLoading = true;
    notifyListeners();

    final List<ComplaintModel> fetched = await _apiService.fetchComplaints(token);
    _isLoading = false;

    if (fetched.isNotEmpty) {
      _complaints = fetched;
    } else {
      // Demo complaints
      _complaints = [
        ComplaintModel(
          id: 'CMP-101',
          title: 'Wi-Fi Speed & Connection Drop',
          description: 'High packet loss in Block A 2nd floor rooms during peak hours.',
          category: 'Wi-Fi / Internet',
          status: 'In Progress',
          studentName: 'Sabitha Student',
          roomNumber: 'A-204',
          createdAt: DateTime.now().subtract(const Duration(hours: 5)).toIso8601String(),
        ),
        ComplaintModel(
          id: 'CMP-102',
          title: 'Bathroom Water Leakage',
          description: 'Tap in room B-105 is leaking constantly.',
          category: 'Plumbing',
          status: 'Pending',
          studentName: 'Kavitha S.',
          roomNumber: 'B-105',
          createdAt: DateTime.now().subtract(const Duration(hours: 20)).toIso8601String(),
        ),
      ];
    }
    notifyListeners();
  }

  Future<bool> fileComplaint({
    required String title,
    required String description,
    required String category,
    String? token,
  }) async {
    final newComplaint = ComplaintModel(
      id: 'CMP-${DateTime.now().millisecondsSinceEpoch.toString().substring(7)}',
      title: title,
      description: description,
      category: category,
      status: 'Pending',
      studentName: 'Sabitha Student',
      roomNumber: 'A-204',
      createdAt: DateTime.now().toIso8601String(),
    );

    _complaints.insert(0, newComplaint);
    notifyListeners();
    await _apiService.fileComplaint(title: title, description: description, category: category, token: token);
    return true;
  }
}
