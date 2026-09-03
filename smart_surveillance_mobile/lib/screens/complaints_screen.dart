import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/complaint_provider.dart';
import '../utils/helpers.dart';
import '../utils/responsive.dart';
import '../widgets/empty_state.dart';

class ComplaintsScreen extends StatelessWidget {
  const ComplaintsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final complaintProvider = Provider.of<ComplaintProvider>(context);
    final double px = AppResponsive.paddingHorizontal(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Maintenance & Complaints', style: TextStyle(fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: () => complaintProvider.loadComplaints(),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showFileComplaintSheet(context, complaintProvider),
        icon: const Icon(Icons.build_rounded),
        label: const Text('File Complaint'),
      ),
      body: RefreshIndicator(
        onRefresh: () => complaintProvider.loadComplaints(),
        child: complaintProvider.complaints.isEmpty
            ? EmptyState(
                icon: Icons.handyman_outlined,
                title: 'No Complaints Logged',
                message: 'No maintenance issues or complaints submitted.',
                actionLabel: 'Report Issue',
                onAction: () => _showFileComplaintSheet(context, complaintProvider),
              )
            : ListView.builder(
                padding: EdgeInsets.symmetric(horizontal: px, vertical: 12),
                itemCount: complaintProvider.complaints.length,
                itemBuilder: (context, index) {
                  final item = complaintProvider.complaints[index];
                  final bool isPending = item.status.toLowerCase() == 'pending';
                  final Color statusColor = isPending
                      ? Colors.amber.shade800
                      : (item.status.toLowerCase() == 'in progress' ? Colors.blue : Colors.green);

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
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Icon(Icons.build_circle_outlined, color: statusColor, size: 22),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(item.title, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                                    Text('${item.category} • ${item.roomNumber}', style: theme.textTheme.bodySmall),
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
                                  item.status.toUpperCase(),
                                  style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.bold),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          Text(item.description, style: theme.textTheme.bodyMedium),
                          const SizedBox(height: 10),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text('By ${item.studentName}', style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.bold)),
                              Text(AppHelpers.formatTimestamp(item.createdAt), style: theme.textTheme.bodySmall),
                            ],
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
      ),
    );
  }

  void _showFileComplaintSheet(BuildContext context, ComplaintProvider provider) {
    final titleController = TextEditingController();
    final descController = TextEditingController();
    String category = 'Wi-Fi / Internet';

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
              Text('Submit Maintenance Request', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                value: category,
                items: const [
                  DropdownMenuItem(value: 'Wi-Fi / Internet', child: Text('Wi-Fi / Internet Issue')),
                  DropdownMenuItem(value: 'Plumbing', child: Text('Plumbing / Water Leakage')),
                  DropdownMenuItem(value: 'Electrical', child: Text('Electrical & Lights')),
                  DropdownMenuItem(value: 'Food & Mess', child: Text('Food & Mess Quality')),
                  DropdownMenuItem(value: 'Cleanliness', child: Text('Room / Corridor Hygiene')),
                ],
                onChanged: (val) => category = val ?? 'Wi-Fi / Internet',
                decoration: InputDecoration(
                  labelText: 'Issue Category',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: titleController,
                decoration: InputDecoration(
                  labelText: 'Subject / Brief Summary',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: descController,
                maxLines: 3,
                decoration: InputDecoration(
                  labelText: 'Detailed Description',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () async {
                  if (titleController.text.trim().isEmpty || descController.text.trim().isEmpty) return;
                  await provider.fileComplaint(
                    title: titleController.text.trim(),
                    description: descController.text.trim(),
                    category: category,
                  );
                  if (context.mounted) Navigator.pop(context);
                },
                child: const Text('SUBMIT MAINTENANCE COMPLAINT'),
              ),
            ],
          ),
        );
      },
    );
  }
}
