import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/alert_provider.dart';
import '../providers/camera_provider.dart';
import '../providers/dashboard_provider.dart';
import '../providers/gate_pass_provider.dart';
import '../providers/announcement_provider.dart';
import '../providers/complaint_provider.dart';
import '../utils/responsive.dart';
import '../widgets/alert_card.dart';
import '../widgets/status_card.dart';
import 'gate_pass_screen.dart';
import 'announcements_screen.dart';
import 'complaints_screen.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final dashboardProvider = Provider.of<DashboardProvider>(context);
    final cameraProvider = Provider.of<CameraProvider>(context);
    final alertProvider = Provider.of<AlertProvider>(context);
    final gatePassProvider = Provider.of<GatePassProvider>(context);
    final announcementProvider = Provider.of<AnnouncementProvider>(context);
    final complaintProvider = Provider.of<ComplaintProvider>(context);

    final status = dashboardProvider.status;
    final risk = status.riskLevel;
    final double px = AppResponsive.paddingHorizontal(context);
    final int gridCount = AppResponsive.gridCrossAxisCount(context);
    final double gridRatio = AppResponsive.gridChildAspectRatio(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Smart Hostel Surveillance', style: TextStyle(fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh Status',
            onPressed: () {
              dashboardProvider.refreshDashboard();
              gatePassProvider.loadGatePasses();
              announcementProvider.loadAnnouncements();
              complaintProvider.loadComplaints();
            },
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showSimulateAlertSheet(context, alertProvider),
        icon: const Icon(Icons.add_alert_rounded),
        label: const Text('Test Alert'),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await dashboardProvider.refreshDashboard();
          await gatePassProvider.loadGatePasses();
          await announcementProvider.loadAnnouncements();
          await complaintProvider.loadComplaints();
        },
        child: SingleChildScrollView(
          padding: EdgeInsets.symmetric(horizontal: px, vertical: 12.0),
          physics: const AlwaysScrollableScrollPhysics(),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 1. RISK / SECURITY STATUS CARD
              Card(
                color: risk.color.withValues(alpha: 0.12),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(18),
                  side: BorderSide(color: risk.color.withValues(alpha: 0.5), width: 1.5),
                ),
                margin: EdgeInsets.zero,
                child: Padding(
                  padding: EdgeInsets.all(AppResponsive.paddingCard(context)),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: risk.color.withValues(alpha: 0.2),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(risk.icon, color: risk.color, size: 32),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Text(
                                  'SECURITY STATUS',
                                  style: theme.textTheme.labelSmall?.copyWith(
                                    letterSpacing: 1.1,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 10,
                                  ),
                                ),
                                const Spacer(),
                                Container(
                                  width: 8,
                                  height: 8,
                                  decoration: BoxDecoration(
                                    color: risk.color,
                                    shape: BoxShape.circle,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 2),
                            Text(
                              risk.label,
                              style: theme.textTheme.titleLarge?.copyWith(
                                color: risk.color,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              risk.description,
                              style: theme.textTheme.bodySmall?.copyWith(fontSize: 11),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 18),

              // 2. QUICK HOSTEL MODULE SHORTCUTS
              Text(
                'Hostel Management Modules',
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: _buildModuleCard(
                      context,
                      title: 'Gate Pass',
                      subtitle: '${gatePassProvider.pendingCount} Pending',
                      icon: Icons.confirmation_number_outlined,
                      color: Colors.indigo,
                      badgeCount: gatePassProvider.pendingCount,
                      onTap: () {
                        Navigator.push(context, MaterialPageRoute(builder: (_) => const GatePassScreen()));
                      },
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _buildModuleCard(
                      context,
                      title: 'Announcements',
                      subtitle: '${announcementProvider.totalCount} Active',
                      icon: Icons.campaign_outlined,
                      color: Colors.orange,
                      badgeCount: announcementProvider.totalCount,
                      onTap: () {
                        Navigator.push(context, MaterialPageRoute(builder: (_) => const AnnouncementsScreen()));
                      },
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: _buildModuleCard(
                      context,
                      title: 'Complaints',
                      subtitle: '${complaintProvider.pendingCount} Open',
                      icon: Icons.build_circle_outlined,
                      color: Colors.teal,
                      badgeCount: complaintProvider.pendingCount,
                      onTap: () {
                        Navigator.push(context, MaterialPageRoute(builder: (_) => const ComplaintsScreen()));
                      },
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _buildModuleCard(
                      context,
                      title: 'CCTV Feeds',
                      subtitle: '${cameraProvider.onlineCount} Feeds Online',
                      icon: Icons.videocam_outlined,
                      color: Colors.blue,
                      onTap: () {
                        // Switch to Monitor Tab or open cameras
                      },
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 20),

              // 3. LIVE ANNOUNCEMENT BANNER
              if (announcementProvider.announcements.isNotEmpty) ...[
                Card(
                  color: Colors.amber.withValues(alpha: 0.12),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                    side: BorderSide(color: Colors.amber.withValues(alpha: 0.4)),
                  ),
                  margin: EdgeInsets.zero,
                  child: InkWell(
                    onTap: () {
                      Navigator.push(context, MaterialPageRoute(builder: (_) => const AnnouncementsScreen()));
                    },
                    borderRadius: BorderRadius.circular(14),
                    child: Padding(
                      padding: const EdgeInsets.all(12.0),
                      child: Row(
                        children: [
                          const Icon(Icons.campaign_rounded, color: Colors.amber, size: 24),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  announcementProvider.announcements.first.title,
                                  style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                Text(
                                  announcementProvider.announcements.first.content,
                                  style: theme.textTheme.bodySmall?.copyWith(fontSize: 11),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                          const Icon(Icons.chevron_right_rounded, color: Colors.amber),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
              ],

              // 4. SYSTEM OVERVIEW METRICS
              Text(
                'System Statistics',
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 10),

              GridView.count(
                crossAxisCount: gridCount,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                childAspectRatio: gridRatio,
                crossAxisSpacing: 10,
                mainAxisSpacing: 10,
                children: [
                  StatusCard(
                    title: 'Total Cameras',
                    value: '${cameraProvider.totalCameras}',
                    icon: Icons.videocam_outlined,
                    iconColor: Colors.blue,
                    subtitle: 'Configured',
                  ),
                  StatusCard(
                    title: 'Online Feeds',
                    value: '${cameraProvider.onlineCount}',
                    icon: Icons.cloud_done_outlined,
                    iconColor: Colors.green,
                    subtitle: 'Active',
                  ),
                  StatusCard(
                    title: 'Active Alerts',
                    value: '${alertProvider.unreadCount}',
                    icon: Icons.gpp_maybe_outlined,
                    iconColor: alertProvider.unreadCount > 0 ? Colors.red : const Color(0xFF10B981),
                    subtitle: 'Unread',
                  ),
                  StatusCard(
                    title: 'AI Detections',
                    value: '${status.totalDetections}',
                    icon: Icons.memory_rounded,
                    iconColor: Colors.purple,
                    subtitle: 'Total Logged',
                  ),
                ],
              ),

              const SizedBox(height: 20),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Recent Alerts',
                    style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                  ),
                  TextButton(
                    onPressed: () {},
                    child: const Text('View All'),
                  ),
                ],
              ),
              const SizedBox(height: 6),

              // 5. RECENT ALERTS LIST
              if (alertProvider.alerts.isEmpty)
                Card(
                  margin: EdgeInsets.zero,
                  child: Padding(
                    padding: const EdgeInsets.all(20.0),
                    child: Center(
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: const [
                          Icon(Icons.check_circle_outline, color: Colors.green),
                          SizedBox(width: 8),
                          Text('No active threat alerts'),
                        ],
                      ),
                    ),
                  ),
                )
              else
                ListView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: alertProvider.alerts.take(3).length,
                  itemBuilder: (context, index) {
                    final alert = alertProvider.alerts[index];
                    return AlertCard(
                      alert: alert,
                      onAcknowledge: () => alertProvider.acknowledgeAlert(alert.id),
                    );
                  },
                ),
              const SizedBox(height: 60),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildModuleCard(
    BuildContext context, {
    required String title,
    required String subtitle,
    required IconData icon,
    required Color color,
    int badgeCount = 0,
    required VoidCallback onTap,
  }) {
    final ThemeData theme = Theme.of(context);

    return Card(
      clipBehavior: Clip.antiAlias,
      margin: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12.0),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: color, size: 22),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      subtitle,
                      style: theme.textTheme.bodySmall?.copyWith(fontSize: 10),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              if (badgeCount > 0)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: color,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    '$badgeCount',
                    style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  void _showSimulateAlertSheet(BuildContext context, AlertProvider alertProvider) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(20.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Simulate AI Security Alert',
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 4),
                const Text('Trigger a simulated detection alert to test real-time monitoring.'),
                const SizedBox(height: 16),
                ListTile(
                  leading: const CircleAvatar(backgroundColor: Colors.redAccent, child: Icon(Icons.local_fire_department, color: Colors.white)),
                  title: const Text('Fire Detected'),
                  subtitle: const Text('High Severity • Mess Kitchen Zone'),
                  onTap: () {
                    Navigator.pop(context);
                    alertProvider.triggerTestAlert('Fire Detected', 'Camera 04 - Kitchen');
                  },
                ),
                ListTile(
                  leading: const CircleAvatar(backgroundColor: Colors.orangeAccent, child: Icon(Icons.air_rounded, color: Colors.white)),
                  title: const Text('Smoke Warning'),
                  subtitle: const Text('High Severity • West Wing Corridor'),
                  onTap: () {
                    Navigator.pop(context);
                    alertProvider.triggerTestAlert('Smoke Warning', 'Camera 03 - West Wing');
                  },
                ),
                ListTile(
                  leading: const CircleAvatar(backgroundColor: Colors.purpleAccent, child: Icon(Icons.directions_run_rounded, color: Colors.white)),
                  title: const Text('Suspicious Activity'),
                  subtitle: const Text('Medium Severity • North Courtyard'),
                  onTap: () {
                    Navigator.pop(context);
                    alertProvider.triggerTestAlert('Suspicious Activity', 'Camera 02 - Courtyard');
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
