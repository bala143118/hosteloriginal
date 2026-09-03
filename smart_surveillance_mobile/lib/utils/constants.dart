import 'package:flutter/material.dart';

enum SecurityRiskLevel {
  safe('SAFE', Color(0xFF10B981), Icons.shield_outlined, 'No critical threats detected'),
  low('LOW RISK', Colors.blue, Icons.info_outline, 'Minor activity observed'),
  medium('MEDIUM RISK', Colors.amber, Icons.warning_amber_rounded, 'Elevated monitoring required'),
  high('HIGH RISK', Colors.orange, Icons.error_outline, 'Threat activity detected'),
  critical('CRITICAL', Colors.red, Icons.gpp_bad_rounded, 'Immediate action required');

  final String label;
  final Color color;
  final IconData icon;
  final String description;

  const SecurityRiskLevel(this.label, this.color, this.icon, this.description);
}

enum ConnectionStatus {
  connected('Connected', Colors.green, Icons.cloud_done_rounded),
  connecting('Connecting...', Colors.orange, Icons.cloud_sync_rounded),
  disconnected('Disconnected', Colors.red, Icons.cloud_off_rounded),
  error('Server Error', Colors.purple, Icons.warning_rounded);

  final String label;
  final Color color;
  final IconData icon;

  const ConnectionStatus(this.label, this.color, this.icon);
}
