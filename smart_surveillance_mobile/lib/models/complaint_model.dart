class ComplaintModel {
  final String id;
  final String title;
  final String description;
  final String category; // Electrical, Plumbing, Wi-Fi, Food, Cleanliness
  final String status; // Pending, In Progress, Resolved
  final String studentName;
  final String roomNumber;
  final String createdAt;

  ComplaintModel({
    required this.id,
    required this.title,
    required this.description,
    required this.category,
    required this.status,
    required this.studentName,
    required this.roomNumber,
    required this.createdAt,
  });

  factory ComplaintModel.fromJson(Map<String, dynamic> json) {
    return ComplaintModel(
      id: json['id'] ?? 'CMP-${DateTime.now().millisecondsSinceEpoch}',
      title: json['title'] ?? json['subject'] ?? 'Maintenance Request',
      description: json['description'] ?? json['issue'] ?? '',
      category: json['category'] ?? json['type'] ?? 'General',
      status: json['status'] ?? 'Pending',
      studentName: json['studentName'] ?? json['name'] ?? 'Student',
      roomNumber: json['roomNumber'] ?? '101',
      createdAt: json['createdAt'] ?? DateTime.now().toIso8601String(),
    );
  }
}
