import express from 'express';
import { query, getOne, execute } from '../db.js';
import { authenticateToken, requireSupervisor, checkTicketPermission } from '../middleware/auth.js';
import { calculateSLA } from '../utils/sla.js';
import { recordHistory } from '../utils/history.js';

const router = express.Router();

// Helper: Validate status transition state machine
const validateStatusTransition = (currentStatus, newStatus, closedAt = null) => {
  if (currentStatus === newStatus) return { valid: true };

  const validTransitions = {
    NEW: ['OPEN', 'PENDING', 'RESOLVED', 'CLOSED'],
    OPEN: ['PENDING', 'RESOLVED', 'CLOSED'],
    PENDING: ['OPEN', 'RESOLVED', 'CLOSED'],
    RESOLVED: ['OPEN', 'CLOSED'],
    CLOSED: ['OPEN'],
  };

  const allowed = validTransitions[currentStatus] || [];
  if (!allowed.includes(newStatus)) {
    return {
      valid: false,
      reason: `Illegal status move from '${currentStatus}' to '${newStatus}'. Allowed transitions from '${currentStatus}' are: ${allowed.join(', ') || 'none'}.`,
    };
  }

  // If reopening a CLOSED ticket, check 7-day window
  if (currentStatus === 'CLOSED' && newStatus === 'OPEN') {
    if (!closedAt) {
      return { valid: false, reason: 'Closed timestamp missing for reopening validation.' };
    }
    const closedDate = new Date(closedAt).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - closedDate > sevenDaysMs) {
      return {
        valid: false,
        reason: 'Ticket closed window expired. Tickets closed for more than 7 days cannot be reopened.',
      };
    }
  }

  return { valid: true };
};

