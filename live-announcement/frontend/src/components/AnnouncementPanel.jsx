export default function AnnouncementPanel({ announcements, open, onClose }) {
  if (!open) return null;

  return (
    <div className="panel-slide-in">
      <div className="panel glass-panel">
        <div className="panel-header">
          <div>
            <h3>📢 Live Announcements</h3>
            <p className="text-slate-400">Recent notices and unread alerts.</p>
          </div>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        <div className="panel-list">
          {announcements.length === 0 ? (
            <div className="empty-state">No announcements yet.</div>
          ) : (
            announcements.map((item) => (
              <div key={item._id || item.id} className={`panel-item ${item.priority === 'Emergency' ? 'priority-emergency' : item.priority === 'Important' ? 'priority-important' : 'priority-normal'}`}>
                <div className="panel-item-meta">
                  <span className="priority-dot" />
                  <span className="priority-label">{item.priority}</span>
                </div>
                <h4>{item.title}</h4>
                <p>{item.message}</p>
                <div className="panel-item-footer">
                  <span>{item.audience}</span>
                  <span>{new Date(item.createdAt).toLocaleString()}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
