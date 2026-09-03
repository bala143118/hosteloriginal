import 'package:flutter/material.dart';
import '../models/alert_model.dart';
import '../utils/helpers.dart';
import '../utils/responsive.dart';

class AlertCard extends StatelessWidget {
  final AlertModel alert;
  final VoidCallback? onAcknowledge;
  final VoidCallback? onTap;

  const AlertCard({
    super.key,
    required this.alert,
    this.onAcknowledge,
    this.onTap,
  });

  Color _getSeverityColor(String severity) {
    switch (severity.toUpperCase()) {
      case 'CRITICAL':
        return Colors.red;
      case 'HIGH':
        return Colors.orange;
      case 'MEDIUM':
        return Colors.amber;
      default:
        return Colors.blue;
    }
  }

  IconData _getAlertIcon(String type) {
    final String lower = type.toLowerCase();
    if (lower.contains('fire')) return Icons.local_fire_department_rounded;
    if (lower.contains('smoke')) return Icons.air_rounded;
    if (lower.contains('intrusion')) return Icons.door_front_door_outlined;
    return Icons.warning_amber_rounded;
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final Color severityColor = _getSeverityColor(alert.severity);
    final double padding = AppResponsive.paddingCard(context);

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: EdgeInsets.all(padding),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: severityColor.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(_getAlertIcon(alert.type), color: severityColor, size: 20),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          alert.type,
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.bold,
                            fontSize: 14,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          alert.camera,
                          style: theme.textTheme.bodySmall?.copyWith(fontSize: 11),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: severityColor.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: severityColor.withValues(alpha: 0.4)),
                    ),
                    child: Text(
                      alert.severity,
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: severityColor,
                        fontWeight: FontWeight.bold,
                        fontSize: 10,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Wrap(
                alignment: WrapAlignment.spaceBetween,
                spacing: 8,
                runSpacing: 6,
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.access_time_rounded, size: 12, color: Colors.grey),
                      const SizedBox(width: 4),
                      Text(
                        AppHelpers.formatTimestamp(alert.timestamp),
                        style: theme.textTheme.bodySmall?.copyWith(fontSize: 11),
                      ),
                      const SizedBox(width: 12),
                      const Icon(Icons.analytics_outlined, size: 12, color: Colors.grey),
                      const SizedBox(width: 4),
                      Text(
                        AppHelpers.formatConfidence(alert.confidence),
                        style: theme.textTheme.bodySmall?.copyWith(fontSize: 11),
                      ),
                    ],
                  ),
                  if (!alert.isAcknowledged && onAcknowledge != null)
                    FilledButton.tonal(
                      onPressed: onAcknowledge,
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
                        minimumSize: const Size(0, 28),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      child: const Text('ACKNOWLEDGE', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold)),
                    )
                  else if (alert.isAcknowledged)
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: const [
                        Icon(Icons.check_circle_rounded, size: 14, color: Colors.green),
                        SizedBox(width: 4),
                        Text('ACKNOWLEDGED', style: TextStyle(fontSize: 10, color: Colors.green, fontWeight: FontWeight.bold)),
                      ],
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
