import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/camera_provider.dart';
import '../widgets/camera_card.dart';
import 'camera_details_screen.dart';

class MonitoringScreen extends StatefulWidget {
  const MonitoringScreen({super.key});

  @override
  State<MonitoringScreen> createState() => _MonitoringScreenState();
}

class _MonitoringScreenState extends State<MonitoringScreen> {
  bool _isGridView = false;

  @override
  Widget build(BuildContext context) {
    final cameraProvider = Provider.of<CameraProvider>(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Live Monitoring', style: TextStyle(fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            icon: Icon(_isGridView ? Icons.view_list_rounded : Icons.grid_view_rounded),
            tooltip: 'Toggle View Layout',
            onPressed: () {
              setState(() {
                _isGridView = !_isGridView;
              });
            },
          ),
        ],
      ),
      body: cameraProvider.cameras.isEmpty
          ? const Center(child: Text('No surveillance feeds available.'))
          : Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: _isGridView
                  ? GridView.builder(
                      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 2,
                        childAspectRatio: 0.82,
                        crossAxisSpacing: 10,
                        mainAxisSpacing: 10,
                      ),
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
                    )
                  : ListView.builder(
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
    );
  }
}
