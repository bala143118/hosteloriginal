import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/camera_provider.dart';
import '../widgets/camera_card.dart';
import '../widgets/empty_state.dart';
import 'camera_details_screen.dart';

class CamerasScreen extends StatelessWidget {
  const CamerasScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final cameraProvider = Provider.of<CameraProvider>(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Surveillance Cameras', style: TextStyle(fontWeight: FontWeight.bold)),
      ),
      body: Column(
        children: [
          // Search Field
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: TextField(
              onChanged: (val) => cameraProvider.setSearchQuery(val),
              decoration: InputDecoration(
                hintText: 'Search camera name or location...',
                prefixIcon: const Icon(Icons.search_rounded),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              ),
            ),
          ),

          // Camera List
          Expanded(
            child: cameraProvider.cameras.isEmpty
                ? const EmptyState(
                    icon: Icons.videocam_off_outlined,
                    title: 'No Cameras Found',
                    message: 'No surveillance cameras match your search query or are registered.',
                  )
                : ListView.builder(
                    padding: const EdgeInsets.only(bottom: 16),
                    itemCount: cameraProvider.cameras.length,
                    itemBuilder: (context, index) {
                      final camera = cameraProvider.cameras[index];
                      return CameraCard(
                        camera: camera,
                        onTap: () {
                          cameraProvider.selectCamera(camera);
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => CameraDetailsScreen(camera: camera),
                            ),
                          );
                        },
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
