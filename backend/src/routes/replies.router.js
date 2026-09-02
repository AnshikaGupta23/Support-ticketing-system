import express from 'express';
import { query, getOne, execute } from '../db.js';
import { authenticateToken, checkTicketPermission } from '../middleware/auth.js';
import { recordHistory } from '../utils/history.js';

const router = express.Router({ mergeParams: true });

// POST /api/tickets/:id/replies - Post a Reply or Internal Note
router.post('/', authenticateToken, checkTicketPermission, async (req, res) => {
  try {
    const ticketId = req.params.id;
    const { body, is_internal_note = false, is_customer_reply = false } = req.body;
    const user = req.user;

    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'Reply message body cannot be empty.' });
    }

    const ticket = await getOne('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    // Determine Author details
    // A customer reply is never authored by a staff user: it is attributed to
    // the ticket requester (author_id NULL). The flag is also mutually exclusive
    // with internal notes — a message cannot be both staff-only and customer-facing.
    const isCustomerReply = is_customer_reply === true || is_customer_reply === 'true';
    const isInternal = is_internal_note === true || is_internal_note === 'true';
    if (isCustomerReply && isInternal) {
      return res.status(400).json({ error: 'A reply cannot be both an internal note and a customer reply.' });
    }

    const authorName = isCustomerReply ? ticket.requester_name : user.name;
    const authorEmail = isCustomerReply ? ticket.requester_email : user.email;
    const authorId = isCustomerReply ? null : user.id;

    // Insert Reply
    const result = await execute(
      `INSERT INTO replies (ticket_id, author_id, author_name, author_email, body, is_internal_note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ticketId, authorId, authorName, authorEmail, body.trim(), isInternal ? 1 : 0]
    );

    const replyId = result.lastID;

    // Record Immutable Audit History
    await recordHistory({
      ticketId,
      actorId: authorId,
      actorName: authorName,
      actionType: isInternal ? 'INTERNAL_NOTE_ADDED' : 'REPLY_ADDED',
      details: isInternal ? 'Internal note added.' : `Reply added by ${authorName}.`,
    });

    // Requirement 4: If customer replies while ticket is in PENDING, status
    // returns to OPEN and the SLA clock resumes. Internal notes never do this.
    if (isCustomerReply && !isInternal && ticket.status === 'PENDING') {
      let pendingDuration = ticket.pending_duration_seconds || 0;
      if (ticket.pending_started_at) {
        const pendingStart = new Date(ticket.pending_started_at).getTime();
        pendingDuration += Math.max(0, Math.floor((Date.now() - pendingStart) / 1000));
      }

      await execute(
        `UPDATE tickets
         SET status = 'OPEN', pending_started_at = NULL, pending_duration_seconds = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [pendingDuration, ticketId]
      );

      await recordHistory({
        ticketId,
        actorId: null,
        actorName: ticket.requester_name,
        actionType: 'STATUS_CHANGE',
        oldValue: 'PENDING',
        newValue: 'OPEN',
        details: 'Ticket status automatically returned to OPEN due to customer reply. SLA clock resumed.',
      });
    }

    const newReply = await getOne('SELECT * FROM replies WHERE id = ?', [replyId]);
    const updatedTicket = await getOne('SELECT * FROM tickets WHERE id = ?', [ticketId]);

    res.status(201).json({ reply: newReply, ticket: updatedTicket });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add reply.', details: err.message });
  }
});

export default router;
