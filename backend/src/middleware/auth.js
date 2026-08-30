import jwt from 'jsonwebtoken';
import { getOne } from '../db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-support-ticket-key-2026';

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    req.user = user;
    next();
  });
};

export const requireSupervisor = (req, res, next) => {
  if (!req.user || req.user.role !== 'SUPERVISOR') {
    return res.status(403).json({
      error: 'Permission denied. Only Supervisors can perform this action.',
    });
  }
  next();
};

export const checkTicketPermission = async (req, res, next) => {
  try {
    const ticketId = req.params.id || req.body.ticketId;
    if (!ticketId) return next();

    const user = req.user;
    if (user.role === 'SUPERVISOR') {
      return next(); // Supervisors have full access to all tickets
    }

    const ticket = await getOne('SELECT primary_assignee_id FROM tickets WHERE id = ?', [ticketId]);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    // Check if user is primary assignee
    if (ticket.primary_assignee_id === user.id) {
      return next();
    }

    // Check if user is a collaborator
    const collab = await getOne(
      'SELECT 1 FROM ticket_collaborators WHERE ticket_id = ? AND user_id = ?',
      [ticketId, user.id]
    );

    if (collab) {
      return next();
    }

    return res.status(403).json({
      error: 'Forbidden. You can only act on tickets where you are the primary assignee or a collaborator.',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error checking ticket permissions.', details: err.message });
  }
};
