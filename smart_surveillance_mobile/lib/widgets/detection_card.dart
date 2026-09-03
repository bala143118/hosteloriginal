import 'package:flutter/material.dart';
import '../models/detection_model.dart';
import '../utils/helpers.dart';

class DetectionCard extends StatelessWidget {
  final DetectionModel detection;

  const DetectionCard({
    super.key,
    required this.detection,
  });

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.cardTheme.color ?? theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.dividerColor.withOpacity(0.1)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: theme.colorScheme.primary.withOpacity(0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(Icons.remove_red_eye_rounded, color: theme.colorScheme.primary, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  detection.label,
                  style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold),
                ),
                Text(
                  '${detection.cameraName} • ${AppHelpers.formatTimestamp(detection.timestamp)}',
                  style: theme.textTheme.bodySmall?.copyWith(fontSize: 11),
                ),
              ],
            ),
          ),
          Chip(
            label: Text(
              '${detection.confidence.toStringAsFixed(0)}%',
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
            ),
            padding: EdgeInsets.zero,
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            visualDensity: VisualDensity.compact,
          ),
        ],
      ),
    );
  }
}
