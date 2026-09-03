import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/gate_pass_provider.dart';
import '../utils/helpers.dart';
import '../utils/responsive.dart';
import '../widgets/empty_state.dart';

class GatePassScreen extends StatelessWidget {
  const GatePassScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final gatePassProvider = Provider.of<GatePassProvider>(context);
    final double px = AppResponsive.paddingHorizontal(context);
    final filters = ['All', 'Pending', 'Approved'];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Gate Pass System', style: TextStyle(fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: () => gatePassProvider.loadGatePasses(),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showRequestPassSheet(context, gatePassProvider),
        icon: const Icon(Icons.add_card_rounded),
        label: const Text('Request Pass'),
      ),
      body: Column(
        children: [
          // Filter Chips
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: EdgeInsets.symmetric(horizontal: px, vertical: 8),
            child: Row(
              children: filters.map((filter) {
                final isSelected = gatePassProvider.selectedFilter == filter;
                return Padding(
                  padding: const EdgeInsets.only(right: 8.0),
                  child: FilterChip(
                    label: Text(filter),
                    selected: isSelected,
                    onSelected: (_) => gatePassProvider.setFilter(filter),
                  ),
                );
              }).toList(),
            ),
          ),

          Expanded(
            child: RefreshIndicator(
              onRefresh: () => gatePassProvider.loadGatePasses(),
              child: gatePassProvider.passes.isEmpty
                  ? EmptyState(
                      icon: Icons.badge_outlined,
                      title: 'No Gate Passes Found',
                      message: 'No outing or leave passes match your current filter.',
                      actionLabel: 'Request Gate Pass',
                      onAction: () => _showRequestPassSheet(context, gatePassProvider),
                    )
                  : ListView.builder(
                      padding: EdgeInsets.symmetric(horizontal: px, vertical: 8),
                      itemCount: gatePassProvider.passes.length,
                      itemBuilder: (context, index) {
                        final pass = gatePassProvider.passes[index];
                        final bool isPending = pass.status.toLowerCase() == 'pending';
                        final Color statusColor = isPending
                            ? Colors.amber.shade700
                            : (pass.status.toLowerCase() == 'approved' ? Colors.green : Colors.red);

                        return Card(
                          margin: const EdgeInsets.symmetric(vertical: 6),
                          child: Padding(
                            padding: const EdgeInsets.all(16.0),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.all(10),
                                      decoration: BoxDecoration(
                                        color: statusColor.withValues(alpha: 0.12),
                                        borderRadius: BorderRadius.circular(12),
                                      ),
                                      child: Icon(Icons.confirmation_number_outlined, color: statusColor, size: 22),
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            '${pass.passType} Pass • ${pass.id}',
                                            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                                          ),
                                          const SizedBox(height: 2),
                                          Text(
                                            '${pass.studentName} (${pass.block} - ${pass.roomNumber})',
                                            style: theme.textTheme.bodySmall,
                                          ),
                                        ],
                                      ),
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: statusColor.withValues(alpha: 0.15),
                                        borderRadius: BorderRadius.circular(16),
                                        border: Border.all(color: statusColor.withValues(alpha: 0.4)),
                                      ),
                                      child: Text(
                                        pass.status.toUpperCase(),
                                        style: TextStyle(color: statusColor, fontSize: 11, fontWeight: FontWeight.bold),
                                      ),
                                    ),
                                  ],
                                ),
                                const Divider(height: 20),
                                Text('Reason:', style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.bold)),
                                Text(pass.reason, style: theme.textTheme.bodyMedium),
                                const SizedBox(height: 10),
                                Row(
                                  children: [
                                    const Icon(Icons.departure_board_rounded, size: 14, color: Colors.grey),
                                    const SizedBox(width: 4),
                                    Text('Out: ${AppHelpers.formatTimestamp(pass.outTime)}', style: theme.textTheme.bodySmall),
                                    const Spacer(),
                                    const Icon(Icons.access_time_filled_rounded, size: 14, color: Colors.grey),
                                    const SizedBox(width: 4),
                                    Text('In: ${AppHelpers.formatTimestamp(pass.inTime)}', style: theme.textTheme.bodySmall),
                                  ],
                                ),
                                if (isPending) ...[
                                  const SizedBox(height: 12),
                                  SizedBox(
                                    width: double.infinity,
                                    child: FilledButton.tonal(
                                      onPressed: () => gatePassProvider.approvePass(pass.id),
                                      child: const Text('APPROVE PASS (WARDEN)'),
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ),
        ],
      ),
    );
  }

  void _showRequestPassSheet(BuildContext context, GatePassProvider provider) {
    final typeController = TextEditingController(text: 'Outing');
    final reasonController = TextEditingController();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (context) {
        return Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(context).viewInsets.bottom + 20,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Request Gate Pass', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                value: 'Outing',
                items: const [
                  DropdownMenuItem(value: 'Outing', child: Text('Local Outing')),
                  DropdownMenuItem(value: 'Home Leave', child: Text('Home Leave')),
                  DropdownMenuItem(value: 'Emergency', child: Text('Emergency Outing')),
                ],
                onChanged: (val) => typeController.text = val ?? 'Outing',
                decoration: InputDecoration(
                  labelText: 'Pass Type',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: reasonController,
                maxLines: 2,
                decoration: InputDecoration(
                  labelText: 'Reason for Leave / Outing',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () async {
                  if (reasonController.text.trim().isEmpty) return;
                  await provider.createPass(
                    passType: typeController.text,
                    reason: reasonController.text.trim(),
                    outTime: DateTime.now().toIso8601String(),
                    inTime: DateTime.now().add(const Duration(hours: 4)).toIso8601String(),
                  );
                  if (context.mounted) Navigator.pop(context);
                },
                child: const Text('SUBMIT GATE PASS REQUEST'),
              ),
            ],
          ),
        );
      },
    );
  }
}
