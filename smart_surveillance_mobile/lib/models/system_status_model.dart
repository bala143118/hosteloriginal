import '../utils/constants.dart';

class SystemStatusModel {
  final int totalCameras;
  final int onlineCameras;
  final int offlineCameras;
  final int activeAlerts;
  final int totalDetections;
  final SecurityRiskLevel riskLevel;
  final bool isBackendHealthy;

  SystemStatusModel({
    required this.totalCameras,
    required this.onlineCameras,
    required this.offlineCameras,
    required this.activeAlerts,
    required this.totalDetections,
    required this.riskLevel,
    required this.isBackendHealthy,
  });

  factory SystemStatusModel.fromJson(Map<String, dynamic> json) {
    final int activeCount = json['activeAlerts'] ?? json['unacknowledged'] ?? 0;
    
    SecurityRiskLevel computedRisk = SecurityRiskLevel.safe;
    if (activeCount > 5) {
      computedRisk = SecurityRiskLevel.critical;
    } else if (activeCount > 3) {
      computedRisk = SecurityRiskLevel.high;
    } else if (activeCount > 1) {
      computedRisk = SecurityRiskLevel.medium;
    } else if (activeCount == 1) {
      computedRisk = SecurityRiskLevel.low;
    }

    final int totalCams = json['totalCameras'] ?? 4;
    final int onlineCams = json['onlineCameras'] ?? 4;

    return SystemStatusModel(
      totalCameras: totalCams,
      onlineCameras: onlineCams,
      offlineCameras: json['offlineCameras'] ?? (totalCams - onlineCams),
      activeAlerts: activeCount,
      totalDetections: json['totalDetections'] ?? json['total'] ?? 12,
      riskLevel: computedRisk,
      isBackendHealthy: true,
    );
  }

  factory SystemStatusModel.initial() {
    return SystemStatusModel(
      totalCameras: 4,
      onlineCameras: 4,
      offlineCameras: 0,
      activeAlerts: 0,
      totalDetections: 0,
      riskLevel: SecurityRiskLevel.safe,
      isBackendHealthy: false,
    );
  }
}
