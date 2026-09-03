import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'providers/auth_provider.dart';
import 'providers/dashboard_provider.dart';
import 'providers/camera_provider.dart';
import 'providers/alert_provider.dart';
import 'providers/gate_pass_provider.dart';
import 'providers/announcement_provider.dart';
import 'providers/complaint_provider.dart';
import 'services/api_service.dart';
import 'services/socket_service.dart';
import 'screens/splash_screen.dart';
import 'screens/login_screen.dart';
import 'screens/main_navigation_screen.dart';
import 'utils/theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const SmartSurveillanceApp());
}

class SmartSurveillanceApp extends StatelessWidget {
  const SmartSurveillanceApp({super.key});

  @override
  Widget build(BuildContext context) {
    final apiService = ApiService();
    final socketService = SocketService()..initSocket();

    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider(apiService)),
        ChangeNotifierProvider(create: (_) => DashboardProvider(apiService, socketService)),
        ChangeNotifierProvider(create: (_) => CameraProvider()),
        ChangeNotifierProvider(create: (_) => AlertProvider(apiService, socketService)),
        ChangeNotifierProvider(create: (_) => GatePassProvider(apiService)),
        ChangeNotifierProvider(create: (_) => AnnouncementProvider(apiService)),
        ChangeNotifierProvider(create: (_) => ComplaintProvider(apiService)),
      ],
      child: MaterialApp(
        title: 'Smart Hostel Surveillance',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.lightTheme,
        darkTheme: AppTheme.darkTheme,
        themeMode: ThemeMode.system,
        initialRoute: '/splash',
        routes: {
          '/splash': (_) => const SplashScreen(),
          '/login': (_) => const LoginScreen(),
          '/main': (_) => const MainNavigationScreen(),
        },
      ),
    );
  }
}
