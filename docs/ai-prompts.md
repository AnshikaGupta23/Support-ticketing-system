# AI Prompts & Development Iterations Log

This document records the AI-assisted development process used while implementing the **Support Ticketing System**. It captures the major prompts, implementation decisions, debugging iterations, failure cases, corrections, and validation steps used during development.

The project is a full-stack support ticketing application built with **React 19, Vite, Node.js, Express, SQLite, JWT authentication, and REST APIs**. The system supports two roles — **SUPERVISOR** and **AGENT** — and implements ticket lifecycle management, SLA tracking, server-side RBAC, immutable audit history, collaboration, bulk actions, and dashboard reporting.

---

## Prompt 1: Initial System Architecture & Data Schema

**Objective:** Design the overall architecture, relational database schema, ticket lifecycle, SLA model, and authorization structure.
**Prompt Used:**
> "Design a full-stack support ticketing system using React, Node.js, Express and SQLite. The system should have two roles: SUPERVISOR and AGENT. Tickets should follow the lifecycle NEW -> OPEN -> PENDING -> RESOLVED -> CLOSED. Agents can act only on tickets assigned to them or where they are collaborators, while supervisors have full access. Implement SLA tracking with PENDING acting as a paused state, immutable ticket history, replies, collaborators, reassignment, and server-side RBAC."
**Output & Evaluation:**
  * Established a React frontend communicating with an Express REST API.
  * Chose SQLite for a simple, portable relational database.
  * Designed separate tables for users, tickets, collaborators, replies, ticket history, and SLA acknowledgments.
  * Identified that authorization and lifecycle rules must be enforced on the server rather than relying on frontend controls.
**Final Result:** The architecture was implemented with React → REST API → Express → SQLite, with authentication, RBAC, SLA calculation, and history management handled on the backend.

---

## Prompt 2: Designing the Ticket Lifecycle State Machine
**Objective:** Implement strict server-side validation for ticket status transitions.
**Prompt Used:**
> "Implement a server-side ticket status state machine for NEW, OPEN, PENDING, RESOLVED and CLOSED. Reject invalid transitions with HTTP 400 responses and human-readable error messages. CLOSED tickets should only be reopenable within 7 days."
**Implementation:**
  * Implemented a `validateStatusTransition()` helper in `tickets.router.js`.
  * Supported lifecycle transitions including:
    * `NEW -> OPEN`
    * `OPEN -> PENDING`
    * `PENDING -> OPEN`
    * `OPEN -> RESOLVED`
    * `RESOLVED -> OPEN`
    * `RESOLVED -> CLOSED`
    * `CLOSED -> OPEN`
  * Added a seven-day validation window for reopening CLOSED tickets.
  * Added protection against invalid status values.
**Evaluation:** Lifecycle validation is performed by the backend before updating the database, preventing the frontend from bypassing business rules.

---

## Prompt 3: Implementing Authentication and Role-Based Access Control
**Objective:** Secure the API and enforce different permissions for Supervisors and Agents.
**Prompt Used:**
> "Implement JWT authentication and server-side RBAC for a support ticketing system. Supervisors should have access to every ticket and management operation. Agents should only be allowed to act on tickets where they are the primary assignee or a collaborator. Never rely exclusively on frontend permission checks."
**Implementation:**
  * Added JWT-based authentication.
  * Added `authenticateToken` middleware.
  * Added `requireSupervisor` middleware.
  * Added `checkTicketPermission` middleware.
  * Added `userCanActOnTicket()` helper.
  * JWT payload contains user ID, name, email, and role.
  * Tokens expire after 24 hours.
**Evaluation:** Unauthorized requests receive appropriate `401` or `403` responses.

---

## Prompt 4: Fixing the Seed Script SQL Function Error
**Problem:** Running `npm run seed` resulted in:
`SQLITE_ERROR: no such function: hoursAgo`
**Root Cause:** A JavaScript helper function was accidentally placed inside the SQL template rather than being evaluated in JavaScript and passed as a parameter.
**Incorrect Approach:**
```text
VALUES (..., hoursAgo(4))
```
**Correction:** Changed the query to use a SQLite parameter placeholder and passed the calculated value through the parameter array.
```text
VALUES (?, ?)
```

with:

```text
[ticketId, hoursAgo(4)]
```
**Result:** The seed script executed successfully and generated usable users, tickets, replies, SLA data, and history records.

