export const SLA_TARGETS_HOURS = {
  URGENT: 2,
  HIGH: 4,
  MEDIUM: 24,
  LOW: 48,
};

export const calculateSLA = (ticket) => {
  const targetHours = SLA_TARGETS_HOURS[ticket.priority] || 24;
  const targetSeconds = targetHours * 3600;

  const createdAt = new Date(ticket.created_at).getTime();
  const now = Date.now();

  let accumulatedPendingSeconds = ticket.pending_duration_seconds || 0;

  // If currently pending, add current pending slice to paused time
  if (ticket.status === 'PENDING' && ticket.pending_started_at) {
    const currentPendingStart = new Date(ticket.pending_started_at).getTime();
    accumulatedPendingSeconds += Math.floor((now - currentPendingStart) / 1000);
  }

  // Calculate active elapsed time (excluding pending time)
  const totalElapsedSeconds = Math.max(0, Math.floor((now - createdAt) / 1000));
  const activeElapsedSeconds = Math.max(0, totalElapsedSeconds - accumulatedPendingSeconds);

  const secondsRemaining = targetSeconds - activeElapsedSeconds;
  const isBreached = activeElapsedSeconds >= targetSeconds;
  const isNearBreach = !isBreached && activeElapsedSeconds >= targetSeconds * 0.8;

  let slaState = 'OK';
  if (ticket.status === 'PENDING') {
    slaState = isBreached ? 'BREACHED_PAUSED' : 'PAUSED';
  } else if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
    slaState = isBreached ? 'BREACHED_RESOLVED' : 'COMPLETED';
  } else if (isBreached) {
    slaState = 'BREACHED';
  } else if (isNearBreach) {
    slaState = 'NEAR_BREACH';
  }

  return {
    targetHours,
    targetSeconds,
    activeElapsedSeconds,
    accumulatedPendingSeconds,
    secondsRemaining,
    isBreached,
    isNearBreach,
    isPaused: ticket.status === 'PENDING',
    slaState,
  };
};
