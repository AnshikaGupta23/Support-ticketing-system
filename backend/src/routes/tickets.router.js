import express from 'express';
import { query, getOne, execute } from '../db.js';
import { authenticateToken, checkTicketPermission, userCanActOnTicket } from '../middleware/auth.js';
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

    // Visibility scope: Agents can only see tickets where they are the primary
    // assignee or a collaborator. Supervisors see the whole queue, but can opt
    // into mine_only to narrow to their own tickets.
    if (mine_only === 'true' || user.role === 'AGENT') {
      whereClauses.push(`(
        t.primary_assignee_id = ? OR 
        t.id IN (SELECT ticket_id FROM ticket_collaborators WHERE user_id = ?)
      )`);
      params.push(user.id, user.id);
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

    // Visibility scope: same rule as the queue list — agents export only their
    // own tickets (primary assignee or collaborator).
    const mineOnly = req.query.mine_only === 'true' || req.user.role === 'AGENT';
    if (mineOnly) {
      whereClauses.push(`(
        t.primary_assignee_id = ? OR 
        t.id IN (SELECT ticket_id FROM ticket_collaborators WHERE user_id = ?)
      )`);
      params.push(req.user.id, req.user.id);
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

    // Scenario 1: Agents cannot create tickets and assign them to other agents.
    // They may only create tickets for themselves (or leave unassigned for a
    // supervisor to route).
    let assigneeId = primary_assignee_id || null;
    if (req.user.role === 'AGENT' && assigneeId && assigneeId !== req.user.id) {
      return res.status(403).json({
        error: 'Forbidden: Agents cannot assign tickets to other agents. Create the ticket unassigned or assign it to yourself.',
      });
    }
    if (assigneeId) {
      const assignee = await getOne('SELECT id, role FROM users WHERE id = ?', [assigneeId]);
      if (!assignee) {
        return res.status(400).json({ error: 'Invalid assignee. User does not exist.' });
      }
      if (assignee.role !== 'AGENT') {
        return res.status(400).json({ error: 'Tickets can only be assigned to Agents.' });
      }
    }

    // Validate collaborators exist and are agents (collaborators are always agents).
    const validCollaboratorIds = [];
    if (Array.isArray(collaborator_ids) && collaborator_ids.length > 0) {
      const distinctCollabIds = [...new Set(collaborator_ids.map(Number))];
      const collabRows = await query(
        `SELECT id, role FROM users WHERE id IN (${distinctCollabIds.map(() => '?').join(', ')})`,
        distinctCollabIds
      );
      const collabById = new Map(collabRows.map((c) => [c.id, c.role]));
      for (const userId of distinctCollabIds) {
        const role = collabById.get(userId);
        if (!role) {
          return res.status(400).json({ error: `Collaborator user ${userId} does not exist.` });
        }
        if (role !== 'AGENT') {
          return res.status(400).json({ error: 'Collaborators must be Agents.' });
        }
        validCollaboratorIds.push(userId);
      }
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
        assigneeId,
      ]
    );

    const ticketId = result.lastID;

    // Add Collaborators
    for (const userId of validCollaboratorIds) {
      await execute(
        'INSERT OR IGNORE INTO ticket_collaborators (ticket_id, user_id) VALUES (?, ?)',
        [ticketId, userId]
      );
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
    const acknowledgedForCurrentBreach = acks.some(
      (a) => a.user_id === req.user.id && a.breach_count === (ticket.reopen_count || 0)
    );
    res.json({
      ticket,
      collaborators,
      replies,
      history,
      sla,
      acknowledgments: acks,
      acknowledgedForCurrentBreach,
    });
  }
  catch (err) {
    res.status(500).json({ error: 'Failed to fetch ticket details.', details: err.message });
  }
});

