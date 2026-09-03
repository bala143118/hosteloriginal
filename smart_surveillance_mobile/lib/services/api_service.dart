import 'dart:convert';
import 'dart:async';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';
import '../models/alert_model.dart';
import '../models/system_status_model.dart';
import '../models/gate_pass_model.dart';
import '../models/announcement_model.dart';
import '../models/complaint_model.dart';

class ApiService {
  final http.Client _client = http.Client();

  Map<String, String> _headers([String? token]) {
    final Map<String, String> h = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (token != null && token.isNotEmpty) {
      h['Authorization'] = 'Bearer $token';
    }
    return h;
  }

  // 1. Connection Health Check
  Future<bool> testConnection() async {
    try {
      final response = await _client
          .get(Uri.parse(AppConfig.summaryUrl))
          .timeout(const Duration(seconds: AppConfig.apiTimeoutSeconds));
      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  // 2. Authentication Login
  Future<Map<String, dynamic>> login(String email, String password, String role) async {
    try {
      final response = await _client
          .post(
            Uri.parse(AppConfig.loginUrl),
            headers: _headers(),
            body: jsonEncode({
              'email': email.trim(),
              'password': password,
              'role': role.trim().toLowerCase(),
            }),
          )
          .timeout(const Duration(seconds: AppConfig.apiTimeoutSeconds));

      final Map<String, dynamic> data = jsonDecode(response.body);
      if (response.statusCode == 200) {
        return {'success': true, 'data': data};
      } else {
        return {'success': false, 'error': data['error'] ?? 'Authentication failed'};
      }
    } catch (e) {
      return {'success': false, 'error': 'Unable to connect to Smart Surveillance server'};
    }
  }

  // 2b. User Registration
  Future<Map<String, dynamic>> register({
    required String name,
    required String email,
    required String password,
    required String role,
    String? roomNumber,
    String? hostelBlock,
  }) async {
    try {
      final response = await _client
          .post(
            Uri.parse('${AppConfig.baseUrl}/api/register'),
            headers: _headers(),
            body: jsonEncode({
              'name': name.trim(),
              'email': email.trim(),
              'password': password,
              'role': role.trim().toLowerCase(),
              'roomNumber': roomNumber ?? '101',
              'hostelBlock': hostelBlock ?? 'Block A',
            }),
          )
          .timeout(const Duration(seconds: AppConfig.apiTimeoutSeconds));

      final Map<String, dynamic> data = jsonDecode(response.body);
      if (response.statusCode == 200 || response.statusCode == 201) {
        return {'success': true, 'data': data};
      } else {
        return {'success': false, 'error': data['error'] ?? 'Registration failed.'};
      }
    } catch (e) {
      return {'success': false, 'error': 'Unable to connect to Smart Surveillance server'};
    }
  }

  // 3. System Summary & Metrics
  Future<SystemStatusModel?> fetchSummary([String? token]) async {
    try {
      final response = await _client
          .get(Uri.parse(AppConfig.summaryUrl), headers: _headers(token))
          .timeout(const Duration(seconds: AppConfig.apiTimeoutSeconds));

      if (response.statusCode == 200) {
        final Map<String, dynamic> json = jsonDecode(response.body);
        return SystemStatusModel.fromJson(json);
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  // 4. Alert History
  Future<List<AlertModel>> fetchAlertHistory([String? token]) async {
    try {
      final response = await _client
          .get(Uri.parse(AppConfig.alertHistoryUrl), headers: _headers(token))
          .timeout(const Duration(seconds: AppConfig.apiTimeoutSeconds));

      if (response.statusCode == 200) {
        final List<dynamic> list = jsonDecode(response.body);
        return list.map((item) => AlertModel.fromJson(item)).toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  // 5. Gate Passes
  Future<List<GatePassModel>> fetchGatePasses([String? token]) async {
    try {
      final response = await _client
          .get(Uri.parse('${AppConfig.baseUrl}/api/gate-passes'), headers: _headers(token))
          .timeout(const Duration(seconds: AppConfig.apiTimeoutSeconds));

      if (response.statusCode == 200) {
        final List<dynamic> list = jsonDecode(response.body);
        return list.map((item) => GatePassModel.fromJson(item)).toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  Future<bool> requestGatePass({
    required String passType,
    required String reason,
    required String outTime,
    required String inTime,
    String? token,
  }) async {
    try {
      final response = await _client
          .post(
            Uri.parse('${AppConfig.baseUrl}/api/gate-passes'),
            headers: _headers(token),
            body: jsonEncode({
              'passType': passType,
              'reason': reason,
              'outTime': outTime,
              'inTime': inTime,
            }),
          )
          .timeout(const Duration(seconds: AppConfig.apiTimeoutSeconds));

      return response.statusCode == 200 || response.statusCode == 201;
    } catch (_) {
      return false;
    }
  }

  Future<bool> approveGatePass(String passId, [String? token]) async {
    try {
      final response = await _client
          .post(
            Uri.parse('${AppConfig.baseUrl}/api/gatepass/approve'),
            headers: _headers(token),
            body: jsonEncode({'id': passId, 'status': 'Approved'}),
          )
          .timeout(const Duration(seconds: AppConfig.apiTimeoutSeconds));

      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  // 6. Announcements
  Future<List<AnnouncementModel>> fetchAnnouncements([String? token]) async {
    try {
      final response = await _client
          .get(Uri.parse('${AppConfig.baseUrl}/api/announcements'), headers: _headers(token))
          .timeout(const Duration(seconds: AppConfig.apiTimeoutSeconds));

      if (response.statusCode == 200) {
        final List<dynamic> list = jsonDecode(response.body);
        return list.map((item) => AnnouncementModel.fromJson(item)).toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  Future<bool> postAnnouncement({
    required String title,
    required String content,
    required String category,
    String? token,
  }) async {
    try {
      final response = await _client
          .post(
            Uri.parse('${AppConfig.baseUrl}/api/announcements'),
            headers: _headers(token),
            body: jsonEncode({
              'title': title,
              'content': content,
              'category': category,
            }),
          )
          .timeout(const Duration(seconds: AppConfig.apiTimeoutSeconds));

      return response.statusCode == 200 || response.statusCode == 201;
    } catch (_) {
      return false;
    }
  }

  // 7. Complaints
  Future<List<ComplaintModel>> fetchComplaints([String? token]) async {
    try {
      final response = await _client
          .get(Uri.parse('${AppConfig.baseUrl}/api/complaints'), headers: _headers(token))
          .timeout(const Duration(seconds: AppConfig.apiTimeoutSeconds));

      if (response.statusCode == 200) {
        final List<dynamic> list = jsonDecode(response.body);
        return list.map((item) => ComplaintModel.fromJson(item)).toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  Future<bool> fileComplaint({
    required String title,
    required String description,
    required String category,
    String? token,
  }) async {
    try {
      final response = await _client
          .post(
            Uri.parse('${AppConfig.baseUrl}/api/complaints'),
            headers: _headers(token),
            body: jsonEncode({
              'title': title,
              'description': description,
              'category': category,
            }),
          )
          .timeout(const Duration(seconds: AppConfig.apiTimeoutSeconds));

      return response.statusCode == 200 || response.statusCode == 201;
    } catch (_) {
      return false;
    }
  }

  // 8. Security Events & Acknowledge
  Future<bool> acknowledgeEvent(String eventId, [String? token]) async {
    try {
      final response = await _client
          .patch(
            Uri.parse('${AppConfig.baseUrl}/api/security-events/$eventId/acknowledge'),
            headers: _headers(token),
            body: jsonEncode({'acknowledgedBy': 'Security Officer'}),
          )
          .timeout(const Duration(seconds: AppConfig.apiTimeoutSeconds));

      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<bool> sendAlert({
    required String cameraName,
    required String location,
    required String type,
    required double confidence,
    String? imageBase64,
  }) async {
    try {
      final response = await _client
          .post(
            Uri.parse(AppConfig.sendAlertUrl),
            headers: _headers(),
            body: jsonEncode({
              'camera': cameraName,
              'location': location,
              'type': type,
              'confidence': confidence,
              'frameBase64': imageBase64 ?? '',
            }),
          )
          .timeout(const Duration(seconds: AppConfig.apiTimeoutSeconds));

      return response.statusCode == 200 || response.statusCode == 202;
    } catch (_) {
      return false;
    }
  }

  void dispose() {
    _client.close();
  }
}
