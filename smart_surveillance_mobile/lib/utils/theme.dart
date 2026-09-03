import 'package:flutter/material.dart';

class AppTheme {
  static const Color primaryBlue = Color(0xFF0F62FE);
  static const Color darkBackground = Color(0xFF12141C);
  static const Color darkSurface = Color(0xFF1E2230);
  static const Color darkCardBg = Color(0xFF262B3D);

  static ThemeData get lightTheme {
    return ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: primaryBlue,
        brightness: Brightness.light,
      ),
      scaffoldBackgroundColor: const Color(0xFFF4F6FB),
      appBarTheme: const AppBarTheme(
        centerTitle: true,
        elevation: 0,
        backgroundColor: Colors.transparent,
        scrolledUnderElevation: 2,
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: Color(0xFFE2E8F0)),
        ),
        margin: const EdgeInsets.symmetric(vertical: 6, horizontal: 12),
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: 68,
        elevation: 3,
        indicatorColor: primaryBlue.withValues(alpha: 0.15),
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      ),
    );
  }

  static ThemeData get darkTheme {
    return ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: primaryBlue,
        brightness: Brightness.dark,
        surface: darkSurface,
      ),
      scaffoldBackgroundColor: darkBackground,
      appBarTheme: const AppBarTheme(
        centerTitle: true,
        elevation: 0,
        backgroundColor: Colors.transparent,
        scrolledUnderElevation: 4,
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: darkCardBg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: Colors.white.withOpacity(0.08)),
        ),
        margin: const EdgeInsets.symmetric(vertical: 6, horizontal: 12),
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: 68,
        elevation: 8,
        backgroundColor: darkSurface,
        indicatorColor: primaryBlue.withOpacity(0.25),
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      ),
    );
  }
}
