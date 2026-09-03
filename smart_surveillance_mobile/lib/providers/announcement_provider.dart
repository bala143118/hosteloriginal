import 'package:flutter/material.dart';
import '../models/announcement_model.dart';
import '../services/api_service.dart';

class AnnouncementProvider extends ChangeNotifier {
  final ApiService _apiService;
  List<AnnouncementModel> _announcements = [];
  bool _isLoading = false;

  List<AnnouncementModel> get announcements => _announcements;
  int get totalCount => _announcements.length;
  bool get isLoading => _isLoading;

  AnnouncementProvider(this._apiService) {
    loadAnnouncements();
  }

  Future<void> loadAnnouncements([String? token]) async {
    _isLoading = true;
    notifyListeners();

    final List<AnnouncementModel> fetched = await _apiService.fetchAnnouncements(token);
    _isLoading = false;

    if (fetched.isNotEmpty) {
      _announcements = fetched;
    } else {
      // Demo announcements
      _announcements = [
        AnnouncementModel(
          id: 'ANC-01',
          title: 'Campus Security & CCTV Upgrade',
          content: 'New AI camera feeds are active across Main Gate and Block A. All hostel curfew policies strictly enforced.',
          category: 'Urgent',
          author: 'Chief Security Officer',
          timestamp: DateTime.now().subtract(const Duration(hours: 3)).toIso8601String(),
          isPinned: true,
        ),
        AnnouncementModel(
          id: 'ANC-02',
          title: 'Hostel Outing Timings Update',
          content: 'Weekend outing passes must be requested before 6:00 PM through the Smart Hostel mobile app.',
          category: 'General',
          author: 'Chief Warden',
          timestamp: DateTime.now().subtract(const Duration(hours: 14)).toIso8601String(),
        ),
        AnnouncementModel(
          id: 'ANC-03',
          title: 'Mess Hall Maintenance Schedule',
          content: 'Dining hall A will undergo maintenance between 2:00 PM and 4:00 PM today.',
          category: 'Maintenance',
          author: 'Hostel Committee',
          timestamp: DateTime.now().subtract(const Duration(days: 1)).toIso8601String(),
        ),
      ];
    }
    notifyListeners();
  }

  Future<bool> postAnnouncement({
    required String title,
    required String content,
    required String category,
    String? token,
  }) async {
    final newNotice = AnnouncementModel(
      id: 'ANC-${DateTime.now().millisecondsSinceEpoch.toString().substring(7)}',
      title: title,
      content: content,
      category: category,
      author: 'Hostel Officer',
      timestamp: DateTime.now().toIso8601String(),
    );

    _announcements.insert(0, newNotice);
    notifyListeners();
    await _apiService.postAnnouncement(title: title, content: content, category: category, token: token);
    return true;
  }
}
