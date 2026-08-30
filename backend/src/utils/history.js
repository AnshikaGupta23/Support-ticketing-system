import { execute } from '../db.js';

export const recordHistory = async ({
  ticketId,
  actorId = null,
  actorName = 'System',
  actionType,
  oldValue = null,
  newValue = null,
  details = null,
}) => {
  try {
    await execute(
      `INSERT INTO ticket_history (ticket_id, actor_id, actor_name, action_type, old_value, new_value, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        ticketId,
        actorId,
        actorName,
        actionType,
        oldValue ? String(oldValue) : null,
        newValue ? String(newValue) : null,
        details ? String(details) : null,
      ]
    );
  } catch (err) {
    console.error('Failed to record ticket history timeline entry:', err);
    throw err;
  }
};
