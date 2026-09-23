class AppConfig {
  static const String baseUrl = 'https://demeanor-alongside-lyricist.ngrok-free.dev';
  static const String appName = 'Smart Surveillance';
  static const String appSubtitle = 'AI-Powered Security Monitoring';
  static const String appVersion = '1.0.0+1';
  static const int apiTimeoutSeconds = 12;

  // Endpoint routes
  static String get summaryUrl => '$baseUrl/api/summary';
  static String get loginUrl => '$baseUrl/api/login';
  static String get alertHistoryUrl => '$baseUrl/api/alert-history';
  static String get sendAlertUrl => '$baseUrl/api/send-telegram-alert';
  static String get securityEventsUrl => '$baseUrl/api/security-events';
  static String get cctvInferenceUrl => '$baseUrl/api/cctv-inference';
  static String get faceAuthInferenceUrl => '$baseUrl/api/face-auth-inference';
  static String get adminSettingsUrl => '$baseUrl/api/admin-settings';
  static String get telegramStatusUrl => '$baseUrl/api/telegram-status';
}
