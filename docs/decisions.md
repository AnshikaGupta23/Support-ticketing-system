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

## Decision 4: Single Column Accumulated Pending Duration (Denormalization)
- **Choice**: Maintain a `pending_duration_seconds` column and `pending_started_at` timestamp directly on the `tickets` table.
- **Alternatives Evaluated**:
  - *Calculating pending time dynamically from `ticket_history` timestamps*.
- **Rationale**: Scanning historical rows on every paginated queue query creates O(N * H) performance bottlenecks. Storing accumulated pending time allows O(1) SLA calculation per ticket.

---

## Decision 5: [REVERSED DECISION] Client-Side Queue Filtering vs Server-Side Queue Filtering
- **Initial Plan**: Load all open tickets into the browser memory on initial app load and perform client-side filtering/searching in JavaScript for fast client transitions.
- **Reversal Rationale**: Requirement 6 explicitly states: *"All of this must happen on the server — do not load every ticket into the browser and filter there."* Client-side filtering breaks down at scale (thousands of tickets) and leaks unassigned/unauthorized ticket metadata.
- **Final Architecture**: Refactored `GET /api/tickets` to perform SQL text searching (`LIKE`), column filtering, sorting, and OFFSET/LIMIT pagination entirely on the database server.

---

## Decision 6: SLA Acknowledgment Scope & Lifecycle Reset (Scenario 10)
- **Choice**: SLA acknowledgment is owned by the ticket's current primary assignee and is cleared whenever the alert context changes.
  - Only the assigned agent may acknowledge an alert (`POST /api/tickets/:id/acknowledge-sla` returns 403 to anyone else, including supervisors).
  - Reassignment/unassignment deletes acknowledgments held by any user other than the new assignee, so the new assignee must acknowledge the active alert themselves.
  - Reopening a ticket (RESOLVED/CLOSED -> OPEN) deletes all prior acknowledgments, so a reopened ticket that breaches its target response time again re-enters the alert list as required.
- **Alternatives Evaluated**:
  - *Global acknowledgement by any supervisor*: Would let a supervisor silently snooze an alert that the responsible agent still needs to act on.
  - *Keying acknowledgments to a monotonically increasing reopen counter only*: Works for reopen cycles but leaves stale acks from a previous assignee suppressing the alert after reassignment.
- **Rationale**: The requirement says *"An agent can acknowledge an alert for a ticket assigned to them"* — scoping the ack to the assignee and resetting it on reassignment/reopen keeps the alert list honest for whoever currently owns the ticket.

## Decision 7: Reply Immutability Extended to the Replies Table (Scenario 9)
- **Choice**: Apply the same storage-level `BEFORE UPDATE` / `BEFORE DELETE` SQLite triggers to the `replies` table that already protect `ticket_history`.
- **Alternatives Evaluated**:
  - *Protecting only `ticket_history`*: Replies are mirrored into history as events, but the reply bodies themselves would remain editable/deletable at the storage layer, which contradicts "every reply, internal or customer-visible ... cannot be edited or deleted after the fact."
- **Rationale**: Requirement 9 names replies explicitly. Extending the immutable-timeline guarantee to the replies table means no path — API, supervisor, or raw SQL — can rewrite or remove a posted reply or internal note.

