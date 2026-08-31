import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  Legend,
} from 'recharts';

const STATUS_COLORS = {
  NEW: '#38bdf8',
  OPEN: '#4ade80',
  PENDING: '#fbbf24',
  RESOLVED: '#c084fc',
  CLOSED: '#94a3b8',
};

const DashboardView = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await api.get('/dashboard/stats');
        setStats(res.data.stats);
      } catch (err) {
        setError('Failed to fetch dashboard metrics.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading analytics dashboard...</div>;
  }

  if (error || !stats) {
    return <div className="alert alert-danger">{error || 'Dashboard unavailable.'}</div>;
  }

  const statusPieData = stats.status_breakdown.map((item) => ({
    name: item.status,
    value: item.count,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* SLA Breach Alert Banner */}
      {stats.sla_breached > 0 && (
        <div className="alert alert-danger" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>⚠️ SLA Warning:</strong> {stats.sla_breached} ticket(s) currently exceed active SLA resolution targets!
          </div>
          <Link to="/sla-alerts" className="btn btn-danger btn-sm">
            View Breach Alerts →
          </Link>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid-4">
        <div className="card">
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Active Open Tickets</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#4ade80', marginTop: '0.25rem' }}>
            {stats.open_tickets}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Requires agent action</div>
        </div>

        <div className="card">
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Pending on Customer</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#fbbf24', marginTop: '0.25rem' }}>
            {stats.pending_tickets}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>SLA timer paused</div>
        </div>

        <div className="card">
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Resolved This Week</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#c084fc', marginTop: '0.25rem' }}>
            {stats.resolved_this_week}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Completed lifecycle</div>
        </div>

        <div className="card">
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>SLA Breached</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#f87171', marginTop: '0.25rem' }}>
            {stats.sla_breached}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Active breach alerts</div>
        </div>
      </div>

      {/* Visual Analytics Charts Grid */}
      <div className="grid-2">
        {/* Status Distribution Donut Chart */}
        <div className="card">
          <div className="card-title">📊 Queue Status Distribution</div>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={statusPieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {statusPieData.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || '#6366f1'} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Agent Workload Bar Chart */}
        <div className="card">
          <div className="card-title">👨‍💻 Active Workload by Agent</div>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={stats.agent_workload}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="agent_name" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }}
                />
                <Bar dataKey="ticket_count" fill="#6366f1" radius={[4, 4, 0, 0]} name="Assigned Tickets" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 8-Week Resolution Trend Line Chart */}
      <div className="card">
        <div className="card-title">📈 8-Week Ticket Resolution Trend</div>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={stats.resolution_trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="week" stroke="#94a3b8" fontSize={12} />
              <YAxis stroke="#94a3b8" fontSize={12} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }}
              />
              <Legend />
              <Line type="monotone" dataKey="created" stroke="#38bdf8" strokeWidth={2} name="Created" />
              <Line type="monotone" dataKey="resolved" stroke="#4ade80" strokeWidth={2} name="Resolved" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default DashboardView;
