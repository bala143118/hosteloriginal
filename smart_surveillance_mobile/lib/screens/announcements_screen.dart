import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/announcement_provider.dart';
import '../utils/helpers.dart';
import '../utils/responsive.dart';
import '../widgets/empty_state.dart';

class AnnouncementsScreen extends StatelessWidget {
  const AnnouncementsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final announcementProvider = Provider.of<AnnouncementProvider>(context);
    final double px = AppResponsive.paddingHorizontal(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Live Campus Notices', style: TextStyle(fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: () => announcementProvider.loadAnnouncements(),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showPostNoticeSheet(context, announcementProvider),
        icon: const Icon(Icons.campaign_rounded),
        label: const Text('Post Notice'),
      ),
      body: RefreshIndicator(
        onRefresh: () => announcementProvider.loadAnnouncements(),
        child: announcementProvider.announcements.isEmpty
            ? EmptyState(
                icon: Icons.campaign_outlined,
                title: 'No Announcements',
                message: 'No official campus notices posted today.',
              )
            : ListView.builder(
                padding: EdgeInsets.symmetric(horizontal: px, vertical: 12),
                itemCount: announcementProvider.announcements.length,
                itemBuilder: (context, index) {
                  final notice = announcementProvider.announcements[index];
                  final bool isUrgent = notice.category.toLowerCase() == 'urgent';

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
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: isUrgent ? Colors.red.withValues(alpha: 0.15) : theme.colorScheme.primary.withValues(alpha: 0.15),
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Icon(
                                  isUrgent ? Icons.error_outline_rounded : Icons.campaign_rounded,
                                  color: isUrgent ? Colors.red : theme.colorScheme.primary,
                                  size: 20,
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Text(
                                  notice.title,
                                  style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                                ),
                              ),
                              Chip(
                                label: Text(notice.category, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold)),
                                backgroundColor: isUrgent ? Colors.red.withValues(alpha: 0.15) : null,
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          Text(notice.content, style: theme.textTheme.bodyMedium),
                          const SizedBox(height: 12),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text('By ${notice.author}', style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.bold)),
                              Text(AppHelpers.formatTimestamp(notice.timestamp), style: theme.textTheme.bodySmall),
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

  void _showPostNoticeSheet(BuildContext context, AnnouncementProvider provider) {
    final titleController = TextEditingController();
    final contentController = TextEditingController();
    String category = 'General';

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
              Text('Post Announcement', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 16),
              TextField(
                controller: titleController,
                decoration: InputDecoration(
                  labelText: 'Notice Title',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: contentController,
                maxLines: 3,
                decoration: InputDecoration(
                  labelText: 'Announcement Details',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: category,
                items: const [
                  DropdownMenuItem(value: 'General', child: Text('General Notice')),
                  DropdownMenuItem(value: 'Urgent', child: Text('Urgent Security Notice')),
                  DropdownMenuItem(value: 'Maintenance', child: Text('Hostel Maintenance')),
                ],
                onChanged: (val) => category = val ?? 'General',
                decoration: InputDecoration(
                  labelText: 'Notice Category',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () async {
                  if (titleController.text.trim().isEmpty || contentController.text.trim().isEmpty) return;
                  await provider.postAnnouncement(
                    title: titleController.text.trim(),
                    content: contentController.text.trim(),
                    category: category,
                  );
                  if (context.mounted) Navigator.pop(context);
                },
                child: const Text('BROADCAST ANNOUNCEMENT'),
              ),
            ],
          ),
        );
      },
    );
  }
}
