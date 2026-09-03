import 'package:flutter/material.dart';
import '../models/alert_model.dart';
import '../services/api_service.dart';
import '../services/socket_service.dart';

class AlertProvider extends ChangeNotifier {
  final ApiService _apiService;
  final SocketService _socketService;

  List<AlertModel> _alerts = [];
  bool _isLoading = false;
  String _selectedFilter = 'All';

  List<AlertModel> get alerts {
    if (_selectedFilter == 'All') return _alerts;
    if (_selectedFilter == 'Unread') return _alerts.where((a) => !a.isAcknowledged).toList();
    if (_selectedFilter == 'Critical') return _alerts.where((a) => a.severity == 'CRITICAL').toList();
    return _alerts.where((a) => a.type.toLowerCase().contains(_selectedFilter.toLowerCase())).toList();
  }

  int get unreadCount => _alerts.where((a) => !a.isAcknowledged).length;
  bool get isLoading => _isLoading;
  String get selectedFilter => _selectedFilter;

  AlertProvider(this._apiService, this._socketService) {
    _initSocketAlerts();
    loadAlerts();
  }

  void _initSocketAlerts() {
    _socketService.alertStream.listen((data) {
      final AlertModel newAlert = AlertModel.fromJson(data);
      _alerts.insert(0, newAlert);
      notifyListeners();
    });
  }

  Future<void> loadAlerts([String? token]) async {
    _isLoading = true;
    notifyListeners();

    final List<AlertModel> history = await _apiService.fetchAlertHistory(token);
    _isLoading = false;

    if (history.isNotEmpty) {
      _alerts = history;
    } else {
      // Demo default alerts if backend history is empty
      _alerts = [
        AlertModel(
          id: 'ALERT-101',
          camera: 'Camera 04 - Mess Kitchen',
          location: 'Mess Building Ground Floor',
          type: 'Smoke Detected',
          confidence: 87.5,
          timestamp: DateTime.now().subtract(const Duration(minutes: 8)).toIso8601String(),
          severity: 'HIGH',
          isAcknowledged: false,
        ),
        AlertModel(
          id: 'ALERT-102',
          camera: 'Camera 01 - Main Gate',
          location: 'Main Hostel Entrance',
          type: 'Unrecognized Face',
          confidence: 78.0,
          timestamp: DateTime.now().subtract(const Duration(minutes: 35)).toIso8601String(),
          severity: 'MEDIUM',
          isAcknowledged: true,
        ),
        AlertModel(
          id: 'ALERT-103',
          camera: 'Camera 02 - North Courtyard',
          location: 'Block B Outdoor Area',
          type: 'Intrusion After Hours',
          confidence: 94.2,
          timestamp: DateTime.now().subtract(const Duration(hours: 2)).toIso8601String(),
          severity: 'CRITICAL',
          isAcknowledged: false,
        ),
      ];
    }
    notifyListeners();
  }

  void setFilter(String filter) {
    _selectedFilter = filter;
    notifyListeners();
  }

  Future<void> acknowledgeAlert(String id, [String? token]) async {
    final int index = _alerts.indexWhere((a) => a.id == id);
    if (index != -1) {
      _alerts[index] = _alerts[index].copyWith(isAcknowledged: true);
      notifyListeners();
      await _apiService.acknowledgeEvent(id, token);
    }
  }

  Future<bool> triggerTestAlert(String type, String cameraName) async {
    final bool success = await _apiService.sendAlert(
      cameraName: cameraName,
      location: 'Block A Patrol Zone',
      type: type,
      confidence: 91.5,
    );
    if (success) {
      await loadAlerts();
    }
    return success;
  }
}
