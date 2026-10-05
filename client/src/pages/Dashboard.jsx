import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtBytes } from '../api.js';
import { useAuth } from '../App.jsx';

const toInputDate = (d) => d.toISOString().slice(0, 10);

export default function Dashboard() {
  const { user } = useAuth();
  const [events, setEvents] = useState(null);
  const [overview, setOverview] = useState(null);
  const [form, setForm] = useState({ name: '', eventDate: toInputDate(new Date()), endsAt: toInputDate(new Date(Date.now() + 7 * 864e5)) });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/events').then((r) => setEvents(r.events)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    if (user.role === 'admin') api.get('/admin/overview').then(setOverview).catch(() => {});
  }, [user.role]);

  async function create(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post('/events', { name: form.name, eventDate: form.eventDate, endsAt: `${form.endsAt}T23:59:59` });
      setForm((f) => ({ ...f, name: '' }));
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-head">
        <h1 className="display">Events</h1>
      </div>

      {overview && (
        <div className="stats">
          <Stat label="Events" value={overview.events} />
          <Stat label="Photos" value={overview.photos} />
          <Stat label="Storage" value={fmtBytes(overview.storageBytes)} />
          <Stat label="Faces indexed" value={overview.faces} />
          <Stat label="Guest visits" value={overview.guestSessions} />
          <Stat label="Photo views" value={overview.photoViews} />
        </div>
      )}

      <form className="card form-row" onSubmit={create}>
        <label className="grow">New event<input placeholder="e.g. Sharma Wedding" value={form.name} maxLength={120}
          onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label>Event date<input type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} /></label>
        <label title="Face data is deleted automatically after this date + retention period">Ends on
          <input type="date" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} required /></label>
        <button className="btn primary" disabled={busy}>Create event</button>
      </form>
      {error && <p className="error">{error}</p>}

      {events === null ? <p className="muted">Loading…</p> : events.length === 0 ? (
        <div className="empty">No events yet. Create your first one above.</div>
      ) : (
        <div className="event-grid">
          {events.map((ev) => (
            <Link key={ev.id} to={`/events/${ev.id}`} className="card event-card">
              <h3>{ev.name}</h3>
              <p className="muted small">{ev.event_date || 'No date'} · ends {new Date(ev.ends_at).toLocaleDateString()}</p>
              <p className="small">{ev.team_count} teams · {ev.photo_count} photos</p>
              {user.role === 'admin' && <p className="muted small">by {ev.owner_name}</p>}
              {!!ev.faces_purged && <span className="badge">Face data deleted</span>}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function Stat({ label, value }) {
  return <div className="stat"><span className="stat-value">{value}</span><span className="stat-label">{label}</span></div>;
}
