import express from 'express';
import { query, getOne } from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { calculateSLA } from '../utils/sla.js';

const router = express.Router();

// GET /api/dashboard/stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const allTickets = await query(`
      SELECT t.*, u.name as primary_assignee_name
      FROM tickets t
      LEFT JOIN users u ON t.primary_assignee_id = u.id
      WHERE t.is_archived = 0
    `);

    // Headline numbers
    const openTicketsCount = allTickets.filter((t) => ['NEW', 'OPEN'].includes(t.status)).length;
    const pendingTicketsCount = allTickets.filter((t) => t.status === 'PENDING').length;

    // Resolved this week (within last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const resolvedThisWeekCount = allTickets.filter((t) => {
      if (t.status !== 'RESOLVED' && t.status !== 'CLOSED') return false;
      const resDate = new Date(t.resolved_at || t.updated_at);
      return resDate >= sevenDaysAgo;
    }).length;

    // Breaching response time count
    const breachingCount = allTickets.filter((t) => {
      if (t.status === 'CLOSED' || t.status === 'RESOLVED') return false;
      const sla = calculateSLA(t);
      return sla.isBreached;
    }).length;

    // Breakdown by Status
    const statusBreakdown = [
      { status: 'NEW', count: allTickets.filter((t) => t.status === 'NEW').length },
      { status: 'OPEN', count: allTickets.filter((t) => t.status === 'OPEN').length },
      { status: 'PENDING', count: allTickets.filter((t) => t.status === 'PENDING').length },
      { status: 'RESOLVED', count: allTickets.filter((t) => t.status === 'RESOLVED').length },
      { status: 'CLOSED', count: allTickets.filter((t) => t.status === 'CLOSED').length },
    ];

    // Breakdown by Agent
    const agentMap = {};
    allTickets.forEach((t) => {
      const name = t.primary_assignee_name || 'Unassigned';
      if (!agentMap[name]) {
        agentMap[name] = { name, open: 0, resolved: 0, pending: 0, total: 0 };
      }
      agentMap[name].total += 1;
      if (['NEW', 'OPEN'].includes(t.status)) agentMap[name].open += 1;
      if (t.status === 'PENDING') agentMap[name].pending += 1;
      if (['RESOLVED', 'CLOSED'].includes(t.status)) agentMap[name].resolved += 1;
    });
    const agentBreakdown = Object.values(agentMap);

    // Chart: Tickets resolved per week over the last 8 weeks
    const weeklyResolution = [];
    const now = new Date();

    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - i * 7 - now.getDay());
      weekStart.setHours(0, 0, 0, 0);

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      const resolvedCount = allTickets.filter((t) => {
        if (!['RESOLVED', 'CLOSED'].includes(t.status)) return false;
        const resDate = new Date(t.resolved_at || t.closed_at || t.updated_at);
        return resDate >= weekStart && resDate <= weekEnd;
      }).length;

      const label = `Wk ${8 - i} (${weekStart.getMonth() + 1}/${weekStart.getDate()})`;
      weeklyResolution.push({ week: label, resolved: resolvedCount });
    }

    res.json({
      headlines: {
        openTickets: openTicketsCount,
        pendingTickets: pendingTicketsCount,
        resolvedThisWeek: resolvedThisWeekCount,
        breachingResponseTime: breachingCount,
      },
      statusBreakdown,
      agentBreakdown,
      weeklyResolution,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch dashboard metrics.', details: err.message });
  }
});

export default router;
