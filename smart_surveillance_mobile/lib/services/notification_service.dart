import 'package:flutter/material.dart';

class NotificationService {
  static void showAlertNotification(BuildContext context, String title, String body, {VoidCallback? onTap}) {
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();

    messenger.showSnackBar(
      SnackBar(
        elevation: 6,
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.all(16),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        backgroundColor: Colors.red.shade900,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        content: Row(
          children: [
            const Icon(Icons.gpp_bad_rounded, color: Colors.white, size: 28),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 15),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    body,
                    style: const TextStyle(color: Colors.white70, fontSize: 13),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            if (onTap != null)
              TextButton(
                onPressed: onTap,
                style: TextButton.styleFrom(foregroundColor: Colors.amber),
                child: const Text('VIEW'),
              ),
          ],
        ),
        duration: const Duration(seconds: 5),
      ),
    );
  }
}
