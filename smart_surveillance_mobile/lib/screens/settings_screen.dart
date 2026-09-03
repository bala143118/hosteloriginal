import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../config/app_config.dart';
import '../providers/auth_provider.dart';
import '../providers/dashboard_provider.dart';
import '../services/api_service.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _enableNotifications = true;
  bool _criticalAlertsOnly = false;
  bool _soundEnabled = true;
  bool _vibrationEnabled = true;
  bool _isTestingConnection = false;

  Future<void> _testBackendConnection() async {
    setState(() {
      _isTestingConnection = true;
    });

    final apiService = ApiService();
    final bool isHealthy = await apiService.testConnection();
    apiService.dispose();

    if (!mounted) return;
    setState(() {
      _isTestingConnection = false;
    });

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          isHealthy
              ? '● Connected — Server at ${AppConfig.baseUrl} is reachable.'
              : '● Disconnected — Unable to reach ${AppConfig.baseUrl}',
        ),
        backgroundColor: isHealthy ? Colors.green : Colors.red,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final authProvider = Provider.of<AuthProvider>(context);
    final dashboardProvider = Provider.of<DashboardProvider>(context);
    final user = authProvider.user;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings', style: TextStyle(fontWeight: FontWeight.bold)),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16.0),
        children: [
          // ACCOUNT CARD
          Card(
            child: ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              leading: CircleAvatar(
                radius: 24,
                backgroundColor: theme.colorScheme.primary.withOpacity(0.2),
                child: Icon(Icons.person, color: theme.colorScheme.primary),
              ),
              title: Text(user?.name ?? 'Security Officer', style: const TextStyle(fontWeight: FontWeight.bold)),
              subtitle: Text('${user?.email ?? "admin@hostelfix.edu"} • ${user?.role.toUpperCase() ?? "ADMIN"}'),
              trailing: IconButton(
                icon: const Icon(Icons.logout_rounded, color: Colors.red),
                tooltip: 'Logout',
                onPressed: () async {
                  await authProvider.logout();
                  if (!context.mounted) return;
                  Navigator.of(context).pushReplacementNamed('/login');
                },
              ),
            ),
          ),

          const SizedBox(height: 16),
          Text('Backend Connection', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold, color: Colors.grey)),
          const SizedBox(height: 8),

          // CONNECTION CARD
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Target Backend URL:', style: TextStyle(fontWeight: FontWeight.bold)),
                      Chip(
                        label: Text(dashboardProvider.connectionStatus.label),
                        backgroundColor: dashboardProvider.connectionStatus.color.withOpacity(0.15),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  SelectableText(
                    AppConfig.baseUrl,
                    style: const TextStyle(fontFamily: 'monospace', color: Colors.blue),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: _isTestingConnection ? null : _testBackendConnection,
                      icon: _isTestingConnection
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.network_check_rounded),
                      label: const Text('Test Connection Status'),
                    ),
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 16),
          Text('Notification Preferences', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold, color: Colors.grey)),
          const SizedBox(height: 8),

          // NOTIFICATIONS SWITCHES
          Card(
            child: Column(
              children: [
                SwitchListTile(
                  title: const Text('Enable Real-time Push Alerts'),
                  subtitle: const Text('Receive notifications for AI security events'),
                  value: _enableNotifications,
                  onChanged: (val) => setState(() => _enableNotifications = val),
                ),
                const Divider(height: 1),
                SwitchListTile(
                  title: const Text('Critical Alerts Only'),
                  subtitle: const Text('Only notify for Fire & Intrusion threats'),
                  value: _criticalAlertsOnly,
                  onChanged: (val) => setState(() => _criticalAlertsOnly = val),
                ),
                const Divider(height: 1),
                SwitchListTile(
                  title: const Text('Sound Effects'),
                  value: _soundEnabled,
                  onChanged: (val) => setState(() => _soundEnabled = val),
                ),
                const Divider(height: 1),
                SwitchListTile(
                  title: const Text('Vibration'),
                  value: _vibrationEnabled,
                  onChanged: (val) => setState(() => _vibrationEnabled = val),
                ),
              ],
            ),
          ),

          const SizedBox(height: 16),
          Text('About Application', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold, color: Colors.grey)),
          const SizedBox(height: 8),

          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.info_outline_rounded),
                  title: const Text(AppConfig.appName),
                  subtitle: const Text('Version ${AppConfig.appVersion} • Material 3 Android'),
                ),
                const Divider(height: 1),
                const ListTile(
                  leading: Icon(Icons.memory_rounded),
                  title: Text('AI Inference Engine'),
                  subtitle: Text('YOLO + OpenCV Object Detection'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
