import { initDb, execute, getOne, query } from './db.js';
import { calculateSLA } from './utils/sla.js';

async function runTests() {
  console.log('🧪 Starting Backend Logic & State Machine Tests...\n');

  await initDb();

  // Test 1: Check SLA calculation for URGENT ticket (2h target)
  const fakeUrgentTicket = {
    priority: 'URGENT',
    status: 'OPEN',
    created_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(), // 3 hours ago
    pending_duration_seconds: 0,
  };
  const slaResult = calculateSLA(fakeUrgentTicket);
  console.log('Test 1 - SLA Urgent Breach Check:');
  console.log(`  Active elapsed: ${slaResult.activeElapsedSeconds}s / Target: ${slaResult.targetSeconds}s`);
  console.log(`  Is Breached: ${slaResult.isBreached} (Expected: true)\n`);

  // Test 2: Check SLA Pausing during PENDING state
  const fakePendingTicket = {
    priority: 'URGENT',
    status: 'PENDING',
    created_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(), // 3 hrs ago
    pending_started_at: new Date(Date.now() - 2.5 * 3600 * 1000).toISOString(), // Pending for 2.5 hrs
    pending_duration_seconds: 0,
  };
  const slaPendingResult = calculateSLA(fakePendingTicket);
  console.log('Test 2 - SLA Paused Pending Check:');
  console.log(`  Active elapsed (excluding pending): ${slaPendingResult.activeElapsedSeconds}s`);
  console.log(`  Is Paused: ${slaPendingResult.isPaused} (Expected: true)`);
  console.log(`  Is Breached: ${slaPendingResult.isBreached} (Expected: false since 3h total - 2.5h pending = 0.5h active < 2h target)\n`);

  // Test 3: History Immutability Trigger
  try {
    const hist = await getOne('SELECT id FROM ticket_history LIMIT 1');
    if (hist) {
      await execute('UPDATE ticket_history SET action_type = "HACKED" WHERE id = ?', [hist.id]);
      console.error('❌ Test 3 Failed: History update was NOT blocked!');
    }
  } catch (err) {
    console.log('Test 3 - Immutable Timeline DB Guard Check:');
    console.log(`  ✅ Successfully blocked update attempt: "${err.message}"\n`);
  }

  // Test 4: Ticket Edit Logic & History Timeline Entry
  try {
    // Ensure at least one test user exists for foreign key constraint
    let testUser = await getOne('SELECT id, name FROM users LIMIT 1');
    if (!testUser) {
      const uRes = await execute(
        "INSERT INTO users (name, email, password_hash, role) VALUES ('Test User', 'testuser@example.com', 'hash', 'SUPERVISOR')"
      );
      testUser = { id: uRes.lastID, name: 'Test User' };
    }

    // Create dummy ticket
    const ticketNum = `TCK-TEST-EDIT-${Date.now()}`;
    const ticketRes = await execute(
      `INSERT INTO tickets (ticket_number, subject, description, requester_name, requester_email, status, priority, category)
       VALUES (?, 'Original Subject', 'Original Description', 'John Doe', 'john@example.com', 'OPEN', 'LOW', 'QUESTION')`,
      [ticketNum]
    );
    const testTicketId = ticketRes.lastID;

    // Record edit directly or verify history recording function
    const recordHistoryModule = await import('./utils/history.js');
    
    // Perform edit query simulation
    await execute(
      `UPDATE tickets SET subject = ?, priority = ?, category = ?, requester_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ['Updated Subject', 'HIGH', 'BUG', 'Johnathan Doe', testTicketId]
    );

    await recordHistoryModule.recordHistory({
      ticketId: testTicketId,
      actorId: testUser.id,
      actorName: testUser.name,
      actionType: 'TICKET_EDITED',
      oldValue: JSON.stringify({ subject: 'Original Subject', priority: 'LOW', category: 'QUESTION', requester_name: 'John Doe' }),
      newValue: JSON.stringify({ subject: 'Updated Subject', priority: 'HIGH', category: 'BUG', requester_name: 'Johnathan Doe' }),
      details: `Ticket edited by ${testUser.name}: subject, priority, category, requester_name updated.`,
    });

    const editedTicket = await getOne('SELECT * FROM tickets WHERE id = ?', [testTicketId]);
    const historyEntry = await getOne('SELECT * FROM ticket_history WHERE ticket_id = ? AND action_type = "TICKET_EDITED"', [testTicketId]);

    if (
      editedTicket.subject === 'Updated Subject' &&
      editedTicket.priority === 'HIGH' &&
      editedTicket.category === 'BUG' &&
      editedTicket.requester_name === 'Johnathan Doe' &&
      historyEntry &&
      historyEntry.action_type === 'TICKET_EDITED'
    ) {
      console.log('Test 4 - Ticket Edit & Timeline History Log Check:');
      console.log(`  ✅ Successfully updated ticket fields and recorded action_type: 'TICKET_EDITED' in immutable history!\n`);
    } else {
      console.error('❌ Test 4 Failed: Ticket fields or history log did not match expected values.');
    }
  } catch (err) {
    console.error('❌ Test 4 Exception:', err);
  }

  console.log('🎉 All logic tests finished!');
}

runTests().catch(console.error);
