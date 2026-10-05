import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, downloadProtected } from '../api.js';
import { Stat } from './Dashboard.jsx';
import PhotoUploader from '../components/PhotoUploader.jsx';
import TeamPhotos from '../components/TeamPhotos.jsx';

export default function EventPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [teamName, setTeamName] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([api.get(`/events/${id}`), api.get(`/events/${id}/stats`)]);
      setData(d); setStats(s);
    } catch (e) { setError(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Refresh counts while photos are being processed
  useEffect(() => {
    if (!stats || (stats.queue.waiting === 0 && stats.queue.running === 0)) return;
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, [stats, load]);

  async function addTeam(e) {
    e.preventDefault();
    try { await api.post(`/events/${id}/teams`, { name: teamName }); setTeamName(''); load(); } catch (err) { setError(err.message); }
  }

  async function deleteEvent() {
    const typed = prompt(`This permanently deletes ALL photos, teams, QR codes and face data for "${data.event.name}".\n\nType the event name to confirm:`);
    if (typed !== data.event.name) return;
    try { await api.del(`/events/${id}`); navigate('/'); } catch (err) { setError(err.message); }
  }

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const { event, teams, retentionDays } = data;
  const purgeDate = new Date(new Date(event.ends_at).getTime() + retentionDays * 864e5);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="display">{event.name}</h1>
          <p className="muted small">
            {event.event_date || 'No date'} · ends {new Date(event.ends_at).toLocaleDateString()} ·{' '}
            {event.faces_purged ? 'face data deleted' : `face data auto-deletes on ${purgeDate.toLocaleDateString()}`}
          </p>
        </div>
      </div>

      {stats && (
        <div className="stats">
          <Stat label="Photos" value={stats.photos} />
          <Stat label="Faces found" value={stats.faces} />
          <Stat label="Guest visits" value={stats.guests} />
          <Stat label="Photo views" value={stats.views} />
          {(stats.queue.waiting > 0 || stats.queue.running > 0) && <Stat label="Processing" value={stats.queue.waiting + stats.queue.running} />}
        </div>
      )}

      <form className="card form-row" onSubmit={addTeam}>
        <label className="grow">Add a team<input placeholder="e.g. Bride's family, Table 4, Team Red" value={teamName}
          maxLength={120} onChange={(e) => setTeamName(e.target.value)} required /></label>
        <button className="btn primary">Add team + QR code</button>
      </form>
      {error && <p className="error">{error}</p>}

      {teams.length === 0 && <div className="empty">Add a team to get its unique QR code.</div>}
      <div className="teams">
        {teams.map((t) => <TeamCard key={t.id} team={t} onChange={load} />)}
      </div>

      <section className="danger card">
        <h3>Danger zone</h3>
        <p className="small muted">Deletes every photo, QR code and all face data for this event. This can't be undone.</p>
        <button className="btn danger" onClick={deleteEvent}>Delete event and all data</button>
      </section>
    </>
  );
}

function TeamCard({ team, onChange }) {
  const [qrSrc, setQrSrc] = useState(null);
  const [showPhotos, setShowPhotos] = useState(false);
  const [error, setError] = useState('');
  const qr = team.qr;
  const expired = qr?.expiresAt && new Date(qr.expiresAt) <= new Date();

  useEffect(() => {
    let url;
    api.blob(`/teams/${team.id}/qr?format=png`).then((b) => { url = URL.createObjectURL(b); setQrSrc(url); }).catch(() => {});
    return () => url && URL.revokeObjectURL(url);
  }, [team.id, qr?.url]);

  const run = (fn) => async () => { setError(''); try { await fn(); onChange(); } catch (e) { setError(e.message); } };
  const slug = team.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  const toggle = run(() => api.patch(`/teams/${team.id}/qr`, { disabled: !qr.disabled }));
  const regenerate = run(async () => {
    if (!confirm('Make a new QR code? The old printed QR code will stop working.')) throw new Error('Cancelled');
    await api.post(`/teams/${team.id}/qr/regenerate`, {});
  });
  const setExpiry = run(() => {
    const v = prompt('QR expiry date and time (YYYY-MM-DD HH:MM). Leave empty for no expiry.', qr.expiresAt ? qr.expiresAt.slice(0, 16).replace('T', ' ') : '');
    if (v === null) throw new Error('Cancelled');
    return api.patch(`/teams/${team.id}/qr`, { expiresAt: v.trim() ? new Date(v.trim().replace(' ', 'T')).toISOString() : null });
  });
  const remove = run(() => {
    if (!confirm(`Delete team "${team.name}" with all its photos and face data?`)) throw new Error('Cancelled');
    return api.del(`/teams/${team.id}`);
  });

  return (
    <article className="card team">
      <div className="team-main">
        <div className="qr-box">
          {qrSrc ? <img src={qrSrc} alt={`QR code for ${team.name}`} className={qr?.disabled || expired ? 'qr-off' : ''} /> : <div className="qr-placeholder" />}
          {(qr?.disabled || expired) && <span className="badge warn">{qr.disabled ? 'Turned off' : 'Expired'}</span>}
        </div>
        <div className="team-info">
          <h3>{team.name}</h3>
          <p className="small muted">
            {team.photo_count} photos ({team.processed_count} ready{team.failed_count ? `, ${team.failed_count} failed` : ''}) ·{' '}
            {team.face_count} faces · {team.guest_count} guest visits
          </p>
          <p className="small muted">QR {qr?.expiresAt ? `expires ${new Date(qr.expiresAt).toLocaleString()}` : 'never expires'}</p>
          {qr && <GuestLink url={qr.url} />}
          <p className="small muted">Team ID (for the camera uploader): <code className="mono">{team.id}</code></p>
          <div className="btn-row">
            <button className="btn small" onClick={() => downloadProtected(`/teams/${team.id}/qr?format=png&download=1`, `${slug}.png`)}>Download PNG</button>
            <button className="btn small" onClick={() => downloadProtected(`/teams/${team.id}/qr?format=svg&download=1`, `${slug}.svg`)}>Download SVG</button>
            <button className="btn small ghost" onClick={toggle}>{qr?.disabled ? 'Turn QR on' : 'Turn QR off'}</button>
            <button className="btn small ghost" onClick={setExpiry}>Set expiry</button>
            <button className="btn small ghost" onClick={regenerate}>New QR</button>
            <button className="btn small ghost danger-text" onClick={remove}>Delete team</button>
          </div>
          {error && error !== 'Cancelled' && <p className="error small">{error}</p>}
        </div>
      </div>
      <PhotoUploader teamId={team.id} onUploaded={onChange} />
      <button className="link" onClick={() => setShowPhotos((s) => !s)}>{showPhotos ? 'Hide photos' : `Show photos (${team.photo_count})`}</button>
      {showPhotos && <TeamPhotos teamId={team.id} onChange={onChange} />}
    </article>
  );
}

function GuestLink({ url }) {
  const [copied, setCopied] = useState(false);
  const insecure = url.startsWith('http://') && !/\/\/(localhost|127\.0\.0\.1)[:/]/.test(url);
  async function copy() {
    try { await navigator.clipboard.writeText(url); } catch {
      const t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select();
      document.execCommand('copy'); t.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="guest-link">
      <code className="mono small">{url}</code>
      <span className="btn-row">
        <button className="btn small" onClick={copy}>{copied ? 'Copied!' : 'Copy guest link'}</button>
        <a className="btn small ghost" href={url} target="_blank" rel="noreferrer">Open guest page</a>
      </span>
      {insecure && <p className="small warn-text">Phones only allow the selfie camera on https links. Open this dashboard through your https tunnel link so the QR uses https.</p>}
    </div>
  );
}
