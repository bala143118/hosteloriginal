require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose');
const announcementRoutes = require('./routes/announcements');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/hostelfix-announcements';
const PORT = process.env.PORT || 6000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  req.io = io;
  next();
});

app.use('/api/announcements', announcementRoutes);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('MongoDB connected');
  server.listen(PORT, () => {
    console.log(`Announcement backend listening on http://localhost:${PORT}`);
  });
}).catch((error) => {
  console.error('MongoDB connection failed:', error);
  process.exit(1);
});

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});
