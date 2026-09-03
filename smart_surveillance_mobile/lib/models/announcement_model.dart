class AnnouncementModel {
  final String id;
  final String title;
  final String content;
  final String category; // Urgent, Maintenance, Event, General
  final String author;
  final String timestamp;
  final bool isPinned;

  AnnouncementModel({
    required this.id,
    required this.title,
    required this.content,
    required this.category,
    required this.author,
    required this.timestamp,
    this.isPinned = false,
  });

  factory AnnouncementModel.fromJson(Map<String, dynamic> json) {
    return AnnouncementModel(
      id: json['id'] ?? 'ANC-${DateTime.now().millisecondsSinceEpoch}',
      title: json['title'] ?? 'Campus Notice',
      content: json['content'] ?? json['message'] ?? '',
      category: json['category'] ?? json['type'] ?? 'General',
      author: json['author'] ?? json['postedBy'] ?? 'Hostel Administration',
      timestamp: json['timestamp'] ?? json['createdAt'] ?? DateTime.now().toIso8601String(),
      isPinned: json['isPinned'] == true,
    );
  }
}
