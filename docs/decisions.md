# Architecture & Design Decisions Log

This document records key decisions made during the design and development of the Support Ticketing System, including trade-offs, rejected options, and one reversed decision.

---

## Decision 1: Server-Side vs. Client-Side SLA Clock Calculation
- **Choice**: Compute active SLA execution time and breach status on the server during API calls, with client-side live interval rendering.
- **Alternatives Evaluated**:
  - *Client-side only SLA calculation*: Loading raw timestamps and calculating SLA in browser React hooks.
- **Rationale**: SLA state directly affects alert filtering and server-side search queries. Computing on the server ensures consistent breach metrics across queue search, dashboard KPIs, and nav badge counters.

---

## Decision 2: Database Triggers for Immutable Ticket History
- **Choice**: Implement SQLite `BEFORE UPDATE` and `BEFORE DELETE` database triggers on `ticket_history` to enforce immutability at the storage level.
- **Alternatives Evaluated**:
  - *Application-level checks only*: Relying solely on Express router middleware to prevent updates.
- **Rationale**: Requirement 9 explicitly dictates: *"Nothing in this timeline can be edited or deleted after the fact, including by supervisors."* Database triggers ensure that even raw SQL queries or administrative scripts cannot tamper with history.

---

## Decision 3: Partial Success Reporting for Bulk Operations
- **Choice**: Return an array of per-ticket execution results `{ ticketId, success, reason }` with HTTP 200 rather than aborting the entire transaction on first error.
- **Alternatives Evaluated**:
  - *Atomic single-transaction rollback (All-or-Nothing)*.
- **Rationale**: Requirement 7 specifies: *"Because some tickets in the selection may not be eligible for the move, the result must report per ticket what succeeded and what was refused and why, not just fail the whole batch."*

---

