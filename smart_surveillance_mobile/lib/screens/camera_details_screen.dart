import 'package:flutter/material.dart';
import '../models/camera_model.dart';
import '../models/detection_model.dart';
import '../widgets/detection_card.dart';

class CameraDetailsScreen extends StatefulWidget {
  final CameraModel camera;

  const CameraDetailsScreen({super.key, required this.camera});

  @override
  State<CameraDetailsScreen> createState() => _CameraDetailsScreenState();
}

class _CameraDetailsScreenState extends State<CameraDetailsScreen> {
  late List<DetectionModel> _detections;

  @override
  void initState() {
    super.initState();
    _detections = [
      DetectionModel(
        label: widget.camera.lastDetectionType,
        confidence: widget.camera.confidence > 0 ? widget.camera.confidence : 89.2,
        timestamp: DateTime.now().subtract(const Duration(minutes: 5)).toIso8601String(),
        cameraName: widget.camera.name,
      ),
      DetectionModel(
        label: 'Person Entrance',
        confidence: 94.0,
        timestamp: DateTime.now().subtract(const Duration(minutes: 22)).toIso8601String(),
        cameraName: widget.camera.name,
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final bool isOnline = widget.camera.isOnline;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.camera.name, style: const TextStyle(fontWeight: FontWeight.bold)),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // STREAM PLAYER CONTAINER
            Container(
              height: 220,
              width: double.infinity,
              decoration: BoxDecoration(
                color: const Color(0xFF121212),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: isOnline ? Colors.green.withOpacity(0.5) : Colors.red.withOpacity(0.5), width: 1.5),
              ),
              child: Stack(
                children: [
                  Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          isOnline ? Icons.videocam_rounded : Icons.videocam_off_rounded,
                          size: 54,
                          color: isOnline ? Colors.white70 : Colors.white30,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          isOnline ? 'LIVE STREAM CONNECTED' : 'Camera stream unavailable',
                          style: TextStyle(
                            color: isOnline ? Colors.greenAccent : Colors.white54,
                            fontWeight: FontWeight.bold,
                            fontSize: 14,
                          ),
                        ),
                        if (!isOnline) ...[
                          const SizedBox(height: 4),
                          const Text(
                            'The camera is currently offline or unreachable.',
                            style: TextStyle(color: Colors.white38, fontSize: 12),
                          ),
                        ],
                      ],
                    ),
                  ),

                  // Overlay Badge
                  Positioned(
                    top: 12,
                    left: 12,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: isOnline ? Colors.red : Colors.grey.shade800,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 6,
                            height: 6,
                            decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            isOnline ? 'LIVE' : 'OFFLINE',
                            style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 20),

            // CAMERA METADATA
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Camera ID:', style: theme.textTheme.bodyMedium?.copyWith(color: Colors.grey)),
                        Text(widget.camera.id, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold)),
                      ],
                    ),
                    const Divider(height: 20),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Location Zone:', style: theme.textTheme.bodyMedium?.copyWith(color: Colors.grey)),
                        Text(widget.camera.location, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold)),
                      ],
                    ),
                    const Divider(height: 20),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('YOLO Detection State:', style: theme.textTheme.bodyMedium?.copyWith(color: Colors.grey)),
                        Chip(
                          label: Text(widget.camera.lastDetectionType, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                          backgroundColor: theme.colorScheme.primaryContainer.withOpacity(0.5),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 20),
            Text(
              'Recent Detections',
              style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 10),

            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: _detections.length,
              itemBuilder: (context, index) {
                return DetectionCard(detection: _detections[index]);
              },
            ),
          ],
        ),
      ),
    );
  }
}
