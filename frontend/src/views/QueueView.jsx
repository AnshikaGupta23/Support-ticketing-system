import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';

const QueueView = () => {
  const { user } = useAuth();

  // Query state
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [category, setCategory] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 10;

  // Agents are always scoped to their own tickets server-side.
  const isAgent = user?.role === 'AGENT';

  // Data state
  const [tickets, setTickets] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [usersList, setUsersList] = useState([]);

  // Selection & Bulk state
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [bulkResultModal, setBulkResultModal] = useState(null);
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);

  // New Ticket Modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTicket, setNewTicket] = useState({
    subject: '',
    description: '',
    requester_name: '',
    requester_email: '',
    priority: 'MEDIUM',
    category: 'QUESTION',
    primary_assignee_id: '',
  });

  // Fetch users for dropdowns
  useEffect(() => {
    api.get('/auth/users')
      .then((res) => setUsersList(res.data.users || []))
      .catch((err) => console.error(err));
  }, []);

  // Fetch ticket queue
  const fetchQueue = async () => {
    setLoading(true);
    try {
      const params = {
        page,
        limit,
        search: search || undefined,
        status: status || undefined,
        priority: priority || undefined,
        category: category || undefined,
        mine_only: mineOnly ? 'true' : undefined,
        is_archived: archived ? 'true' : 'false',
      };
      const res = await api.get('/tickets', { params });
      setTickets(res.data.tickets);
      setPagination(res.data.pagination);
    } catch (err) {
      console.error('Error fetching ticket queue:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
  }, [page, search, status, priority, category, mineOnly, archived]);

  // Handle select all
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(tickets.map((t) => t.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Bulk Reassign / Close Action
  const handleBulkAction = async (actionType) => {
    if (selectedIds.length === 0) return;
    if (actionType === 'REASSIGN' && !bulkAssignee) {
      alert('Please select a target assignee for bulk reassignment.');
      return;
    }

    setIsBulkSubmitting(true);
    try {
      const payload = {
        ticket_ids: selectedIds,
        action: actionType,
        target_assignee_id: actionType === 'REASSIGN' ? Number(bulkAssignee) : undefined,
      };
      const res = await api.post('/tickets/bulk-action', payload);
      setBulkResultModal(res.data.results);
      setSelectedIds([]);
      fetchQueue();
    } catch (err) {
      alert(err.response?.data?.error || 'Bulk action failed.');
    } finally {
      setIsBulkSubmitting(false);
    }
  };

  // Export CSV
  const handleExportCSV = async () => {
    try {
      const params = new URLSearchParams({
        search,
        status,
        priority,
        category,
        mine_only: mineOnly ? 'true' : '',
        is_archived: archived ? 'true' : 'false',
      });
      const response = await api.get(`/tickets/export-csv?${params.toString()}`, {
        responseType: 'blob',
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `ticket-queue-export-${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert('Failed to export CSV file.');
    }
  };

  // Create Ticket Submit
  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/tickets', {
        ...newTicket,
        // Agents always create tickets for themselves; supervisors choose or leave unassigned.
        primary_assignee_id: isAgent ? user.id : (newTicket.primary_assignee_id ? Number(newTicket.primary_assignee_id) : null),
      });
      setIsCreateModalOpen(false);
      setNewTicket({
        subject: '',
        description: '',
        requester_name: '',
        requester_email: '',
        priority: 'MEDIUM',
        category: 'QUESTION',
        primary_assignee_id: '',
      });
      fetchQueue();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create ticket.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Top Controls & Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>📥 Support Queue</h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Showing {pagination.total} ticket(s) across server pages
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={handleExportCSV}>
            📥 Export CSV
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setIsCreateModalOpen(true)}>
            ➕ Create Ticket
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="card" style={{ padding: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto auto', gap: '0.75rem', alignItems: 'center' }}>
          <input
            type="text"
            className="form-control"
            placeholder="🔍 Search subject or description..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />

          <select
            className="form-control"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          >
            <option value="">All Statuses</option>
            <option value="NEW">NEW</option>
            <option value="OPEN">OPEN</option>
            <option value="PENDING">PENDING</option>
            <option value="RESOLVED">RESOLVED</option>
            <option value="CLOSED">CLOSED</option>
          </select>

          <select
            className="form-control"
            value={priority}
            onChange={(e) => { setPriority(e.target.value); setPage(1); }}
          >
            <option value="">All Priorities</option>
            <option value="URGENT">URGENT</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>

          <select
            className="form-control"
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1); }}
          >
            <option value="">All Categories</option>
            <option value="BUG">BUG</option>
            <option value="BILLING">BILLING</option>
            <option value="QUESTION">QUESTION</option>
            <option value="FEATURE">FEATURE</option>
            <option value="OTHER">OTHER</option>
          </select>

          {!isAgent && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input
                type="checkbox"
                checked={mineOnly}
                onChange={(e) => { setMineOnly(e.target.checked); setPage(1); }}
              />
              My Tickets
            </label>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => { setArchived(e.target.checked); setPage(1); }}
            />
            Archived
          </label>
        </div>
      </div>

      {/* Bulk Operation Action Bar */}
      {selectedIds.length > 0 && (
        <div className="alert alert-info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <strong>Selected ({selectedIds.length}):</strong> Apply bulk action to selected queue items
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {!isAgent && (
              <>
                <select
                  className="form-control"
                  style={{ width: 'auto', padding: '0.35rem' }}
                  value={bulkAssignee}
                  onChange={(e) => setBulkAssignee(e.target.value)}
                >
                  <option value="">Select Target Assignee...</option>
                  {usersList
                    .filter((u) => u.role === 'AGENT')
                    .map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                </select>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => handleBulkAction('REASSIGN')}
                  disabled={isBulkSubmitting}
                >
                  Bulk Reassign
                </button>
              </>
            )}
            <button
              className="btn btn-danger btn-sm"
              onClick={() => handleBulkAction('CLOSE')}
              disabled={isBulkSubmitting}
            >
              Bulk Close
            </button>
          </div>
        </div>
      )}

      {/* Tickets Queue Table */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}>
                <input
                  type="checkbox"
                  checked={tickets.length > 0 && selectedIds.length === tickets.length}
                  onChange={handleSelectAll}
                />
              </th>
              <th>Ticket #</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Requester</th>
              <th>Assignee</th>
              <th>Created</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="9" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Loading tickets...</td>
              </tr>
            ) : tickets.length === 0 ? (
              <tr>
                <td colSpan="9" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No tickets matched query criteria.</td>
              </tr>
            ) : (
              tickets.map((t) => (
                <tr key={t.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(t.id)}
                      onChange={() => handleSelectOne(t.id)}
                    />
                  </td>
                  <td>
                    <code style={{ fontWeight: 700, color: 'var(--primary)' }}>{t.ticket_number}</code>
                  </td>
                  <td>
                    <Link to={`/tickets/${t.id}`} style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {t.subject}
                    </Link>
                  </td>
                  <td>
                    <span className={`badge badge-${t.status.toLowerCase()}`}>{t.status}</span>
                  </td>
                  <td>
                    <span className={`badge badge-${t.priority.toLowerCase()}`}>{t.priority}</span>
                  </td>
                  <td>
                    <div style={{ fontSize: '0.85rem' }}>{t.requester_name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.requester_email}</div>
                  </td>
                  <td>
                    <span style={{ fontSize: '0.85rem', color: t.primary_assignee_name ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {t.primary_assignee_name || 'Unassigned'}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {new Date(t.created_at).toLocaleDateString()}
                  </td>
                  <td>
                    <Link to={`/tickets/${t.id}`} className="btn btn-secondary btn-sm">
                      View →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Page {pagination.page} of {pagination.totalPages} ({pagination.total} total items)
        </span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn btn-secondary btn-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Previous
          </button>
          <button
            className="btn btn-secondary btn-sm"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      </div>

      {/* Create Ticket Modal */}
      {isCreateModalOpen && (
        <div className="modal-overlay" onClick={() => setIsCreateModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: '1rem', fontWeight: 800 }}>➕ Create New Support Ticket</h3>
            <form onSubmit={handleCreateSubmit}>
              <div className="form-group">
                <label className="form-label">Subject</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Short description of the issue"
                  value={newTicket.subject}
                  onChange={(e) => setNewTicket({ ...newTicket, subject: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  className="form-control"
                  placeholder="Detailed description of the issue..."
                  value={newTicket.description}
                  onChange={(e) => setNewTicket({ ...newTicket, description: e.target.value })}
                  required
                />
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Requester Name</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Customer Name"
                    value={newTicket.requester_name}
                    onChange={(e) => setNewTicket({ ...newTicket, requester_name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Requester Email</label>
                  <input
                    type="email"
                    className="form-control"
                    placeholder="customer@domain.com"
                    value={newTicket.requester_email}
                    onChange={(e) => setNewTicket({ ...newTicket, requester_email: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="grid-3">
                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <select
                    className="form-control"
                    value={newTicket.priority}
                    onChange={(e) => setNewTicket({ ...newTicket, priority: e.target.value })}
                  >
                    <option value="URGENT">URGENT (2h SLA)</option>
                    <option value="HIGH">HIGH (4h SLA)</option>
                    <option value="MEDIUM">MEDIUM (24h SLA)</option>
                    <option value="LOW">LOW (48h SLA)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <select
                    className="form-control"
                    value={newTicket.category}
                    onChange={(e) => setNewTicket({ ...newTicket, category: e.target.value })}
                  >
                    <option value="BUG">BUG</option>
                    <option value="BILLING">BILLING</option>
                    <option value="QUESTION">QUESTION</option>
                    <option value="FEATURE">FEATURE</option>
                    <option value="OTHER">OTHER</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Assignee</label>
                  <select
                    className="form-control"
                    value={newTicket.primary_assignee_id}
                    onChange={(e) => setNewTicket({ ...newTicket, primary_assignee_id: e.target.value })}
                    disabled={isAgent}
                  >
                    <option value="">Unassigned</option>
                    {usersList
                      .filter((u) => u.role === 'AGENT')
                      .map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                  </select>
                  {isAgent && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                      New tickets will be assigned to you ({user?.name}). Supervisors route tickets to agents.
                    </p>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setIsCreateModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Ticket
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Results Feedback Modal */}
      {bulkResultModal && (
        <div className="modal-overlay" onClick={() => setBulkResultModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: '1rem', fontWeight: 800 }}>📋 Bulk Operation Report</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '50vh', overflowY: 'auto' }}>
              {bulkResultModal.map((res) => (
                <div
                  key={res.ticket_id}
                  className={`alert ${res.success ? 'alert-success' : 'alert-danger'}`}
                  style={{ marginBottom: 0 }}
                >
                  <strong>Ticket #{res.ticket_number}:</strong> {res.message}
                </div>
              ))}
            </div>
            <div style={{ marginTop: '1rem', textAlign: 'right' }}>
              <button className="btn btn-primary" onClick={() => setBulkResultModal(null)}>
                OK, Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QueueView;
