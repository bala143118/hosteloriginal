import { useMemo, useState } from 'react';

const PRIORITY_OPTIONS = ['Normal', 'Important', 'Emergency'];
const AUDIENCE_OPTIONS = ['All Students', 'Boys Hostel', 'Girls Hostel', 'Specific Block'];

export default function AnnouncementModal({ open, onClose, onSubmit }) {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState('Normal');
  const [audience, setAudience] = useState('All Students');
  const [adminName, setAdminName] = useState('Admin User');
  const [isSending, setIsSending] = useState(false);

  const canSubmit = useMemo(() => title.trim() && message.trim(), [title, message]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    setIsSending(true);
    try {
      await onSubmit({ title, message, priority, audience, adminName });
      setTitle('');
      setMessage('');
      setPriority('Normal');
      setAudience('All Students');
    } catch (error) {
      console.error(error);
      alert('Unable to send announcement.');
    } finally {
      setIsSending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-card glass-panel scale-in">
        <div className="modal-header">
          <div>
            <h3>Live Announcement</h3>
            <p className="text-slate-400">Publish a notice instantly to students.</p>
          </div>
          <button type="button" className="close-button" onClick={onClose}>×</button>
        </div>
        <form className="modal-form" onSubmit={handleSubmit}>
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Announcement title" />
          </label>
          <label>
            Message
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Enter announcement details" rows={5} />
          </label>
          <div className="field-grid">
            <label>
              Priority
              <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITY_OPTIONS.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              Target Audience
              <select value={audience} onChange={(e) => setAudience(e.target.value)}>
                {AUDIENCE_OPTIONS.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={!canSubmit || isSending}>
              {isSending ? 'Sending...' : 'Send Announcement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
