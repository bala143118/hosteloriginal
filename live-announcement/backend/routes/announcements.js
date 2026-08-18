const express = require('express');
const supabase = require('../supabase');

const router = express.Router();

// List latest announcements with optional filtering and search
router.get('/', async (req, res) => {
  const { search = '', priority, audience } = req.query;
  let query = supabase
    .from('announcements')
    .select('id,title,message,priority,audience,adminName:admin_name,createdAt:created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (priority) query = query.eq('priority', priority);
  if (audience) query = query.eq('audience', audience);
  if (search) {
    const term = String(search).replace(/[,.()]/g, ' ').trim();
    if (term) {
      const pattern = `%${term}%`;
      query = query.or(`title.ilike.${pattern},message.ilike.${pattern},admin_name.ilike.${pattern}`);
    }
  }

  const { data: announcements, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(announcements);
});

// Create new announcement and broadcast via socket.io
router.post('/', async (req, res) => {
  const { title, message, priority, audience, adminName } = req.body;
  if (!title || !message || !audience || !adminName) {
    return res.status(400).json({ error: 'Title, message, audience and admin name are required.' });
  }

  const announcementInput = {
    title,
    message,
    priority: ['Normal', 'Important', 'Emergency'].includes(priority) ? priority : 'Normal',
    audience,
    admin_name: adminName
  };

  const { data: announcement, error } = await supabase
    .from('announcements')
    .insert(announcementInput)
    .select('id,title,message,priority,audience,adminName:admin_name,createdAt:created_at')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  if (req.io) {
    req.io.emit('announcement.created', announcement);
  }

  res.status(201).json(announcement);
});

// Delete announcement by id
router.delete('/:id', async (req, res) => {
  const { data: announcement, error } = await supabase
    .from('announcements')
    .delete()
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!announcement) {
    return res.status(404).json({ error: 'Announcement not found.' });
  }
  res.json({ success: true });
});

module.exports = router;
