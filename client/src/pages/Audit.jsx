import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api.js';

export default function Audit() {
  const [logs, setLogs] = useState(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { api.get('/audit?limit=500').then((r) => setLogs(r.logs)).catch((e) => setError(e.message)); }, []);

  const shown = (logs || []).filter((l) => !filter || `${l.action} ${l.actor_email || ''} ${l.actor_type} ${l.target || ''}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <div className="page-head">
        <h1 className="display">Activity log</h1>
        <input className="search" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th><th>IP</th></tr></thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.id}>
                <td className="nowrap">{fmtDate(l.created_at)}</td>
                <td>{l.actor_email || l.actor_type}</td>
                <td><span className="badge">{l.action.replaceAll('_', ' ')}</span></td>
                <td className="mono small">{l.target ? l.target.slice(0, 13) : ''}</td>
                <td className="mono small">{l.meta || ''}</td>
                <td className="mono small">{l.ip || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {logs && !shown.length && <p className="muted small">Nothing to show.</p>}
      </div>
    </>
  );
}
