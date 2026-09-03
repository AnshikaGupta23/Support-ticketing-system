import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';

const SlaAlertsView = () => {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const res = await api.get('/tickets/alerts');
      setAlerts(res.data.alerts || []);
    } catch (err) {
      console.error('Failed to load SLA alerts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 15000); // live refresh
    return () => clearInterval(interval);
  }, []);

  const handleAcknowledge = async (ticketId) => {
    try {
      await api.post(`/tickets/${ticketId}/acknowledge-sla`);
      fetchAlerts();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to acknowledge alert.');
    }
  };

  const isAssignee = (t) => t.primary_assignee_id === user?.id;
  const isAgent = user?.role === 'AGENT';
  // Acknowledge is reserved for the assigned agent (scenario 10). Supervisors
  // can monitor and reassign, but they cannot snooze another agent's alert.
  const canAck = (t) => !isAgent || isAssignee(t);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>⚡ SLA Alerts & Breach Center</h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Active monitoring center for tickets approaching or exceeding SLA target resolution windows.
          {isAgent
            ? ' You are seeing alerts for tickets assigned to you.'
            : ' Supervisors see every unacknowledged alert across the queue.'}
        </p>
      </div>

      {/* SLA Policy Summary Card */}
      <div className="card" style={{ background: 'rgba(99, 102, 241, 0.08)', borderColor: 'rgba(99, 102, 241, 0.3)' }}>
        <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>
          📐 Standard SLA Resolution Target Policies
        </div>
        <div className="grid-4" style={{ fontSize: '0.85rem' }}>
          <div>🔴 <strong>URGENT:</strong> 2 Hours Target</div>
          <div>🟠 <strong>HIGH:</strong> 4 Hours Target</div>
          <div>🟡 <strong>MEDIUM:</strong> 24 Hours Target</div>
          <div>⚪ <strong>LOW:</strong> 48 Hours Target</div>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
          * SLA timer pauses when ticket status is set to PENDING (waiting on customer).
        </p>
      </div>

      {/* Alerts Table */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Ticket #</th>
              <th>Subject</th>
              <th>Priority</th>
              <th>SLA Status</th>
              <th>Elapsed Active Time</th>
              <th>Target Window</th>
              <th>Assignee</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Scanning SLA clock engines...</td>
              </tr>
            ) : alerts.length === 0 ? (
              <tr>
                <td colSpan="8" style={{ textAlign: 'center', color: 'var(--success)' }}>
                  🎉 Excellent! Zero tickets are currently breaching SLA targets.
                </td>
              </tr>
            ) : (
              alerts.map((t) => {
                const clock = t.sla || {};
                const allowAck = canAck(t);
                return (
                  <tr key={t.id}>
                    <td>
                      <code style={{ fontWeight: 700, color: 'var(--primary)' }}>{t.ticket_number}</code>
                    </td>
                    <td>
                      <Link to={`/tickets/${t.id}`} style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {t.subject}
                      </Link>
                    </td>
                    <td>
                      <span className={`badge badge-${t.priority.toLowerCase()}`}>{t.priority}</span>
                    </td>
                    <td>
                      <span className={`badge ${clock.isBreached ? 'badge-urgent' : 'badge-high'}`}>
                        {clock.slaState}
                      </span>
                    </td>
                    <td style={{ fontWeight: 700, color: clock.isBreached ? 'var(--danger)' : 'var(--warning)' }}>
                      {(clock.activeElapsedSeconds / 3600).toFixed(1)} hrs
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{clock.targetHours} hrs</td>
                    <td>{t.primary_assignee_name || 'Unassigned'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <Link to={`/tickets/${t.id}`} className="btn btn-secondary btn-sm">
                          View
                        </Link>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleAcknowledge(t.id)}
                          disabled={!allowAck}
                          title={allowAck ? '' : 'Only the assigned agent can acknowledge this alert.'}
                        >
                          {isAgent && !isAssignee(t) ? 'Not Your Ticket' : 'Acknowledge'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SlaAlertsView;
