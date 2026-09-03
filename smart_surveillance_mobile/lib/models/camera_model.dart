class CameraModel {
  final String id;
  final String name;
  final String location;
  final bool isOnline;
  final String lastUpdate;
  final String? streamUrl;
  final int detectionCount;
  final String lastDetectionType;
  final double confidence;

  CameraModel({
    required this.id,
    required this.name,
    required this.location,
    required this.isOnline,
    required this.lastUpdate,
    this.streamUrl,
    required this.detectionCount,
    required this.lastDetectionType,
    required this.confidence,
  });

  factory CameraModel.fromJson(Map<String, dynamic> json) {
    return CameraModel(
      id: json['id'] ?? json['cameraId'] ?? 'CAM-01',
      name: json['name'] ?? json['cameraName'] ?? 'Camera 01',
      location: json['location'] ?? 'Main Entrance',
      isOnline: json['isOnline'] ?? json['status'] == 'Online' ?? true,
      lastUpdate: json['lastUpdate'] ?? 'Live',
      streamUrl: json['streamUrl'],
      detectionCount: json['detectionCount'] ?? 0,
      lastDetectionType: json['lastDetectionType'] ?? 'Clear',
      confidence: (json['confidence'] ?? 0.0).toDouble(),
    );
  }
}
