import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const SEEDED_CREDENTIALS = [
  { role: 'SUPERVISOR', name: 'Sarah Connor', email: 'sarah@company.com', password: 'SarahPass#2026', note: 'Supervisor (Full Access)' },
  { role: 'AGENT', name: 'Alex Mercer', email: 'alex@company.com', password: 'AlexPass#2026', note: 'Agent 1 (Urgent/High Tickets)' },
  { role: 'AGENT', name: 'Maya Lin', email: 'maya@company.com', password: 'MayaPass#2026', note: 'Agent 2 (Medium/Bug Tickets)' },
  { role: 'AGENT', name: 'David Kim', email: 'david@company.com', password: 'DavidPass#2026', note: 'Agent 3 (Collaborator)' },
];

const LoginView = () => {
  const [mode, setMode] = useState('LOGIN'); // 'LOGIN' | 'REGISTER'

  // Form Fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  //const [role, setRole] = useState('AGENT');

  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [showHelpers, setShowHelpers] = useState(false);

  const { login, register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (mode === 'LOGIN') {
        await login(email, password);
      } else {
        await register(name, email, password);
      }
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Authentication failed. Please check your credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  const fillCredentials = (cred) => {
    setMode('LOGIN');
    setEmail(cred.email);
    setPassword(cred.password);
    setError(null);
  };

  return (
    <div className="login-wrapper">
      <div className="card" style={{ maxWidth: '480px', width: '100%', padding: '2.5rem', background: 'rgba(30, 41, 59, 0.95)', boxShadow: 'var(--shadow-lg)' }}>
        {/* Branding Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div className="brand-icon" style={{ margin: '0 auto 0.75rem auto', width: '48px', height: '48px', fontSize: '1.5rem' }}>
            🎫
          </div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800 }}>Support Ticketing Hub</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
            Enterprise SLA & RBAC Management Portal
          </p>
        </div>

        {/* Tab Selector: Sign In vs Create Account */}
        <div style={{ display: 'flex', background: 'var(--bg-main)', borderRadius: 'var(--radius-md)', padding: '0.25rem', marginBottom: '1.25rem', border: '1px solid var(--border-color)' }}>
          <button
            type="button"
            className={`btn btn-sm ${mode === 'LOGIN' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1, border: 'none' }}
            onClick={() => { setMode('LOGIN'); setError(null); }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`btn btn-sm ${mode === 'REGISTER' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1, border: 'none' }}
            onClick={() => { setMode('REGISTER'); setError(null); }}
          >
            Create Account
          </button>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <form onSubmit={handleSubmit}>
          {mode === 'REGISTER' && (
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. abc xyz"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Work Email</label>
            <input
              type="email"
              className="form-control"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-control"
              placeholder={mode === 'REGISTER' ? 'At least 6 characters' : '••••••••'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          
          

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '0.5rem', padding: '0.75rem' }}
            disabled={submitting}
          >
            {submitting ? 'Authenticating...' : mode === 'LOGIN' ? 'Sign In' : 'Register & Create Account'}
          </button>
        </form>

        {/* Collapsible Test Account Helper */}
        <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
          <button
            type="button"
            onClick={() => setShowHelpers(!showHelpers)}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', margin: '0 auto' }}
          >
            <span>{showHelpers ? '▼ Hide' : '▶ Show'} Seeded Test Accounts</span>
          </button>

          {showHelpers && (
            <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.78rem' }}>
              {SEEDED_CREDENTIALS.map((cred) => (
                <div
                  key={cred.email}
                  onClick={() => fillCredentials(cred)}
                  style={{
                    background: 'var(--bg-main)',
                    border: '1px solid var(--border-color)',
                    padding: '0.4rem 0.65rem',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    display: 'flex',
                    justify: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>{cred.name}</strong> ({cred.role})
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{cred.email} | {cred.password}</div>
                  </div>
                  <span className="btn btn-secondary btn-sm" style={{ padding: '0.1rem 0.4rem', fontSize: '0.7rem' }}>Use</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
          <span>🔒</span>
          <span>Server-Enforced RBAC & bcrypt Password Encryption</span>
        </div>
      </div>
    </div>
  );
};

export default LoginView;
