import 'package:flutter_test/flutter_test.dart';
import 'package:smart_surveillance_mobile/main.dart';

void main() {
  testWidgets('App smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const SmartSurveillanceApp());
    expect(find.text('Smart Surveillance'), findsWidgets);
  });
}
