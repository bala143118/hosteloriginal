class DetectionModel {
  final String label;
  final double confidence;
  final String timestamp;
  final String cameraName;
  final String? boundingBox;

  DetectionModel({
    required this.label,
    required this.confidence,
    required this.timestamp,
    required this.cameraName,
    this.boundingBox,
  });

  factory DetectionModel.fromJson(Map<String, dynamic> json) {
    double conf = 85.0;
    if (json['confidence'] != null) {
      final c = json['confidence'];
      conf = c is num ? (c <= 1 ? c * 100 : c.toDouble()) : 85.0;
    }

    return DetectionModel(
      label: json['label'] ?? json['class'] ?? 'Object Detected',
      confidence: conf,
      timestamp: json['timestamp'] ?? DateTime.now().toIso8601String(),
      cameraName: json['cameraName'] ?? json['camera'] ?? 'Camera 01',
      boundingBox: json['box']?.toString(),
    );
  }
}