// 1. GET /api/tickets - Queue View (Server-side search, filter, sort, pagination)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const {
      search = '',
      status,
      priority,
      category,
      assignee_id,
      mine_only = 'false',
      is_archived = 'false',
      sort_by = 'created_at',
      sort_order = 'DESC',
      page = 1,
      limit = 10,
    } = req.query;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const offset = (pageNum - 1) * limitNum;

    let whereClauses = [];
    let params = [];

    // Archived filter (default 0)
    const archivedFlag = is_archived === 'true' ? 1 : 0;
    whereClauses.push('t.is_archived = ?');
    params.push(archivedFlag);

    // Text search over subject and description
    if (search.trim()) {
      whereClauses.push('(t.subject LIKE ? OR t.description LIKE ? OR t.ticket_number LIKE ? OR t.requester_name LIKE ?)');
      const searchTerm = `%${search.trim()}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Status filter
    if (status) {
      whereClauses.push('t.status = ?');
      params.push(status);
    }

    // Priority filter
    if (priority) {
      whereClauses.push('t.priority = ?');
      params.push(priority);
    }

    // Category filter
    if (category) {
      whereClauses.push('t.category = ?');
      params.push(category);
    }

    // Assignee filter
    if (assignee_id) {
      whereClauses.push('t.primary_assignee_id = ?');
      params.push(assignee_id);
    }

    // Mine Only filter (Primary assignee or collaborator)
    if (mine_only === 'true' || user.role === 'AGENT') {
      if (mine_only === 'true') {
        whereClauses.push(`(
          t.primary_assignee_id = ? OR 
          t.id IN (SELECT ticket_id FROM ticket_collaborators WHERE user_id = ?)
        )`);
        params.push(user.id, user.id);
      }
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Allowed sort fields
    const validSortFields = {
      created_at: 't.created_at',
      priority: `CASE t.priority 
        WHEN 'URGENT' THEN 1 
        WHEN 'HIGH' THEN 2 
        WHEN 'MEDIUM' THEN 3 
        WHEN 'LOW' THEN 4 
        ELSE 5 END`,
      updated_at: 't.updated_at',
    };
    const sortFieldSQL = validSortFields[sort_by] || 't.created_at';
    const sortOrderSQL = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Count Total Matches
    const countResult = await getOne(
      `SELECT COUNT(DISTINCT t.id) as total FROM tickets t ${whereSQL}`,
      params
    );
    const totalMatches = countResult ? countResult.total : 0;

    // Fetch Paginated Tickets
    const sql = `
      SELECT t.*, u.name as primary_assignee_name, u.email as primary_assignee_email
      FROM tickets t
      LEFT JOIN users u ON t.primary_assignee_id = u.id
      ${whereSQL}
      ORDER BY ${sortFieldSQL} ${sortOrderSQL}
      LIMIT ? OFFSET ?
    `;

    const tickets = await query(sql, [...params, limitNum, offset]);

    // Attach SLA metrics & collaborators list to each ticket
    const enrichedTickets = await Promise.all(
      tickets.map(async (t) => {
        const sla = calculateSLA(t);
        const collabs = await query(
          `SELECT u.id, u.name, u.email FROM ticket_collaborators tc
           JOIN users u ON tc.user_id = u.id
           WHERE tc.ticket_id = ?`,
          [t.id]
        );
        return {
          ...t,
          sla,
          collaborators: collabs,
        };
      })
    );

    res.json({
      tickets: enrichedTickets,
      pagination: {
        total: totalMatches,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalMatches / limitNum) || 1,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tickets queue.', details: err.message });
  }
});

// 2. GET /api/tickets/export-csv - Download Queue as CSV
router.get('/export-csv', authenticateToken, async (req, res) => {
  try {
    const { status, priority, category, is_archived = 'false', search = '' } = req.query;

    let whereClauses = ['t.is_archived = ?'];
    let params = [is_archived === 'true' ? 1 : 0];

    if (search.trim()) {
      whereClauses.push('(t.subject LIKE ? OR t.description LIKE ?)');
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }
    if (status) {
      whereClauses.push('t.status = ?');
      params.push(status);
    }
    if (priority) {
      whereClauses.push('t.priority = ?');
      params.push(priority);
    }
    if (category) {
      whereClauses.push('t.category = ?');
      params.push(category);
    }

    const whereSQL = `WHERE ${whereClauses.join(' AND ')}`;
    const sql = `
      SELECT t.ticket_number, t.subject, t.status, t.priority, t.category,
             t.requester_name, t.requester_email, COALESCE(u.name, 'Unassigned') as assignee,
             t.created_at, t.updated_at
      FROM tickets t
      LEFT JOIN users u ON t.primary_assignee_id = u.id
      ${whereSQL}
      ORDER BY t.created_at DESC
    `;

    const tickets = await query(sql, params);

    // Build CSV Header & Rows
    let csv = 'Ticket Number,Subject,Status,Priority,Category,Requester,Requester Email,Assignee,Created At,Updated At\n';
    tickets.forEach((row) => {
      const escape = (val) => `"${String(val || '').replace(/"/g, '""')}"`;
      csv += `${escape(row.ticket_number)},${escape(row.subject)},${escape(row.status)},${escape(row.priority)},${escape(row.category)},${escape(row.requester_name)},${escape(row.requester_email)},${escape(row.assignee)},${escape(row.created_at)},${escape(row.updated_at)}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="tickets_queue_export.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export CSV.', details: err.message });
  }
});

// 3. POST /api/tickets - Create New Ticket
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { subject, description, requester_name, requester_email, priority, category, primary_assignee_id, collaborator_ids = [] } = req.body;

    if (!subject || !description || !requester_name || !requester_email) {
      return res.status(400).json({ error: 'Subject, description, requester name and email are required.' });
    }

    // Generate unique ticket number
    const countRow = await getOne('SELECT COUNT(*) as count FROM tickets');
    const ticketNum = `TCK-${1000 + (countRow ? countRow.count + 1 : 1)}`;

    const result = await execute(
      `INSERT INTO tickets (ticket_number, subject, description, requester_name, requester_email, status, priority, category, primary_assignee_id)
       VALUES (?, ?, ?, ?, ?, 'NEW', ?, ?, ?)`,
      [
        ticketNum,
        subject,
        description,
        requester_name,
        requester_email,
        priority || 'MEDIUM',
        category || 'QUESTION',
        primary_assignee_id || null,
      ]
    );

    const ticketId = result.lastID;

    // Add Collaborators
    if (Array.isArray(collaborator_ids) && collaborator_ids.length > 0) {
      for (const userId of collaborator_ids) {
        await execute(
          'INSERT OR IGNORE INTO ticket_collaborators (ticket_id, user_id) VALUES (?, ?)',
          [ticketId, userId]
        );
      }
    }

    // Record Immutable Audit History
    await recordHistory({
      ticketId,
      actorId: req.user.id,
      actorName: req.user.name,
      actionType: 'TICKET_CREATED',
      newValue: 'NEW',
      details: `Ticket ${ticketNum} created with priority ${priority || 'MEDIUM'} and category ${category || 'QUESTION'}.`,
    });

    const newTicket = await getOne('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    res.status(201).json({ ticket: newTicket });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create ticket.', details: err.message });
  }
});

// 4. GET /api/tickets/:id - Fetch Single Ticket with details, replies, timeline
router.get('/:id', authenticateToken, checkTicketPermission, async (req, res) => {
  try {
    const ticketId = req.params.id;
    const ticket = await getOne(
      `SELECT t.*, u.name as primary_assignee_name, u.email as primary_assignee_email
       FROM tickets t
       LEFT JOIN users u ON t.primary_assignee_id = u.id
       WHERE t.id = ?`,
      [ticketId]
    );

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    // Collaborators
    const collaborators = await query(
      `SELECT u.id, u.name, u.email FROM ticket_collaborators tc
       JOIN users u ON tc.user_id = u.id
       WHERE tc.ticket_id = ?`,
      [ticketId]
    );

    // Replies (Chronological order)
    const replies = await query(
      `SELECT r.*, u.role as author_role
       FROM replies r
       LEFT JOIN users u ON r.author_id = u.id
       WHERE r.ticket_id = ?
       ORDER BY r.created_at ASC`,
      [ticketId]
    );

    // Immutable Timeline History
    const history = await query(
      `SELECT h.* FROM ticket_history h
       WHERE h.ticket_id = ?
       ORDER BY h.created_at ASC`,
      [ticketId]
    );

    // SLA Calculation
    const sla = calculateSLA(ticket);

    // SLA Acknowledgments
    const acks = await query('SELECT * FROM sla_acknowledgments WHERE ticket_id = ?', [ticketId]);

    res.json({
      ticket,
      collaborators,
      replies,
      history,
      sla,
      acknowledgments: acks,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch ticket details.', details: err.message });
  }
});

// 5. POST /api/tickets/:id/status - Update Status State Machine
router.post('/:id/status', authenticateToken, checkTicketPermission, async (req, res) => {
  try {
    const ticketId = req.params.id;
    const { new_status } = req.body;

    const ticket = await getOne('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    // Validate Transition State Machine
    const validation = validateStatusTransition(ticket.status, new_status, ticket.closed_at);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.reason });
    }

    let pendingStartedAt = ticket.pending_started_at;
    let pendingDurationSeconds = ticket.pending_duration_seconds || 0;
    let resolvedAt = ticket.resolved_at;
    let closedAt = ticket.closed_at;

    const nowIso = new Date().toISOString();

    // 1. Moving INTO Pending -> Pause SLA Clock
    if (new_status === 'PENDING' && ticket.status !== 'PENDING') {
      pendingStartedAt = nowIso;
    }

    // 2. Moving OUT OF Pending -> Resume SLA Clock and accumulate paused time
    if (ticket.status === 'PENDING' && new_status !== 'PENDING' && ticket.pending_started_at) {
      const pendingStart = new Date(ticket.pending_started_at).getTime();
      const deltaSeconds = Math.max(0, Math.floor((Date.now() - pendingStart) / 1000));
      pendingDurationSeconds += deltaSeconds;
      pendingStartedAt = null;
    }

    // 3. Moving to RESOLVED
    if (new_status === 'RESOLVED') {
      resolvedAt = nowIso;
    }

    // 4. Moving to CLOSED
    if (new_status === 'CLOSED') {
      closedAt = nowIso;
    }

    // Execute update
    await execute(
      `UPDATE tickets
       SET status = ?, pending_started_at = ?, pending_duration_seconds = ?,
           resolved_at = ?, closed_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [new_status, pendingStartedAt, pendingDurationSeconds, resolvedAt, closedAt, ticketId]
    );

    // Record Immutable Audit History
    await recordHistory({
      ticketId,
      actorId: req.user.id,
      actorName: req.user.name,
      actionType: 'STATUS_CHANGE',
      oldValue: ticket.status,
      newValue: new_status,
      details: `Status changed from ${ticket.status} to ${new_status} by ${req.user.name}.`,
    });

    const updated = await getOne('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    res.json({ ticket: updated, sla: calculateSLA(updated) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update ticket status.', details: err.message });
  }
});

