import 'package:intl/intl.dart';

class AppHelpers {
  static String formatTimestamp(String? isoString) {
    if (isoString == null || isoString.isEmpty) return 'Just now';
    try {
      final DateTime dt = DateTime.parse(isoString).toLocal();
      final DateTime now = DateTime.now();
      
      if (dt.year == now.year && dt.month == now.month && dt.day == now.day) {
        return DateFormat('hh:mm a').format(dt);
      }
      return DateFormat('MMM dd, hh:mm a').format(dt);
    } catch (_) {
      return isoString;
    }
  }

  static String formatConfidence(dynamic confidence) {
    if (confidence == null) return '85%';
    if (confidence is num) {
      final double val = confidence <= 1 ? confidence * 100 : confidence.toDouble();
      return '${val.toStringAsFixed(0)}%';
    }
    return '$confidence%';
  }
}
