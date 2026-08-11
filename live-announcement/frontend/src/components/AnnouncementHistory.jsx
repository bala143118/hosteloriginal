import { useMemo, useState } from 'react';

export default function AnnouncementHistory({ announcements }) {
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('All');

  const filtered = useMemo(() => {
    return announcements.filter((item) => {
      const matchesSearch = search
        ? [item.title, item.message, item.adminName].some((value) => value.toLowerCase().includes(search.toLowerCase()))
        : true;
      const matchesPriority = priorityFilter === 'All' || item.priority === priorityFilter;
      return matchesSearch && matchesPriority;
    });
  }, [announcements, search, priorityFilter]);

  return (
    <div className="history-shell">
      <div className="history-toolbar">
        <input
          className="history-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search announcements"
        />
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
          <option value="All">All Priorities</option>
          <option value="Normal">Normal</option>
          <option value="Important">Important</option>
          <option value="Emergency">Emergency</option>
        </select>
      </div>
      <div className="history-table">
        <div className="history-row header-row">
          <span>Title</span>
          <span>Priority</span>
          <span>Audience</span>
          <span>Sent By</span>
          <span>Date</span>
        </div>
        {filtered.map((item) => (
          <div key={item._id || item.id} className="history-row">
            <span>{item.title}</span>
            <span>{item.priority}</span>
            <span>{item.audience}</span>
            <span>{item.adminName}</span>
            <span>{new Date(item.createdAt).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
