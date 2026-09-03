class GatePassModel {
  final String id;
  final String studentId;
  final String studentName;
  final String roomNumber;
  final String block;
  final String passType; // Outing / Home Leave / Emergency
  final String reason;
  final String outTime;
  final String inTime;
  final String status; // Pending, Approved, Rejected, Completed
  final String? approvedBy;
  final String createdAt;

  GatePassModel({
    required this.id,
    required this.studentId,
    required this.studentName,
    required this.roomNumber,
    required this.block,
    required this.passType,
    required this.reason,
    required this.outTime,
    required this.inTime,
    required this.status,
    this.approvedBy,
    required this.createdAt,
  });

  factory GatePassModel.fromJson(Map<String, dynamic> json) {
    return GatePassModel(
      id: json['id'] ?? json['passId'] ?? 'GP-${DateTime.now().millisecondsSinceEpoch}',
      studentId: json['studentId'] ?? json['rollNumber'] ?? 'STU-101',
      studentName: json['studentName'] ?? json['name'] ?? 'Student',
      roomNumber: json['roomNumber'] ?? '101',
      block: json['block'] ?? json['hostelBlock'] ?? 'Block A',
      passType: json['passType'] ?? json['type'] ?? 'Outing',
      reason: json['reason'] ?? 'Personal work',
      outTime: json['outTime'] ?? json['departureDate'] ?? DateTime.now().toIso8601String(),
      inTime: json['inTime'] ?? json['expectedReturn'] ?? DateTime.now().add(const Duration(hours: 4)).toIso8601String(),
      status: json['status'] ?? 'Pending',
      approvedBy: json['approvedBy'] ?? json['verifier'],
      createdAt: json['createdAt'] ?? DateTime.now().toIso8601String(),
    );
  }
}
