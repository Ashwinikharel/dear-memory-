import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, IS_DEMO } from '../api.js';
import { useAuth } from '../App.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api.post('/auth/login', { email, password }, { token: null });
      login(r.token, r.user);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <h1 className="display">Dear Memory</h1>
        <p className="muted">Sign in to manage events and photos.</p>
        {IS_DEMO && <p className="demo-note small">Demo login: <strong>demo@dearmemory.app</strong> / <strong>demo12345</strong></p>}
        <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="small muted center">Guest? <Link to="/scan">Scan your QR code</Link></p>
      </form>
    </div>
  );
}
