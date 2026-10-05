import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';

export default function Account() {
  const { user } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault(); setMsg(''); setError('');
    try { await api.post('/auth/password', form); setForm({ currentPassword: '', newPassword: '' }); setMsg('Password changed.'); } catch (err) { setError(err.message); }
  }

  return (
    <>
      <div className="page-head"><h1 className="display">Account</h1></div>
      <div className="card narrow">
        <p><strong>{user.name}</strong><br /><span className="muted">{user.email} · {user.role}</span></p>
        <form onSubmit={submit} className="stack">
          <label>Current password<input type="password" autoComplete="current-password" value={form.currentPassword}
            onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} required /></label>
          <label>New password (min. 10 characters)<input type="password" minLength={10} autoComplete="new-password" value={form.newPassword}
            onChange={(e) => setForm({ ...form, newPassword: e.target.value })} required /></label>
          {msg && <p className="ok">{msg}</p>}
          {error && <p className="error">{error}</p>}
          <button className="btn primary">Change password</button>
        </form>
      </div>
    </>
  );
}
