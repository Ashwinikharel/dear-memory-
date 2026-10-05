import { createContext, useContext, useEffect, useState } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { api, staffToken } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import EventPage from './pages/EventPage.jsx';
import Users from './pages/Users.jsx';
import Audit from './pages/Audit.jsx';
import Account from './pages/Account.jsx';
import Guest from './pages/Guest.jsx';
import Home from './pages/Home.jsx';
import Scan from './pages/Scan.jsx';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => {
    const here = location.pathname.slice((import.meta.env.BASE_URL || '/').length - 1);
    if (/^\/(t\/|scan)/.test(here)) { setUser(null); return; } // guests never load staff data
    if (!staffToken.get()) { setUser(null); return; }
    api.get('/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null));
  }, []);

  const auth = {
    user,
    login: (token, u) => { staffToken.set(token); setUser(u); },
    logout: () => { staffToken.clear(); setUser(null); },
  };

  return (
    <AuthContext.Provider value={auth}>
      <Routes>
        <Route path="/t/:token" element={<Guest />} />
        <Route path="/scan" element={<Scan />} />
        <Route path="/welcome" element={user ? <Navigate to="/" replace /> : <Home />} />
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/*" element={<StaffArea />} />
      </Routes>
    </AuthContext.Provider>
  );
}

function StaffArea() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (user === undefined) return <div className="page-center muted">Loading…</div>;
  if (!user) return <Navigate to="/welcome" replace />;

  return (
    <div className="staff">
      <header className="topbar">
        <NavLink to="/" className="brand">Dear Memory</NavLink>
        <nav>
          <NavLink to="/" end>Events</NavLink>
          {user.role === 'admin' && <NavLink to="/users">Photographers</NavLink>}
          {user.role === 'admin' && <NavLink to="/audit">Activity log</NavLink>}
          <NavLink to="/account">Account</NavLink>
        </nav>
        <div className="topbar-user">
          <span className="muted">{user.name}</span>
          <button className="btn ghost small" onClick={() => { logout(); navigate('/login'); }}>Sign out</button>
        </div>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/events/:id" element={<EventPage />} />
          <Route path="/account" element={<Account />} />
          {user.role === 'admin' && <Route path="/users" element={<Users />} />}
          {user.role === 'admin' && <Route path="/audit" element={<Audit />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
