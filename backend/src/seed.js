import bcrypt from 'bcryptjs';
import { initDb, execute, getOne, query } from './db.js';

export const seedDatabase = async () => {
  console.log('🌱 Starting database seed process...');

  await initDb();

  // Clear existing data cleanly (disabling foreign keys temporarily for clean reset)
  await execute('PRAGMA foreign_keys = OFF');
  await execute('DELETE FROM sla_acknowledgments');
  // Drop triggers temporarily if wiping ticket_history
  await execute('DROP TRIGGER IF EXISTS prevent_history_update');
  await execute('DROP TRIGGER IF EXISTS prevent_history_delete');
  await execute('DELETE FROM ticket_history');
  await execute('DELETE FROM replies');
  await execute('DELETE FROM ticket_collaborators');
  await execute('DELETE FROM tickets');
  await execute('DELETE FROM users');
  await execute('PRAGMA foreign_keys = ON');

  // Re-create immutable triggers
  await execute(`
    CREATE TRIGGER IF NOT EXISTS prevent_history_update
    BEFORE UPDATE ON ticket_history
    BEGIN
      SELECT RAISE(FAIL, 'Ticket history timeline records are immutable and cannot be edited.');
    END;
  `);

  await execute(`
    CREATE TRIGGER IF NOT EXISTS prevent_history_delete
    BEFORE DELETE ON ticket_history
    BEGIN
      SELECT RAISE(FAIL, 'Ticket history timeline records are immutable and cannot be deleted.');
    END;
  `);

  // Hash distinct passwords for each user
  const sarahHash = await bcrypt.hash('SarahPass#2026', 10);
  const alexHash = await bcrypt.hash('AlexPass#2026', 10);
  const mayaHash = await bcrypt.hash('MayaPass#2026', 10);
  const davidHash = await bcrypt.hash('DavidPass#2026', 10);

  // Insert Users with distinct passwords
  const sarahRes = await execute(
    "INSERT INTO users (name, email, password_hash, role) VALUES ('Sarah Connor', 'sarah@company.com', ?, 'SUPERVISOR')",
    [sarahHash]
  );
  const alexRes = await execute(
    "INSERT INTO users (name, email, password_hash, role) VALUES ('Alex Mercer', 'alex@company.com', ?, 'AGENT')",
    [alexHash]
  );
  const mayaRes = await execute(
    "INSERT INTO users (name, email, password_hash, role) VALUES ('Maya Lin', 'maya@company.com', ?, 'AGENT')",
    [mayaHash]
  );
  const davidRes = await execute(
    "INSERT INTO users (name, email, password_hash, role) VALUES ('David Kim', 'david@company.com', ?, 'AGENT')",
    [davidHash]
  );

  const sarahId = sarahRes.lastID;
  const alexId = alexRes.lastID;
  const mayaId = mayaRes.lastID;
  const davidId = davidRes.lastID;

  console.log('✅ Users created: Supervisor (Sarah), Agents (Alex, Maya, David)');

  // Date helpers
  const now = new Date();
  const hoursAgo = (h) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();
  const daysAgo = (d) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

  // Insert Tickets
  const sampleTickets = [
    {
      number: 'TCK-1001',
      subject: 'Urgent Payment Gateway Failure on Checkout',
      description: 'Customers are receiving 500 error code when trying to process credit card payments via Stripe integration during checkout.',
      requester_name: 'Acme Corp (John Tech)',
      requester_email: 'john@acme.com',
      status: 'OPEN',
      priority: 'URGENT',
      category: 'BILLING',
      assignee_id: alexId,
      collabs: [mayaId],
      created_at: hoursAgo(5),
    },
    {
      number: 'TCK-1002',
      subject: 'API Rate Limiting documentation mismatch',
      description: 'The v2 API docs state 100 req/min, but our access token is capped at 60 req/min.',
      requester_name: 'DevStudio (Elena Rostova)',
      requester_email: 'elena@devstudio.io',
      status: 'PENDING',
      priority: 'HIGH',
      category: 'QUESTION',
      assignee_id: alexId,
      collabs: [davidId],
      created_at: hoursAgo(3),
      pending_started_at: hoursAgo(2),
    },
    {
      number: 'TCK-1003',
      subject: 'Export to PDF button throws unexpected stack trace',
      description: 'When generating monthly report PDF with over 500 records, the engine times out after 30 seconds.',
      requester_name: 'GlobalLogistics (Marcus Vance)',
      requester_email: 'marcus@globallogistics.com',
      status: 'OPEN',
      priority: 'MEDIUM',
      category: 'BUG',
      assignee_id: mayaId,
      collabs: [alexId, davidId],
      created_at: hoursAgo(20),
    },
    {
      number: 'TCK-1004',
      subject: 'Request for SSO / SAML 2.0 integration',
      description: 'We need Okta SSO integration enabled for our enterprise domain with 250 seats.',
      requester_name: 'Enterprise Inc (Alice Wong)',
      requester_email: 'alice@enterprise.com',
      status: 'NEW',
      priority: 'LOW',
      category: 'FEATURE',
      assignee_id: davidId,
      collabs: [],
      created_at: hoursAgo(10),
    },
    {
      number: 'TCK-1005',
      subject: 'Password reset email link not arriving',
      description: 'Requested password reset 3 times, checked spam folder, no email received.',
      requester_name: 'Robert Thorne',
      requester_email: 'rthorne@gmail.com',
      status: 'RESOLVED',
      priority: 'HIGH',
      category: 'OTHER',
      assignee_id: alexId,
      collabs: [],
      created_at: daysAgo(2),
      resolved_at: daysAgo(1),
    },
    {
      number: 'TCK-1006',
      subject: 'Webhook notification delivery failing periodically',
      description: 'Webhooks sent to our endpoint endpoint.acme.org return 504 gateway timeout during peak load.',
      requester_name: 'Acme Corp (John Tech)',
      requester_email: 'john@acme.com',
      status: 'CLOSED',
      priority: 'MEDIUM',
      category: 'BUG',
      assignee_id: mayaId,
      collabs: [sarahId],
      created_at: daysAgo(10),
      resolved_at: daysAgo(5),
      closed_at: daysAgo(3),
    },
  ];

  for (const t of sampleTickets) {
    const res = await execute(
      `INSERT INTO tickets (ticket_number, subject, description, requester_name, requester_email, status, priority, category, primary_assignee_id, pending_started_at, created_at, resolved_at, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        t.number,
        t.subject,
        t.description,
        t.requester_name,
        t.requester_email,
        t.status,
        t.priority,
        t.category,
        t.assignee_id,
        t.pending_started_at || null,
        t.created_at,
        t.resolved_at || null,
        t.closed_at || null,
      ]
    );

    const ticketId = res.lastID;

    if (t.collabs && t.collabs.length > 0) {
      for (const cid of t.collabs) {
        await execute('INSERT INTO ticket_collaborators (ticket_id, user_id) VALUES (?, ?)', [ticketId, cid]);
      }
    }

    await execute(
      `INSERT INTO ticket_history (ticket_id, actor_id, actor_name, action_type, old_value, new_value, details, created_at)
       VALUES (?, ?, 'System', 'TICKET_CREATED', NULL, ?, ?, ?)`,
      [ticketId, sarahId, t.status, `Ticket ${t.number} created.`, t.created_at]
    );

    if (t.number === 'TCK-1001') {
      await execute(
        `INSERT INTO replies (ticket_id, author_id, author_name, author_email, body, is_internal_note, created_at)
         VALUES (?, NULL, ?, ?, ?, 0, ?)`,
        [ticketId, t.requester_name, t.requester_email, t.description, t.created_at]
      );

      await execute(
        `INSERT INTO replies (ticket_id, author_id, author_name, author_email, body, is_internal_note, created_at)
         VALUES (?, ?, 'Alex Mercer', 'alex@company.com', 'Investigating Stripe API webhooks payload right now.', 1, ?)`,
        [ticketId, alexId, hoursAgo(4)]
      );

      await execute(
        `INSERT INTO ticket_history (ticket_id, actor_id, actor_name, action_type, details, created_at)
         VALUES (?, ?, 'Alex Mercer', 'INTERNAL_NOTE_ADDED', 'Added internal note regarding Stripe API payload.', ?)`,
        [ticketId, alexId, hoursAgo(4)]
      );
    }
  }

  console.log('✅ Seeded 6 tickets with full SLA states, history, collaborators, and replies.');
};

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
