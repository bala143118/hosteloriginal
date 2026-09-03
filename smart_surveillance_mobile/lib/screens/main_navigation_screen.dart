import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/alert_provider.dart';
import '../providers/dashboard_provider.dart';
import '../providers/gate_pass_provider.dart';
import '../widgets/connection_banner.dart';
import 'dashboard_screen.dart';
import 'gate_pass_screen.dart';
import 'announcements_screen.dart';
import 'monitoring_screen.dart';
import 'settings_screen.dart';

class MainNavigationScreen extends StatefulWidget {
  const MainNavigationScreen({super.key});

  @override
  State<MainNavigationScreen> createState() => _MainNavigationScreenState();
}

class _MainNavigationScreenState extends State<MainNavigationScreen> {
  int _currentIndex = 0;

  final List<Widget> _screens = const [
    DashboardScreen(),
    GatePassScreen(),
    AnnouncementsScreen(),
    MonitoringScreen(),
    SettingsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    final dashboardProvider = Provider.of<DashboardProvider>(context);
    final alertProvider = Provider.of<AlertProvider>(context);
    final gatePassProvider = Provider.of<GatePassProvider>(context);

    return Scaffold(
      body: Column(
        children: [
          ConnectionBanner(
            status: dashboardProvider.connectionStatus,
            onRetry: () => dashboardProvider.refreshDashboard(),
          ),
          Expanded(
            child: IndexedStack(
              index: _currentIndex,
              children: _screens,
            ),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (index) {
          setState(() {
            _currentIndex = index;
          });
        },
        destinations: [
          const NavigationDestination(
            icon: Icon(Icons.dashboard_outlined),
            selectedIcon: Icon(Icons.dashboard_rounded),
            label: 'Dashboard',
          ),
          NavigationDestination(
            icon: Badge(
              label: Text('${gatePassProvider.pendingCount}'),
              isLabelVisible: gatePassProvider.pendingCount > 0,
              child: const Icon(Icons.confirmation_number_outlined),
            ),
            selectedIcon: Badge(
              label: Text('${gatePassProvider.pendingCount}'),
              isLabelVisible: gatePassProvider.pendingCount > 0,
              child: const Icon(Icons.confirmation_number_rounded),
            ),
            label: 'Gate Pass',
          ),
          const NavigationDestination(
            icon: Icon(Icons.campaign_outlined),
            selectedIcon: Icon(Icons.campaign_rounded),
            label: 'Notices',
          ),
          NavigationDestination(
            icon: Badge(
              label: Text('${alertProvider.unreadCount}'),
              isLabelVisible: alertProvider.unreadCount > 0,
              child: const Icon(Icons.videocam_outlined),
            ),
            selectedIcon: Badge(
              label: Text('${alertProvider.unreadCount}'),
              isLabelVisible: alertProvider.unreadCount > 0,
              child: const Icon(Icons.videocam_rounded),
            ),
            label: 'Surveillance',
          ),
          const NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings_rounded),
            label: 'Settings',
          ),
        ],
      ),
    );
  }
}