---

## Prompt 5: Fixing the Ticket Status Transition Payload Bug
**Problem:** Clicking a status-transition action produced:
`Illegal status move from 'OPEN' to 'undefined'`
**Investigation:** The frontend sent:
```text
{ status: newStatus }
```

while the backend expected:

```text
{ new_status: newStatus }
```
**Root Cause:** The request body property names did not match between the frontend and backend.
**Correction:** Updated the frontend API request to send the exact property expected by the backend:
```text
{ new_status: newStatus }
```
**Result:** Status transitions started reaching the backend correctly and the state-machine validation operated as intended.

---

## Prompt 6: Fixing the Ticket Reassignment Payload and RBAC Rules
**Problem:** Reassignment initially suffered from the same frontend/backend contract mismatch.
**Root Cause:** The frontend and backend used different names for the new assignee field.
**Backend Contract:**
```text
new_assignee_id
```
**Additional Requirements Implemented:**
  * Supervisors can reassign tickets to any valid Agent.
  * Agents cannot reassign tickets to another Agent.
  * Agents can only perform ticket actions if they are the primary assignee or collaborator.
  * Tickets cannot be assigned to users whose role is not `AGENT`.
  * Invalid assignee IDs are rejected.
  * Reassignment is recorded in immutable ticket history.
**Result:** Reassignment rules are now enforced server-side rather than only through UI restrictions.

---

## Prompt 7: Implementing SLA Calculation with Paused PENDING State

**Objective:** Calculate active SLA time while excluding the duration spent in PENDING.
**Prompt Used:**
> "Implement an SLA engine where each priority has a different response target. When a ticket enters PENDING, pause the SLA clock. When it leaves PENDING, accumulate the pending duration and resume the active SLA clock. Return remaining time, breach status, near-breach status, and current SLA state."
**SLA Targets:**
| Priority | SLA Target |
| -------- | ---------: |
| URGENT   |    2 hours |
| HIGH     |    4 hours |
| MEDIUM   |   24 hours |
| LOW      |   48 hours |
**Implementation:**
  * Added `pending_started_at`.
  * Added `pending_duration_seconds`.
  * SLA calculation subtracts accumulated pending time from total elapsed time.
  * Current PENDING duration is included dynamically.
  * Added `isBreached`.
  * Added `isNearBreach`.
  * Added `secondsRemaining`.
  * Added SLA states such as `OK`, `NEAR_BREACH`, `BREACHED`, `PAUSED`, and `BREACHED_PAUSED`.
**Result:** SLA calculations are consistent across queue, ticket details, and dashboard metrics.

---

## Prompt 8: Handling Customer Replies While a Ticket Is PENDING
**Objective:** Automatically resume SLA processing when a customer replies to a pending ticket.
**Prompt Used:**
> "When a customer replies to a ticket in PENDING status, automatically move the ticket back to OPEN, calculate and preserve the time spent in PENDING, resume the SLA clock, and add an immutable history entry. Internal notes must not trigger this behavior."
**Implementation:**
  * Customer replies are identified using `is_customer_reply`.
  * Customer replies are attributed to the ticket requester.
  * Internal notes remain staff-only.
  * A message cannot simultaneously be an internal note and customer reply.
  * A customer reply to a PENDING ticket:
    * accumulates pending duration,
    * clears `pending_started_at`,
    * changes status to `OPEN`,
    * resumes SLA timing,
    * records the automatic status change in history.
**Result:** Customer activity correctly resumes the SLA clock.

---

## Prompt 9: Server-Side Queue Search, Filtering, Sorting and Pagination
**Objective:** Prevent the frontend from loading the entire ticket dataset and filtering it locally.
**Prompt Used:**
> "Implement a scalable server-side ticket queue. Support text search, status filtering, priority filtering, category filtering, assignee filtering, mine-only filtering, archived filtering, sorting and pagination. The database should perform filtering and pagination."
**Implementation:**
  * Added `GET /api/tickets`.
  * Implemented search over:
    * subject,
    * description,
    * ticket number,
    * requester name.
  * Added filters for:
    * status,
    * priority,
    * category,
    * assignee,
    * archived state.
  * Added `mine_only` support.
  * Added server-side sorting.
  * Added `LIMIT/OFFSET` pagination.
  * Added total-match and total-page information.
