const express = require('express');
const Announcement = require('../models/Announcement');

const router = express.Router();

// List latest announcements with optional filtering and search
router.get('/', async (req, res) => {
  const { search = '', priority, audience } = req.query;
  const filters = {};

  if (priority) {
    filters.priority = priority;
  }
  if (audience) {
    filters.audience = audience;
  }
  if (search) {
    filters.$or = [
      { title: new RegExp(search, 'i') },
      { message: new RegExp(search, 'i') },
      { adminName: new RegExp(search, 'i') }
    ];
  }

  const announcements = await Announcement.find(filters).sort({ createdAt: -1 }).limit(200);
  res.json(announcements);
});

// Create new announcement and broadcast via socket.io
router.post('/', async (req, res) => {
  const { title, message, priority, audience, adminName } = req.body;
  if (!title || !message || !audience || !adminName) {
    return res.status(400).json({ error: 'Title, message, audience and admin name are required.' });
  }

  const announcement = new Announcement({
    title,
    message,
    priority: ['Normal', 'Important', 'Emergency'].includes(priority) ? priority : 'Normal',
    audience,
    adminName
  });

  await announcement.save();

  if (req.io) {
    req.io.emit('announcement.created', announcement);
  }

  res.status(201).json(announcement);
});

// Delete announcement by id
router.delete('/:id', async (req, res) => {
  const announcement = await Announcement.findByIdAndDelete(req.params.id);
  if (!announcement) {
    return res.status(404).json({ error: 'Announcement not found.' });
  }
  res.json({ success: true });
});

module.exports = router;
