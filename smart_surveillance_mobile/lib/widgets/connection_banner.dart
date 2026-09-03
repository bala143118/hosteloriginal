import 'package:flutter/material.dart';
import '../utils/constants.dart';

class ConnectionBanner extends StatelessWidget {
  final ConnectionStatus status;
  final VoidCallback? onRetry;

  const ConnectionBanner({
    super.key,
    required this.status,
    this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    if (status == ConnectionStatus.connected) {
      return const SizedBox.shrink();
    }

    return Container(
      width: double.infinity,
      color: status.color.withOpacity(0.9),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: SafeArea(
        bottom: false,
        child: Row(
          children: [
            Icon(status.icon, color: Colors.white, size: 20),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                status == ConnectionStatus.disconnected
                    ? 'Backend unavailable. Unable to connect to Smart Surveillance server.'
                    : status.label,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            if (onRetry != null)
              InkWell(
                onTap: onRetry,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.25),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Text(
                    'RETRY',
                    style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