**Security Benefit:** Agents cannot simply download the complete queue and inspect tickets they are not authorized to act on.
**Performance Benefit:** Only the required page of tickets is returned to the client.

---

## Prompt 10: Implementing Immutable Ticket History
**Objective:** Ensure that audit history cannot be edited or deleted, including by supervisors.
**Prompt Used:**
> "Make the ticket history timeline immutable. Every important ticket action should create an audit record. Prevent UPDATE and DELETE operations on ticket_history at the database level, not only through Express middleware."
**Implementation:**
  * Added `ticket_history` table.
  * Recorded events such as:
    * ticket creation,
    * status changes,
    * ticket edits,
    * reassignment,
    * collaborator updates,
    * replies,
    * internal notes,
    * archive/restore actions.
  * Added SQLite `BEFORE UPDATE` trigger.
  * Added SQLite `BEFORE DELETE` trigger.
**Result:** History records cannot be modified or removed after creation.

---

## Prompt 11: Collaborator Management

**Objective:** Allow multiple Agents to collaborate on a ticket without changing the primary assignee.
**Prompt Used:**
> "Add ticket collaborators using a many-to-many relationship between users and tickets. Only Agents may be collaborators. Prevent the primary assignee from being duplicated as a collaborator. Support adding, removing, and replacing collaborators."
**Implementation:**
  * Added `ticket_collaborators` join table.
  * Added collaborator validation.
  * Only users with role `AGENT` can be collaborators.
  * Prevented duplicate collaborators.
  * Prevented the primary assignee from also appearing as a collaborator.
  * Added support for:
    * replacing the complete collaborator list,
    * adding a collaborator,
    * removing a collaborator.
  * Collaborator changes are recorded in ticket history.

---

## Prompt 12: Bulk Ticket Actions with Partial Success Reporting
**Objective:** Implement bulk operations without failing the entire operation when individual tickets are not eligible.
**Prompt Used:**
> "Implement bulk ticket actions where each selected ticket is validated independently. The API must return a per-ticket result showing whether the action succeeded or failed and why. Do not abort the entire batch because one ticket is invalid."
**Implementation:**
  * Added bulk-action endpoint.
  * Each ticket is processed independently.
  * Authorization is checked per ticket.
  * Lifecycle rules are checked per ticket.
  * Each result reports success/failure and an explanation.
**Design Decision:** Partial success was preferred over an all-or-nothing transaction because support teams need to know exactly which tickets were processed and which were rejected.

---

## Prompt 13: Ticket Archive and Restore
**Objective:** Add soft archiving instead of permanently deleting tickets.
**Prompt Used:**
> "Implement archive and restore functionality for tickets. Do not delete ticket records. Preserve ticket history and allow archived tickets to be hidden from the default queue."
**Implementation:**
  * Added `is_archived` flag to tickets.
  * Added archive endpoint.
  * Added restore endpoint.
  * Archived tickets are excluded from the normal queue.
  * Archive and restore actions are recorded in history.
  * Permission checks are performed server-side.
**Result:** Ticket records remain available without appearing in the active queue.

---

## Prompt 14: CSV Queue Export
**Objective:** Provide an exportable representation of the ticket queue.
**Prompt Used:**
> "Add a backend endpoint that exports the currently filtered ticket queue as CSV. Include ticket number, subject, status, priority, category, requester, requester email, assignee, created date and updated date."
**Implementation:**
  * Added `GET /api/tickets/export-csv`.
  * Applied search and filtering before generating the CSV.
  * Added CSV escaping for values containing quotation marks.
  * Returned the file using an attachment response.
**Result:** Users can export ticket queue information without performing the filtering entirely in the browser.

---

## Prompt 15: Dashboard Metrics and Reporting
**Objective:** Build dashboard metrics for supervisors and support teams.
**Prompt Used:**
> "Create a dashboard API for a support ticketing system showing open tickets, pending tickets, tickets resolved this week, SLA-breaching tickets, status breakdown, per-agent workload and weekly resolution trends."
**Implementation:**
  * Added dashboard statistics endpoint.
  * Added headline metrics:
    * open tickets,
    * pending tickets,
    * resolved this week,
    * breaching response time.
  * Added status breakdown.
  * Added agent workload breakdown.
  * Added eight-week resolution trend data.
