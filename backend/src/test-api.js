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

  console.log('🎉 All logic tests finished!');
}

runTests().catch(console.error);
