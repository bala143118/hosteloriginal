import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import AnnouncementBell from './components/AnnouncementBell';
import AnnouncementModal from './components/AnnouncementModal';
import AnnouncementPanel from './components/AnnouncementPanel';
import AnnouncementHistory from './components/AnnouncementHistory';
import { playNotificationSound } from './notification-sound';
import { showToast } from './toast';
import './styles.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:6000';

function App() {
  const [socket, setSocket] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [currentEmergency, setCurrentEmergency] = useState(null);

  useEffect(() => {
    const socketClient = io(BACKEND_URL);
    setSocket(socketClient);

    socketClient.on('announcement.created', (announcement) => {
      setAnnouncements((prev) => [announcement, ...prev]);
      setUnreadCount((prev) => prev + 1);
      showToast(`${announcement.priority} notice: ${announcement.title}`);
      playNotificationSound();
      if (announcement.priority === 'Emergency') {
        setCurrentEmergency(announcement);
        setShowEmergencyModal(true);
      }
    });

    return () => socketClient.disconnect();
  }, []);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/announcements`)
      .then((res) => res.json())
      .then((data) => setAnnouncements(data))
      .catch(console.error);
  }, []);

  const sortedAnnouncements = useMemo(() => {
    return [...announcements].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [announcements]);

  const handleNotificationClick = () => {
    setShowPanel(true);
    setUnreadCount(0);
  };

  const handleCreateAnnouncement = async (payload) => {
    const response = await fetch(`${BACKEND_URL}/api/announcements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error('Failed to send announcement');
    }

    const announcement = await response.json();
    setAnnouncements((prev) => [announcement, ...prev]);
    setShowAdminModal(false);
  };

  return (
    <div className="app-shell bg-slate-950 text-slate-100 min-h-screen">
      <div className="app-grid">
        <header className="app-header glass-panel">
          <div>
            <h1 className="page-title">HostelFix Live Announcement</h1>
            <p className="text-slate-400">Real-time notices for students and hostel admin teams.</p>
          </div>
          <AnnouncementBell count={unreadCount} onClick={handleNotificationClick} />
        </header>

        <main className="app-main">
          <section className="grid gap-6 lg:grid-cols-2">
            <div className="glass-card animate-slide-up">
              <div className="card-header">
                <div>
                  <h2>Live Announcement</h2>
                  <p className="text-slate-400">Create notices and broadcast them instantly.</p>
                </div>
                <button className="btn-primary" onClick={() => setShowAdminModal(true)}>
                  Create Notice
                </button>
              </div>
              <div className="card-body">
                <p className="text-slate-400 leading-relaxed">
                  Use the admin panel to send announcements to all students or specific hostels.
                </p>
              </div>
            </div>
            <div className="glass-card animate-slide-up delay-100">
              <div className="card-header">
                <div>
                  <h2>Realtime Status</h2>
                  <p className="text-slate-400">Announcements are delivered instantly with sound and toast alerts.</p>
                </div>
              </div>
              <div className="card-grid">
                <div className="status-card">
                  <p className="status-label">Total Announcements</p>
                  <p className="status-value">{announcements.length}</p>
                </div>
                <div className="status-card">
                  <p className="status-label">Unread Alerts</p>
                  <p className="status-value">{unreadCount}</p>
                </div>
                <div className="status-card">
                  <p className="status-label">Latest Priority</p>
                  <p className="status-value">{announcements[0]?.priority || 'None'}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="glass-card mt-6">
            <div className="card-header">
              <div>
                <h2>Announcement History</h2>
                <p className="text-slate-400">Search, filter, and review every notice sent by admin.</p>
              </div>
            </div>
            <AnnouncementHistory announcements={sortedAnnouncements} />
          </section>
        </main>
      </div>

      <AnnouncementModal
        open={showAdminModal}
        onClose={() => setShowAdminModal(false)}
        onSubmit={handleCreateAnnouncement}
      />

      <AnnouncementPanel
        announcements={sortedAnnouncements}
        open={showPanel}
        onClose={() => setShowPanel(false)}
      />

      {showEmergencyModal && currentEmergency && (
        <div className="modal-backdrop">
          <div className="emergency-modal glass-panel scale-in">
            <div className="emergency-header">
              <span>⚠️ EMERGENCY NOTICE</span>
            </div>
            <h3>{currentEmergency.title}</h3>
            <p>{currentEmergency.message}</p>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowEmergencyModal(false)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