**Result:** The frontend dashboard can display operational KPIs without calculating them independently.

---

## Prompt 16: SLA Acknowledgment and Reassignment/Reopening Edge Cases
**Objective:** Ensure SLA alerts remain correct when tickets are reassigned or reopened.
**Prompt Used:**
> "When an SLA alert is acknowledged, scope the acknowledgment to the current assigned agent and lifecycle. If a ticket is reassigned or reopened, ensure that stale acknowledgments cannot suppress alerts for the new assignee or new lifecycle."
**Implementation:**
  * SLA acknowledgments are associated with the relevant ticket and user.
  * Reassignment removes acknowledgments belonging to other users.
  * Reopening a resolved/closed ticket clears previous acknowledgments.
  * Reopening from CLOSED increments the reopen counter.
  * The new/current assignee must acknowledge a new active SLA alert where appropriate.
**Result:** SLA alerts cannot remain incorrectly acknowledged after ownership or lifecycle changes.

---

## Prompt 17: Same-Status Transition Edge Case
**Problem:** Repeatedly submitting the current status could unnecessarily rewrite timestamps or create duplicate history entries.
**Prompt Used:**
> "Make status transitions idempotent when the requested status is already the ticket's current status. Do not update timestamps or create unnecessary history records."
**Correction:**
  * Added an early return when `new_status === ticket.status`.
  * Returned the current ticket and SLA information.
  * No database mutation occurs.
  * No duplicate history record is generated.
**Result:** Repeated status requests are safe and predictable.

---

## Prompt 18: Reopening Resolved and Closed Tickets
**Objective:** Correctly reset lifecycle timestamps when tickets are reopened.
**Prompt Used:**
> "When a RESOLVED or CLOSED ticket is reopened to OPEN, clear stale resolved/closed timestamps. CLOSED tickets should obey the seven-day reopening window and increment the reopen count. Reset lifecycle-specific SLA acknowledgments."
**Implementation:**
  * Reopening `RESOLVED -> OPEN` clears `resolved_at`.
  * Reopening `CLOSED -> OPEN` clears `closed_at`.
  * CLOSED reopening is allowed only within seven days.
  * Reopen count is incremented.
  * Existing SLA acknowledgments are cleared.
**Result:** Reopened tickets behave as active tickets rather than retaining stale lifecycle metadata.

---

## Prompt 19: Frontend/Backend API Contract Validation
**Objective:** Verify that frontend request payloads match backend route contracts.
**Prompt Used:**
> "Review the frontend API calls against every Express route. Identify mismatched HTTP methods, endpoint paths, request body property names, response property names, and authorization requirements. Fix contract mismatches rather than adding unnecessary backend workarounds."
**Key Findings:**
  * Status transition required `new_status`.
  * Reassignment required `new_assignee_id`.
  * Collaborator operations required the expected collaborator payload structure.
  * Authentication requests require the JWT token in the `Authorization` header.
**Result:** Frontend requests were aligned with the backend API contract.

---

## Prompt 20: Final Requirement and Edge-Case Review
**Objective:** Perform a final end-to-end review against the mandatory support-ticketing requirements.
**Prompt Used:**
> "Review the complete support ticketing system against all mandatory requirements. Check authentication, Supervisor/Agent RBAC, ticket lifecycle, SLA pause/resume behavior, customer replies, server-side queue filtering, bulk operations, reassignment, collaborators, immutable history, reopening rules, dashboard metrics, archive/restore, CSV export, and edge cases. Identify anything that is implemented only on the frontend and should instead be enforced on the server."

---

# Summary of AI-Assisted Development
AI assistance was primarily used for:
1. Planning.
2. Helping hand in route design.
3. Debugging frontend/backend API contract mismatches.
4. Implementing and validating state-machine rules.
5. Overview for designing SLA calculations.
6. Reviewing database constraints.
7. Debugging seed data.
8. Designing bulk-action behavior.
9. Performing final requirement and edge-case reviews.

AI-generated suggestions were treated as development assistance rather than automatically accepted code. Implementations were reviewed against the project's actual requirements, tested through the application/API, and corrected where behavior did not match the required business rules.

The final architecture intentionally keeps security-sensitive business logic on the server, while the React frontend is responsible primarily for presentation, interaction, state management, and API integration.