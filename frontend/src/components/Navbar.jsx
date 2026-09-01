import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api';

const Navbar = ({ onOpenDocs }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [breachCount, setBreachCount] = useState(0);

  useEffect(() => {
    const fetchBreaches = async () => {
      try {
        const res = await api.get('/dashboard/stats');
        setBreachCount(res.data.stats?.sla_breached || 0);
      } catch (err) {
        console.error('Error loading SLA counts:', err);
      }
    };
    fetchBreaches();
    const interval = setInterval(fetchBreaches, 15000); // refresh SLA counts
    return () => clearInterval(interval);
  }, []);

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <NavLink to="/" className="brand">
          <div className="brand-icon">🎫</div>
          <span>Support Hub</span>
        </NavLink>

        <div className="nav-links">
          <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            📊 Dashboard
          </NavLink>
          <NavLink to="/queue" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            📥 Queue
          </NavLink>
          <NavLink to="/sla-alerts" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            ⚡ SLA Alerts
            {breachCount > 0 && <span className="nav-badge">{breachCount}</span>}
          </NavLink>
          <button
            type="button"
            className="nav-link"
            onClick={onOpenDocs}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            📖 Docs
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Active User Banner */}
          <div className="user-pill">
            <div style={{ fontSize: '0.85rem' }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{user?.name}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{user?.email}</div>
            </div>
            <span className={`role-badge ${user?.role?.toLowerCase()}`}>
              {user?.role}
            </span>
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={logout}
          >
            Sign Out
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
