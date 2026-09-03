import 'package:flutter/material.dart';
import '../models/camera_model.dart';

class CameraProvider extends ChangeNotifier {
  List<CameraModel> _cameras = [];
  String _searchQuery = '';
  CameraModel? _selectedCamera;

  List<CameraModel> get cameras {
    if (_searchQuery.isEmpty) return _cameras;
    return _cameras.where((c) =>
      c.name.toLowerCase().contains(_searchQuery.toLowerCase()) ||
      c.location.toLowerCase().contains(_searchQuery.toLowerCase()) ||
      c.id.toLowerCase().contains(_searchQuery.toLowerCase())
    ).toList();
  }

  CameraModel? get selectedCamera => _selectedCamera;
  int get totalCameras => _cameras.length;
  int get onlineCount => _cameras.where((c) => c.isOnline).length;
  int get offlineCount => _cameras.where((c) => !c.isOnline).length;

  CameraProvider() {
    _loadDefaultCameras();
  }

  void _loadDefaultCameras() {
    _cameras = [
      CameraModel(
        id: 'CAM-01',
        name: 'Main Gate Entrance',
        location: 'Hostel Gate A',
        isOnline: true,
        lastUpdate: 'Live',
        detectionCount: 3,
        lastDetectionType: 'Clear',
        confidence: 96.5,
      ),
      CameraModel(
        id: 'CAM-02',
        name: 'North Courtyard',
        location: 'Block B Outdoor',
        isOnline: true,
        lastUpdate: 'Live',
        detectionCount: 1,
        lastDetectionType: 'Motion Detected',
        confidence: 88.0,
      ),
      CameraModel(
        id: 'CAM-03',
        name: 'West Wing Corridor',
        location: 'Block A - 2nd Floor',
        isOnline: false,
        lastUpdate: '10 mins ago',
        detectionCount: 0,
        lastDetectionType: 'Offline',
        confidence: 0.0,
      ),
      CameraModel(
        id: 'CAM-04',
        name: 'Dining & Kitchen Zone',
        location: 'Mess Building Ground',
        isOnline: true,
        lastUpdate: 'Live',
        detectionCount: 5,
        lastDetectionType: 'Smoke Warning',
        confidence: 87.4,
      ),
    ];
    notifyListeners();
  }

  void setSearchQuery(String query) {
    _searchQuery = query;
    notifyListeners();
  }

  void selectCamera(CameraModel camera) {
    _selectedCamera = camera;
    notifyListeners();
  }
}
