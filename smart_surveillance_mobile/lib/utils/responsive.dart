import 'package:flutter/material.dart';

enum ScreenType { small, normal, large }

class AppResponsive {
  static ScreenType getScreenType(BuildContext context) {
    final double width = MediaQuery.of(context).size.width;
    if (width < 360) return ScreenType.small;
    if (width < 420) return ScreenType.normal;
    return ScreenType.large;
  }

  static bool isSmallPhone(BuildContext context) => getScreenType(context) == ScreenType.small;
  static bool isLargePhone(BuildContext context) => getScreenType(context) == ScreenType.large;

  // Responsive Horizontal Padding
  static double paddingHorizontal(BuildContext context) {
    final ScreenType type = getScreenType(context);
    switch (type) {
      case ScreenType.small:
        return 12.0;
      case ScreenType.normal:
        return 16.0;
      case ScreenType.large:
        return 20.0;
    }
  }

  // Responsive Card Padding
  static double paddingCard(BuildContext context) {
    final ScreenType type = getScreenType(context);
    switch (type) {
      case ScreenType.small:
        return 10.0;
      case ScreenType.normal:
        return 14.0;
      case ScreenType.large:
        return 18.0;
    }
  }

  // Responsive Grid Count for Statistics Cards
  static int gridCrossAxisCount(BuildContext context) {
    final double width = MediaQuery.of(context).size.width;
    if (width < 340) return 1;
    if (width > 600) return 3;
    return 2;
  }

  // Responsive Grid Aspect Ratio
  static double gridChildAspectRatio(BuildContext context) {
    final double width = MediaQuery.of(context).size.width;
    if (width < 340) return 2.2;
    if (width < 380) return 1.25;
    if (width > 600) return 1.5;
    return 1.35;
  }

  // Minimum Touch Target Height
  static double minTouchTarget = 48.0;
}

class ResponsiveLayout extends StatelessWidget {
  final Widget mobileSmall;
  final Widget mobileNormal;
  final Widget? mobileLarge;

  const ResponsiveLayout({
    super.key,
    required this.mobileSmall,
    required this.mobileNormal,
    this.mobileLarge,
  });

  @override
  Widget build(BuildContext context) {
    final ScreenType type = AppResponsive.getScreenType(context);
    switch (type) {
      case ScreenType.small:
        return mobileSmall;
      case ScreenType.large:
        return mobileLarge ?? mobileNormal;
      case ScreenType.normal:
        return mobileNormal;
    }
  }
}