// 4b. PUT & PATCH /api/tickets/:id - Edit Ticket Details (Subject, Description, Priority, Category, Requester)
const updateTicketHandler = async (req, res) => {
  try {
    const ticketId = req.params.id;
    const ticket = await getOne('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    const { subject, description, priority, category, requester_name, requester_email, requester } = req.body;

    const reqName = requester_name !== undefined ? requester_name : (requester && requester.name !== undefined ? requester.name : undefined);
    const reqEmail = requester_email !== undefined ? requester_email : (requester && requester.email !== undefined ? requester.email : undefined);

    // Validate Priority
    if (priority !== undefined) {
      const validPriorities = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
      if (!validPriorities.includes(priority)) {
        return res.status(400).json({
          error: `Invalid priority '${priority}'. Allowed values: ${validPriorities.join(', ')}.`,
        });
      }
    }

    // Validate Category
    if (category !== undefined) {
      const validCategories = ['BUG', 'BILLING', 'QUESTION', 'FEATURE', 'OTHER'];
      if (!validCategories.includes(category)) {
        return res.status(400).json({
          error: `Invalid category '${category}'. Allowed values: ${validCategories.join(', ')}.`,
        });
      }
    }

    const updates = [];
    const params = [];
    const changes = [];
    const oldValuesMap = {};
    const newValuesMap = {};

    if (subject !== undefined && subject !== ticket.subject) {
      if (typeof subject !== 'string' || !subject.trim()) {
        return res.status(400).json({ error: 'Subject cannot be empty.' });
      }
      updates.push('subject = ?');
      params.push(subject.trim());
      oldValuesMap.subject = ticket.subject;
      newValuesMap.subject = subject.trim();
      changes.push(`subject: "${ticket.subject}" -> "${subject.trim()}"`);
    }

    if (description !== undefined && description !== ticket.description) {
      if (typeof description !== 'string' || !description.trim()) {
        return res.status(400).json({ error: 'Description cannot be empty.' });
      }
      updates.push('description = ?');
      params.push(description.trim());
      oldValuesMap.description = ticket.description;
      newValuesMap.description = description.trim();
      changes.push(`description updated`);
    }

    if (priority !== undefined && priority !== ticket.priority) {
      updates.push('priority = ?');
      params.push(priority);
      oldValuesMap.priority = ticket.priority;
      newValuesMap.priority = priority;
      changes.push(`priority: "${ticket.priority}" -> "${priority}"`);
    }

    if (category !== undefined && category !== ticket.category) {
      updates.push('category = ?');
      params.push(category);
      oldValuesMap.category = ticket.category;
      newValuesMap.category = category;
      changes.push(`category: "${ticket.category}" -> "${category}"`);
    }

    if (reqName !== undefined && reqName !== ticket.requester_name) {
      if (typeof reqName !== 'string' || !reqName.trim()) {
        return res.status(400).json({ error: 'Requester name cannot be empty.' });
      }
      updates.push('requester_name = ?');
      params.push(reqName.trim());
      oldValuesMap.requester_name = ticket.requester_name;
      newValuesMap.requester_name = reqName.trim();
      changes.push(`requester_name: "${ticket.requester_name}" -> "${reqName.trim()}"`);
    }

    if (reqEmail !== undefined && reqEmail !== ticket.requester_email) {
      if (typeof reqEmail !== 'string' || !reqEmail.trim()) {
        return res.status(400).json({ error: 'Requester email cannot be empty.' });
      }
      updates.push('requester_email = ?');
      params.push(reqEmail.trim());
      oldValuesMap.requester_email = ticket.requester_email;
      newValuesMap.requester_email = reqEmail.trim();
      changes.push(`requester_email: "${ticket.requester_email}" -> "${reqEmail.trim()}"`);
    }

    if (updates.length === 0) {
      return res.json({ ticket, message: 'No changes detected.' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(ticketId);

    await execute(`UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`, params);

    const numChanged = Object.keys(oldValuesMap).length;
    const oldValueStr = numChanged === 1 ? Object.values(oldValuesMap)[0] : JSON.stringify(oldValuesMap);
    const newValueStr = numChanged === 1 ? Object.values(newValuesMap)[0] : JSON.stringify(newValuesMap);

    await recordHistory({
      ticketId,
      actorId: req.user.id,
      actorName: req.user.name,
      actionType: 'TICKET_EDITED',
      oldValue: oldValueStr,
      newValue: newValueStr,
      details: `Ticket edited by ${req.user.name}: ${changes.join(', ')}.`,
    });

    const updatedTicket = await getOne('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    res.json({ ticket: updatedTicket, message: 'Ticket updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update ticket.', details: err.message });
  }
};

router.put('/:id', authenticateToken, checkTicketPermission, updateTicketHandler);
router.patch('/:id', authenticateToken, checkTicketPermission, updateTicketHandler);

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
    let reopenCount = ticket.reopen_count || 0;

    const nowIso = new Date().toISOString();
    if (ticket.status === 'CLOSED' && new_status === 'OPEN') {
      reopenCount += 1;
    }
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
           resolved_at = ?, closed_at = ?, reopen_count = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [new_status, pendingStartedAt, pendingDurationSeconds, resolvedAt, closedAt, reopenCount, ticketId]
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

    // Scenario 1 server-enforced rule: Agents cannot reassign a ticket away from
    // themselves, and can only reassign tickets they are primary assignee or
    // collaborator on.
    if (user.role === 'AGENT') {
      const canAct = await userCanActOnTicket(user, ticket);
      if (!canAct) {
        return res.status(403).json({
          error: 'Forbidden. You can only act on tickets where you are the primary assignee or a collaborator.',
        });
      }
      if (new_assignee_id && Number(new_assignee_id) !== user.id) {
        return res.status(403).json({
          error: 'Forbidden: Agents cannot reassign tickets to other agents. Contact a supervisor.',
        });
      }
    }

    const oldAssignee = ticket.primary_assignee_id
      ? await getOne('SELECT name FROM users WHERE id = ?', [ticket.primary_assignee_id])
      : null;
    const newAssignee = new_assignee_id
      ? await getOne('SELECT id, name, role FROM users WHERE id = ?', [new_assignee_id])
      : null;
    if (new_assignee_id && !newAssignee) {
      return res.status(400).json({
        error: 'Invalid assignee. User does not exist.',
      });
    }
    if (newAssignee && newAssignee.role !== 'AGENT') {
      return res.status(400).json({
        error: 'Tickets can only be assigned to Agents.',
      });
    } 
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
// Accepts either an array of user IDs ({ collaborator_ids: [...] }) to replace
// the full collaborator list, or a single add/remove ({ user_id, action }).
router.post('/:id/collaborators', authenticateToken, checkTicketPermission, async (req, res) => {
  try {
    const ticketId = req.params.id;
    const { collaborator_ids, user_id, action } = req.body;

    const validateAgent = async (userId) => {
      const userRow = await getOne('SELECT id, role FROM users WHERE id = ?', [userId]);
      if (!userRow) return { error: `User ${userId} does not exist.` };
      if (userRow.role !== 'AGENT') return { error: 'Collaborators must be Agents.' };
      return { userRow };
    };

    if (Array.isArray(collaborator_ids)) {
      // Replace-the-whole-list contract
      const distinctIds = [...new Set(collaborator_ids.map(Number))];
      const currentTicket = await getOne('SELECT primary_assignee_id FROM tickets WHERE id = ?', [ticketId]);
      for (const userId of distinctIds) {
        const validation = await validateAgent(userId);
        if (validation.error) return res.status(400).json({ error: validation.error });
        if (userId === currentTicket?.primary_assignee_id) {
          return res.status(400).json({ error: 'The primary assignee cannot also be listed as a collaborator.' });
        }
      }
      await execute('DELETE FROM ticket_collaborators WHERE ticket_id = ?', [ticketId]);
      for (const userId of distinctIds) {
        await execute('INSERT OR IGNORE INTO ticket_collaborators (ticket_id, user_id) VALUES (?, ?)', [ticketId, userId]);
      }
      await recordHistory({
        ticketId,
        actorId: req.user.id,
        actorName: req.user.name,
        actionType: 'COLLABORATORS_UPDATED',
        details: `Collaborators set to IDs: ${distinctIds.join(', ')} by ${req.user.name}.`,
      });
      return res.json({ message: 'Collaborators updated.' });
    }

    if (user_id && action) {
      const normalizedId = Number(user_id);
      if (!normalizedId) return res.status(400).json({ error: 'A valid user_id is required.' });
      if (action === 'ADD') {
        const validation = await validateAgent(normalizedId);
        if (validation.error) return res.status(400).json({ error: validation.error });
        const currentTicket = await getOne('SELECT primary_assignee_id FROM tickets WHERE id = ?', [ticketId]);
        if (normalizedId === currentTicket?.primary_assignee_id) {
          return res.status(400).json({ error: 'The primary assignee cannot also be listed as a collaborator.' });
        }
        await execute('INSERT OR IGNORE INTO ticket_collaborators (ticket_id, user_id) VALUES (?, ?)', [ticketId, normalizedId]);
        await recordHistory({
          ticketId,
          actorId: req.user.id,
          actorName: req.user.name,
          actionType: 'COLLABORATORS_UPDATED',
          details: `Collaborator ${normalizedId} added by ${req.user.name}.`,
        });
        return res.json({ message: 'Collaborator added.' });
      }
      if (action === 'REMOVE') {
        await execute('DELETE FROM ticket_collaborators WHERE ticket_id = ? AND user_id = ?', [ticketId, normalizedId]);
        await recordHistory({
          ticketId,
          actorId: req.user.id,
          actorName: req.user.name,
          actionType: 'COLLABORATORS_UPDATED',
          details: `Collaborator ${normalizedId} removed by ${req.user.name}.`,
        });
        return res.json({ message: 'Collaborator removed.' });
      }
      return res.status(400).json({ error: `Unknown collaborator action '${action}'. Use ADD or REMOVE.` });
    }

    return res.status(400).json({ error: 'Provide collaborator_ids array, or user_id with action ADD/REMOVE.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update collaborators.', details: err.message });
  }
});

// 8. POST /api/tickets/:id/archive & /restore
// Scenario 2: archive/restore is a ticket action available to supervisors and to
// agents on tickets they are primary assignee or collaborator of.
router.post('/:id/archive', authenticateToken, checkTicketPermission, async (req, res) => {
  try {
    await execute('UPDATE tickets SET is_archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);
    await recordHistory({
      ticketId: req.params.id,
      actorId: req.user.id,
      actorName: req.user.name,
      actionType: 'ARCHIVED',
      details: `Ticket archived by ${req.user.name}.`,
    });
    res.json({ message: 'Ticket archived.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to archive ticket.' });
  }
});

router.post('/:id/restore', authenticateToken, checkTicketPermission, async (req, res) => {
  try {
    await execute('UPDATE tickets SET is_archived = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);
    await recordHistory({
      ticketId: req.params.id,
      actorId: req.user.id,
      actorName: req.user.name,
      actionType: 'RESTORED',
      details: `Ticket restored by ${req.user.name}.`,
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
        const allowed = await userCanActOnTicket(user, ticket);
        if (!allowed) {
          results.push({
            ticketId: id,
            ticketNumber: ticket.ticket_number,
            success: false,
            reason: 'Forbidden. You can only close tickets where you are the primary assignee or a collaborator.',
          });
          continue;
        }
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
router.post('/:id/acknowledge-sla', authenticateToken, checkTicketPermission, async (req, res) => {
  try {
    const ticketId = req.params.id;
    const ticket = await getOne('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    const sla = calculateSLA(ticket);
    if (!sla.isBreached && !sla.isNearBreach) {
      return res.status(400).json({ error: 'This ticket has no active SLA alert to acknowledge.' });
    }

    await execute(
      `INSERT OR REPLACE INTO sla_acknowledgments (ticket_id, user_id, acknowledged_at, breach_count)
       VALUES (?, ?, CURRENT_TIMESTAMP, ?)`,
      [ticketId, req.user.id, ticket.reopen_count || 0]
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
