import 'package:flutter/material.dart';
import '../models/system_status_model.dart';
import '../services/api_service.dart';
import '../services/socket_service.dart';
import '../utils/constants.dart';

class DashboardProvider extends ChangeNotifier {
  final ApiService _apiService;
  final SocketService _socketService;

  SystemStatusModel _status = SystemStatusModel.initial();
  ConnectionStatus _connectionStatus = ConnectionStatus.connecting;
  bool _isLoading = false;
  DateTime? _lastSyncTime;

  SystemStatusModel get status => _status;
  ConnectionStatus get connectionStatus => _connectionStatus;
  bool get isLoading => _isLoading;
  DateTime? get lastSyncTime => _lastSyncTime;

  DashboardProvider(this._apiService, this._socketService) {
    _initSocketListener();
    refreshDashboard();
  }

  void _initSocketListener() {
    _socketService.connectionStream.listen((isConnected) {
      if (isConnected) {
        _connectionStatus = ConnectionStatus.connected;
      } else {
        _connectionStatus = ConnectionStatus.disconnected;
      }
      notifyListeners();
    });
  }

  Future<void> refreshDashboard([String? token]) async {
    _isLoading = true;
    _connectionStatus = ConnectionStatus.connecting;
    notifyListeners();

    final isHealthy = await _apiService.testConnection();
    if (!isHealthy) {
      _connectionStatus = ConnectionStatus.disconnected;
      _isLoading = false;
      notifyListeners();
      return;
    }

    final summary = await _apiService.fetchSummary(token);
    _isLoading = false;
    _lastSyncTime = DateTime.now();

    if (summary != null) {
      _status = summary;
      _connectionStatus = ConnectionStatus.connected;
    } else {
      _connectionStatus = ConnectionStatus.error;
    }
    notifyListeners();
  }
}