// 6. POST /api/tickets/:id/reassign - Reassign Primary Assignee (RBAC enforced)
router.post('/:id/reassign', authenticateToken, async (req, res) => {
  try {
    const ticketId = req.params.id;
    const { new_assignee_id } = req.body;
    const user = req.user;

    const ticket = await getOne('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    // Server-enforced rule: Agents CANNOT reassign ticket away from themselves!
    if (user.role === 'AGENT') {
      return res.status(403).json({
        error: 'Forbidden: Agents are not permitted to reassign tickets to other agents. Contact a supervisor.',
      });
    }

    const oldAssignee = ticket.primary_assignee_id
      ? await getOne('SELECT name FROM users WHERE id = ?', [ticket.primary_assignee_id])
      : null;
    const newAssignee = new_assignee_id
      ? await getOne('SELECT name FROM users WHERE id = ?', [new_assignee_id])
      : null;

    await execute(
      'UPDATE tickets SET primary_assignee_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [new_assignee_id || null, ticketId]
    );

    await recordHistory({
      ticketId,
      actorId: user.id,
      actorName: user.name,
      actionType: 'REASSIGNMENT',
      oldValue: oldAssignee ? oldAssignee.name : 'Unassigned',
      newValue: newAssignee ? newAssignee.name : 'Unassigned',
      details: `Ticket reassigned to ${newAssignee ? newAssignee.name : 'Unassigned'} by ${user.name}.`,
    });

    res.json({ message: 'Ticket reassigned successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reassign ticket.', details: err.message });
  }
});

// 7. POST /api/tickets/:id/collaborators - Add/Remove Collaborators
router.post('/:id/collaborators', authenticateToken, checkTicketPermission, async (req, res) => {
  try {
    const ticketId = req.params.id;
    const { collaborator_ids } = req.body; // Array of user IDs

    if (!Array.isArray(collaborator_ids)) {
      return res.status(400).json({ error: 'collaborator_ids must be an array.' });
    }

    // Clear existing & set new
    await execute('DELETE FROM ticket_collaborators WHERE ticket_id = ?', [ticketId]);

    for (const userId of collaborator_ids) {
      await execute('INSERT INTO ticket_collaborators (ticket_id, user_id) VALUES (?, ?)', [ticketId, userId]);
    }

    await recordHistory({
      ticketId,
      actorId: req.user.id,
      actorName: req.user.name,
      actionType: 'COLLABORATORS_UPDATED',
      details: `Collaborators set to IDs: ${collaborator_ids.join(', ')} by ${req.user.name}.`,
    });

    res.json({ message: 'Collaborators updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update collaborators.', details: err.message });
  }
});

// 8. POST /api/tickets/:id/archive & /restore
router.post('/:id/archive', authenticateToken, requireSupervisor, async (req, res) => {
  try {
    await execute('UPDATE tickets SET is_archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);
    await recordHistory({
      ticketId: req.params.id,
      actorId: req.user.id,
      actorName: req.user.name,
      actionType: 'ARCHIVED',
      details: 'Ticket archived by supervisor.',
    });
    res.json({ message: 'Ticket archived.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to archive ticket.' });
  }
});

router.post('/:id/restore', authenticateToken, requireSupervisor, async (req, res) => {
  try {
    await execute('UPDATE tickets SET is_archived = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);
    await recordHistory({
      ticketId: req.params.id,
      actorId: req.user.id,
      actorName: req.user.name,
      actionType: 'RESTORED',
      details: 'Ticket restored by supervisor.',
    });
    res.json({ message: 'Ticket restored.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to restore ticket.' });
  }
});

// 9. POST /api/tickets/bulk-action - Acting on many tickets at once with per-ticket breakdown
router.post('/bulk-action', authenticateToken, async (req, res) => {
  try {
    const { ticket_ids, action, target_assignee_id } = req.body;
    const user = req.user;

    if (!Array.isArray(ticket_ids) || ticket_ids.length === 0) {
      return res.status(400).json({ error: 'ticket_ids array is required.' });
    }

    const results = [];

    for (const id of ticket_ids) {
      const ticket = await getOne('SELECT * FROM tickets WHERE id = ?', [id]);
      if (!ticket) {
        results.push({ ticketId: id, success: false, reason: 'Ticket not found.' });
        continue;
      }

      if (action === 'REASSIGN') {
        if (user.role === 'AGENT') {
          results.push({ ticketId: id, success: false, reason: 'Agents cannot reassign tickets to other agents.' });
          continue;
        }

        const newAssignee = target_assignee_id
          ? await getOne('SELECT name FROM users WHERE id = ?', [target_assignee_id])
          : null;

        await execute('UPDATE tickets SET primary_assignee_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
          target_assignee_id || null,
          id,
        ]);

        await recordHistory({
          ticketId: id,
          actorId: user.id,
          actorName: user.name,
          actionType: 'REASSIGNMENT',
          oldValue: ticket.primary_assignee_id,
          newValue: target_assignee_id,
          details: `Bulk reassigned to ${newAssignee ? newAssignee.name : 'Unassigned'} by ${user.name}.`,
        });

        results.push({ ticketId: id, ticketNumber: ticket.ticket_number, success: true, message: 'Reassigned successfully.' });
      } else if (action === 'CLOSE') {
        const validation = validateStatusTransition(ticket.status, 'CLOSED', ticket.closed_at);
        if (!validation.valid) {
          results.push({ ticketId: id, ticketNumber: ticket.ticket_number, success: false, reason: validation.reason });
          continue;
        }

        await execute(
          "UPDATE tickets SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          [id]
        );

        await recordHistory({
          ticketId: id,
          actorId: user.id,
          actorName: user.name,
          actionType: 'STATUS_CHANGE',
          oldValue: ticket.status,
          newValue: 'CLOSED',
          details: `Bulk closed by ${user.name}.`,
        });

        results.push({ ticketId: id, ticketNumber: ticket.ticket_number, success: true, message: 'Closed successfully.' });
      } else {
        results.push({ ticketId: id, success: false, reason: 'Unknown bulk action.' });
      }
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Bulk operation failed.', details: err.message });
  }
});

// 10. POST /api/tickets/:id/acknowledge-sla - Acknowledge SLA Alert
router.post('/:id/acknowledge-sla', authenticateToken, async (req, res) => {
  try {
    const ticketId = req.params.id;
    const ticket = await getOne('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    const sla = calculateSLA(ticket);
    const breachCount = sla.isBreached ? 1 : 0;

    await execute(
      `INSERT OR REPLACE INTO sla_acknowledgments (ticket_id, user_id, acknowledged_at, breach_count)
       VALUES (?, ?, CURRENT_TIMESTAMP, ?)`,
      [ticketId, req.user.id, breachCount]
    );

    await recordHistory({
      ticketId,
      actorId: req.user.id,
      actorName: req.user.name,
      actionType: 'SLA_ACKNOWLEDGED',
      details: `SLA breach alert acknowledged by ${req.user.name}.`,
    });

    res.json({ message: 'SLA alert acknowledged.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to acknowledge SLA alert.' });
  }
});

export default router;
