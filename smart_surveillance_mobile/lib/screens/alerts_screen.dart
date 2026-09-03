import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/alert_provider.dart';
import '../widgets/alert_card.dart';
import '../widgets/empty_state.dart';

class AlertsScreen extends StatelessWidget {
  const AlertsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final alertProvider = Provider.of<AlertProvider>(context);
    final filters = ['All', 'Fire', 'Smoke', 'Critical', 'Unread'];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Security Alerts', style: TextStyle(fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: () => alertProvider.loadAlerts(),
          ),
        ],
      ),
      body: Column(
        children: [
          // Filter Chips
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: filters.map((filter) {
                final isSelected = alertProvider.selectedFilter == filter;
                return Padding(
                  padding: const EdgeInsets.only(right: 8.0),
                  child: FilterChip(
                    label: Text(filter),
                    selected: isSelected,
                    onSelected: (_) => alertProvider.setFilter(filter),
                  ),
                );
              }).toList(),
            ),
          ),

          Expanded(
            child: RefreshIndicator(
              onRefresh: () => alertProvider.loadAlerts(),
              child: alertProvider.alerts.isEmpty
                  ? EmptyState(
                      icon: Icons.shield_outlined,
                      title: 'No Alerts Found',
                      message: 'Everything looks normal. No security threats match your filter.',
                      actionLabel: 'Refresh',
                      onAction: () => alertProvider.loadAlerts(),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      itemCount: alertProvider.alerts.length,
                      itemBuilder: (context, index) {
                        final alert = alertProvider.alerts[index];
                        return AlertCard(
                          alert: alert,
                          onAcknowledge: () => alertProvider.acknowledgeAlert(alert.id),
                        );
                      },
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
