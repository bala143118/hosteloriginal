class AlertModel {
  final String id;
  final String camera;
  final String location;
  final String type; // Fire, Smoke, Intrusion, Suspicious Activity
  final double confidence;
  final String timestamp;
  final String severity; // CRITICAL, HIGH, MEDIUM, LOW
  final bool isAcknowledged;
  final String? imageUrl;

  AlertModel({
    required this.id,
    required this.camera,
    required this.location,
    required this.type,
    required this.confidence,
    required this.timestamp,
    required this.severity,
    required this.isAcknowledged,
    this.imageUrl,
  });

  factory AlertModel.fromJson(Map<String, dynamic> json) {
    final String alertType = json['type'] ?? json['eventType'] ?? json['alertType'] ?? 'Fire/Smoke';
    
    String sev = json['severity'] ?? 'HIGH';
    if (alertType.toLowerCase().contains('fire')) {
      sev = 'CRITICAL';
    } else if (alertType.toLowerCase().contains('smoke')) {
      sev = 'HIGH';
    }

    double conf = 85.0;
    if (json['confidence'] != null) {
      final c = json['confidence'];
      conf = c is num ? (c <= 1 ? c * 100 : c.toDouble()) : double.tryParse(c.toString()) ?? 85.0;
    }

    return AlertModel(
      id: json['id'] ?? 'ALERT-${DateTime.now().millisecondsSinceEpoch}',
      camera: json['camera'] ?? json['cameraName'] ?? 'Camera 01',
      location: json['location'] ?? 'Hostel Entrance',
      type: alertType,
      confidence: conf,
      timestamp: json['timestamp'] ?? DateTime.now().toIso8601String(),
      severity: sev,
      isAcknowledged: json['acknowledged'] ?? json['isAcknowledged'] ?? false,
      imageUrl: json['imageUrl'] ?? json['frameBase64'],
    );
  }

  AlertModel copyWith({bool? isAcknowledged}) {
    return AlertModel(
      id: id,
      camera: camera,
      location: location,
      type: type,
      confidence: confidence,
      timestamp: timestamp,
      severity: severity,
      isAcknowledged: isAcknowledged ?? this.isAcknowledged,
      imageUrl: imageUrl,
    );
  }
}
