import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';

const TicketDetailView = () => {
  const { id } = useParams();
  const { user, isSupervisor } = useAuth();

  const [ticket, setTicket] = useState(null);
  const [collaborators, setCollaborators] = useState([]);
  const [replies, setReplies] = useState([]);
  const [history, setHistory] = useState([]);
  const [slaClock, setSlaClock] = useState(null);
  const [usersList, setUsersList] = useState([]);
  const [activeTab, setActiveTab] = useState('REPLIES'); // REPLIES | TIMELINE

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Reply Form state
  const [replyBody, setReplyBody] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [submittingReply, setSubmittingReply] = useState(false);

  // Reassign / Collaborator state
  const [selectedAssignee, setSelectedAssignee] = useState('');
  const [selectedCollaborator, setSelectedCollaborator] = useState('');

  // Edit Ticket state
  const [isEditing, setIsEditing] = useState(false);
  const [editSubject, setEditSubject] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPriority, setEditPriority] = useState('MEDIUM');
  const [editCategory, setEditCategory] = useState('QUESTION');
  const [editRequesterName, setEditRequesterName] = useState('');
  const [editRequesterEmail, setEditRequesterEmail] = useState('');
  const [submittingEdit, setSubmittingEdit] = useState(false);

  const startEditing = () => {
    if (!ticket) return;
    setEditSubject(ticket.subject || '');
    setEditDescription(ticket.description || '');
    setEditPriority(ticket.priority || 'MEDIUM');
    setEditCategory(ticket.category || 'QUESTION');
    setEditRequesterName(ticket.requester_name || '');
    setEditRequesterEmail(ticket.requester_email || '');
    setIsEditing(true);
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    setSubmittingEdit(true);
    try {
      await api.put(`/tickets/${id}`, {
        subject: editSubject,
        description: editDescription,
        priority: editPriority,
        category: editCategory,
        requester_name: editRequesterName,
        requester_email: editRequesterEmail,
      });
      setIsEditing(false);
      fetchTicketDetails();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update ticket details.');
    } finally {
      setSubmittingEdit(false);
    }
  };

    const handleArchive = async () => {
    if (!window.confirm('Archive this ticket? It will be hidden from the default queue view.')) return;
    try {
      await api.post(`/tickets/${id}/archive`);
      fetchTicketDetails();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to archive ticket.');
    }
  };

  const handleRestore = async () => {
    try {
      await api.post(`/tickets/${id}/restore`);
      fetchTicketDetails();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to restore ticket.');
    }
  };

  const fetchTicketDetails = async () => {
    try {
      const res = await api.get(`/tickets/${id}`);
      setTicket(res.data.ticket);
      setCollaborators(res.data.collaborators || []);
      setReplies(res.data.replies || []);
      setHistory(res.data.history || []);
      setSlaClock(res.data.sla || null);
      setSelectedAssignee(res.data.ticket.primary_assignee_id || '');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load ticket details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTicketDetails();
    api.get('/auth/users').then((res) => setUsersList(res.data.users || []));
  }, [id]);

  // Live timer interval update
  useEffect(() => {
    const timer = setInterval(() => {
      if (ticket && ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED' && ticket.status !== 'PENDING') {
        fetchTicketDetails();
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [ticket]);

  // Transition status
  const handleStatusTransition = async (newStatus) => {
    try {
      await api.post(`/tickets/${id}/status`, { new_status: newStatus });
      fetchTicketDetails();
    } catch (err) {
      alert(err.response?.data?.error || 'Status transition failed.');
    }
  };

  // Handle Primary Reassign
  const handleReassign = async (newAssigneeId) => {
    try {
      await api.post(`/tickets/${id}/reassign`, {
        new_assignee_id: newAssigneeId ? Number(newAssigneeId) : null,
      });
      fetchTicketDetails();
    } catch (err) {
      alert(err.response?.data?.error || 'Reassignment failed.');
      setSelectedAssignee(ticket.primary_assignee_id || '');
    }
  };

  // Add Collaborator
  const handleAddCollaborator = async () => {
    if (!selectedCollaborator) return;
    try {
      await api.post(`/tickets/${id}/collaborators`, {
        user_id: Number(selectedCollaborator),
        action: 'ADD',
      });
      setSelectedCollaborator('');
      fetchTicketDetails();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add collaborator.');
    }
  };

  // Remove Collaborator
  const handleRemoveCollaborator = async (userId) => {
    try {
      await api.post(`/tickets/${id}/collaborators`, {
        user_id: userId,
        action: 'REMOVE',
      });
      fetchTicketDetails();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove collaborator.');
    }
  };

  // Post Reply
  const handlePostReply = async (e) => {
    e.preventDefault();
    if (!replyBody.trim()) return;

    setSubmittingReply(true);
    try {
      await api.post(`/tickets/${id}/replies`, {
        body: replyBody,
        is_internal_note: isInternalNote,
      });
      setReplyBody('');
      fetchTicketDetails();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to post reply.');
    } finally {
      setSubmittingReply(false);
    }
  };

  // Simulate Customer Reply
  const handleSimulateCustomerReply = async () => {
    try {
      await api.post(`/tickets/${id}/replies`, {
        body: 'Hello team, I am replying as the customer to provide the requested logs. Please check!',
        is_internal_note: false,
        author_name: ticket.requester_name,
        author_email: ticket.requester_email,
      });
      fetchTicketDetails();
    } catch (err) {
      alert('Simulation failed.');
    }
  };

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading ticket details...</div>;
  if (error || !ticket) return <div className="alert alert-danger">{error || 'Ticket not found.'}</div>;

  const isCollaborator = collaborators.some((c) => (c.id || c.user_id) === user?.id);
  const canEdit = isSupervisor || user?.id === ticket.primary_assignee_id || isCollaborator;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header Bar */}
      <div>
        <Link to="/queue" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          ← Back to Ticket Queue
        </Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginTop: '0.5rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <code style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--primary)' }}>
                {ticket.ticket_number}
              </code>
              <span className={`badge badge-${ticket.status.toLowerCase()}`}>{ticket.status}</span>
              <span className={`badge badge-${ticket.priority.toLowerCase()}`}>{ticket.priority}</span>
              <span style={{ fontSize: '0.8rem', background: 'var(--bg-card)', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                {ticket.category}
              </span>
                            {canEdit && !isEditing && (
                <button className="btn btn-secondary btn-sm" onClick={startEditing} style={{ marginLeft: '0.5rem' }}>
                  ✏️ Edit Ticket
                </button>
              )}
              {isSupervisor && !ticket.is_archived && (
                <button className="btn btn-secondary btn-sm" onClick={handleArchive}>
                  🗄️ Archive
                </button>
              )}
              {isSupervisor && ticket.is_archived === 1 && (
                <button className="btn btn-primary btn-sm" onClick={handleRestore}>
                  ♻️ Restore
                </button>
              )}
              {ticket.is_archived === 1 && (
                <span className="badge" style={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)' }}>
                  ARCHIVED
                </span>
              )}
            </div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: '0.4rem' }}>
              {ticket.subject}
            </h1>
          </div>

          {/* Live SLA Countdown Badge */}
          {slaClock && (
            <div
              className={`card`}
              style={{
                padding: '0.75rem 1.25rem',
                borderColor: slaClock.isBreached ? 'var(--danger)' : slaClock.isNearBreach ? 'var(--warning)' : 'var(--success)',
                background: slaClock.isBreached ? 'var(--danger-bg)' : slaClock.isPaused ? 'var(--warning-bg)' : 'var(--bg-card)',
              }}
            >
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-secondary)' }}>
                SLA Status: {slaClock.slaState} {slaClock.isPaused && '(⏸ PAUSED)'}
              </div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, marginTop: '0.15rem' }}>
                {slaClock.isPaused
                  ? 'Clock Paused (Pending)'
                  : `${(slaClock.activeElapsedSeconds / 3600).toFixed(1)}h / ${slaClock.targetHours}h target`}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Grid: Ticket Details & Action Sidebar */}
      <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr', gap: '1.5rem' }}>
        {/* Left Column: Description & Conversation/Timeline Tabs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Edit Form or Ticket Description Card */}
          {isEditing ? (
            <div className="card" style={{ border: '2px solid var(--primary)' }}>
              <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>✏️ Edit Ticket Details</span>
                <button className="btn btn-secondary btn-sm" onClick={() => setIsEditing(false)}>
                  Cancel
                </button>
              </div>
              <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
                <div className="form-group">
                  <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>Subject</label>
                  <input
                    type="text"
                    className="form-control"
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>Description</label>
                  <textarea
                    className="form-control"
                    rows={5}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    required
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>Priority</label>
                    <select
                      className="form-control"
                      value={editPriority}
                      onChange={(e) => setEditPriority(e.target.value)}
                    >
                      <option value="URGENT">URGENT</option>
                      <option value="HIGH">HIGH</option>
                      <option value="MEDIUM">MEDIUM</option>
                      <option value="LOW">LOW</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>Category</label>
                    <select
                      className="form-control"
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                    >
                      <option value="BUG">BUG</option>
                      <option value="BILLING">BILLING</option>
                      <option value="QUESTION">QUESTION</option>
                      <option value="FEATURE">FEATURE</option>
                      <option value="OTHER">OTHER</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>Requester Name</label>
                    <input
                      type="text"
                      className="form-control"
                      value={editRequesterName}
                      onChange={(e) => setEditRequesterName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>Requester Email</label>
                    <input
                      type="email"
                      className="form-control"
                      value={editRequesterEmail}
                      onChange={(e) => setEditRequesterEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIsEditing(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={submittingEdit}>
                    {submittingEdit ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="card">
              <div className="card-title">📝 Issue Description</div>
              <p style={{ whiteSpace: 'pre-wrap', color: 'var(--text-primary)', fontSize: '0.95rem', lineHeight: '1.6' }}>
                {ticket.description}
              </p>
              <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '1.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <div>Requester: <strong>{ticket.requester_name}</strong> ({ticket.requester_email})</div>
                <div>Created: <strong>{new Date(ticket.created_at).toLocaleString()}</strong></div>
              </div>
            </div>
          )}

          {/* Tabs header */}
          <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            <button
              className={`btn ${activeTab === 'REPLIES' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
              onClick={() => setActiveTab('REPLIES')}
            >
              💬 Conversation ({replies.length})
            </button>
            <button
              className={`btn ${activeTab === 'TIMELINE' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
              onClick={() => setActiveTab('TIMELINE')}
            >
              📜 Immutable History Timeline ({history.length})
            </button>
          </div>

          {/* Conversation Tab */}
          {activeTab === 'REPLIES' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Add Reply Form */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Post Response or Internal Note</div>
                  <button className="btn btn-secondary btn-sm" onClick={handleSimulateCustomerReply}>
                    ⚡ Simulate Customer Reply
                  </button>
                </div>
                <form onSubmit={handlePostReply}>
                  <div className="form-group">
                    <textarea
                      className="form-control"
                      placeholder="Type your response here..."
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      required
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={isInternalNote}
                        onChange={(e) => setIsInternalNote(e.target.checked)}
                      />
                      🔒 Staff-Only Internal Note
                    </label>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={submittingReply}>
                      {submittingReply ? 'Posting...' : isInternalNote ? 'Post Internal Note' : 'Send Reply'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Replies Thread */}
              {replies.map((r) => (
                <div
                  key={r.id}
                  className="card"
                  style={{
                    borderLeft: r.is_internal_note ? '4px solid var(--warning)' : '4px solid var(--primary)',
                    background: r.is_internal_note ? 'rgba(245, 158, 11, 0.05)' : 'var(--bg-card)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{r.author_name}</span>
                      {r.is_internal_note && <span className="badge badge-pending">Internal Note</span>}
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {new Date(r.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                    {r.body}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Timeline Tab */}
          {activeTab === 'TIMELINE' && (
            <div className="card">
              <div className="card-title">📜 Audit History Log (Storage Immutable)</div>
              <div className="timeline">
                {history.map((h) => (
                  <div key={h.id} className="timeline-item">
                    <div className="timeline-dot" />
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                      {h.action_type.replace('_', ' ')} by {h.actor_name || 'System'}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                      {h.details || `Changed from "${h.old_value}" to "${h.new_value}"`}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                      {new Date(h.created_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar: Controls & Assignment */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Lifecycle State Machine Controls */}
          <div className="card">
            <div className="card-title">⚙️ Transition Status</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button
                className={`btn ${ticket.status === 'OPEN' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                onClick={() => handleStatusTransition('OPEN')}
                disabled={ticket.status === 'OPEN'}
              >
                Set OPEN (Resume Clock)
              </button>
              <button
                className={`btn ${ticket.status === 'PENDING' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                onClick={() => handleStatusTransition('PENDING')}
                disabled={ticket.status === 'PENDING'}
              >
                Set PENDING (Pause Clock)
              </button>
              <button
                className={`btn ${ticket.status === 'RESOLVED' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                onClick={() => handleStatusTransition('RESOLVED')}
                disabled={ticket.status === 'RESOLVED'}
              >
                Set RESOLVED
              </button>
              <button
                className={`btn ${ticket.status === 'CLOSED' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                onClick={() => handleStatusTransition('CLOSED')}
                disabled={ticket.status === 'CLOSED'}
              >
                Set CLOSED
              </button>
            </div>
          </div>

          {/* Primary Assignee Selector */}
          <div className="card">
            <div className="card-title">👤 Primary Assignee</div>
            <select
              className="form-control"
              value={selectedAssignee}
              onChange={(e) => {
                setSelectedAssignee(e.target.value);
                handleReassign(e.target.value);
              }}
            >
              <option value="">Unassigned</option>
              {usersList.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </select>
            {!isSupervisor && user?.id === ticket.primary_assignee_id && (
              <p style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: '0.5rem' }}>
                ⚠️ As an Agent, server RBAC rejects reassigning tickets away from yourself.
              </p>
            )}
          </div>

          {/* Collaborators Manager */}
          <div className="card">
            <div className="card-title">👥 Collaborators</div>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <select
                className="form-control"
                style={{ fontSize: '0.85rem' }}
                value={selectedCollaborator}
                onChange={(e) => setSelectedCollaborator(e.target.value)}
              >
                <option value="">Select user...</option>
                {usersList
                  .filter((u) => u.id !== ticket.primary_assignee_id && !collaborators.some((c) => c.user_id === u.id))
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
              <button className="btn btn-primary btn-sm" onClick={handleAddCollaborator}>
                Add
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {collaborators.length === 0 ? (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No collaborators added.</span>
              ) : (
                collaborators.map((c) => (
                  <div
                    key={c.user_id}
                    style={{
                      display: 'flex',
                      justify: 'space-between',
                      alignItems: 'center',
                      background: 'var(--bg-main)',
                      padding: '0.35rem 0.6rem',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.85rem',
                    }}
                  >
                    <span>{c.user_name}</span>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '0.1rem 0.3rem', fontSize: '0.7rem' }}
                      onClick={() => handleRemoveCollaborator(c.user_id)}
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TicketDetailView;
