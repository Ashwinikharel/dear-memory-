import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { useAuth } from '../App.jsx';

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'photographer' });
  const [error, setError] = useState('');

  const load = () => api.get('/users').then((r) => setUsers(r.users)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault(); setError('');
    try { await api.post('/users', form); setForm({ name: '', email: '', password: '', role: 'photographer' }); load(); } catch (err) { setError(err.message); }
  }
  async function remove(u) {
    if (!confirm(`Delete ${u.email}?`)) return;
    try { await api.del(`/users/${u.id}`); load(); } catch (err) { setError(err.message); }
  }

  return (
    <>
      <div className="page-head"><h1 className="display">Photographers</h1></div>
      <form className="card form-row" onSubmit={create}>
        <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label className="grow">Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
        <label>Temporary password<input type="password" minLength={10} autoComplete="new-password" value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label>
        <label>Role<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="photographer">Photographer</option><option value="admin">Admin</option></select></label>
        <button className="btn primary">Add</button>
      </form>
      {error && <p className="error">{error}</p>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Added</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td><td>{u.email}</td><td><span className="badge">{u.role}</span></td><td>{fmtDate(u.created_at)}</td>
                <td>{u.id !== me.id && <button className="link danger-text" onClick={() => remove(u)}>Delete</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
