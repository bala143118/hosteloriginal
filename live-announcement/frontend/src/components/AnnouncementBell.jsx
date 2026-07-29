import { BellIcon } from '@heroicons/react/24/outline';

export default function AnnouncementBell({ count, onClick }) {
  return (
    <button type="button" className="bell-button" onClick={onClick} aria-label="Open announcements">
      <BellIcon className="bell-icon" />
      {count > 0 && <span className="badge">{count}</span>}
    </button>
  );
}
