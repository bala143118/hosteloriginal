const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  priority: {
    type: String,
    enum: ['Normal', 'Important', 'Emergency'],
    default: 'Normal'
  },
  audience: {
    type: String,
    enum: ['All Students', 'Boys Hostel', 'Girls Hostel', 'Specific Block'],
    required: true
  },
  adminName: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: () => new Date() }
});

module.exports = mongoose.model('Announcement', announcementSchema);
