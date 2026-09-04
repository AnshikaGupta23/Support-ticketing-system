# AI Prompts & Development Iterations Log

This document records the prompts, iterations, failure cases, and corrections that shaped the Support Ticketing System. Each entry maps a prompt or debugging session to the feature it produced, including the cases where the fix came from my own diagnosis rather than from the AI's answer.

## Iteration 1: System Architecture & Database Schema
- **Prompt Used**:
  > "Design a SQLite schema and Express REST API architecture for a support ticketing queue. Requirements: 2 roles (Supervisor, Agent), ticket lifecycle (NEW -> OPEN -> PENDING -> RESOLVED -> CLOSED), SLA calculation with paused PENDING state, immutable history timeline, and server-side RBAC."
- **What I did first**: Reviewed the requirement document and broke the system into three layers (React SPA, Express API, SQLite) before writing any code.
- **Result**: Clean table definitions (`users`, `tickets`, `ticket_collaborators`, `replies`, `ticket_history`) and the decision to add SQLite triggers later so timeline immutability is enforced at the storage level, not just in application code.

## Iteration 2: Login, Registration & Dashboard Scaffolding
- **Prompt Used** (paraphrase): "Set up login/registration with distinct credentials per role, then build the ticket queue and dashboard views on top of the API."
- **What I did first**: Wired the Express auth routes and JWT middleware, then connected the React menu, queue, and dashboard pages.
- **Result**: Login and registration flows with per-user passwords, plus queue and dashboard UI. Docs (`SUBMISSION.md` demo accounts) were added in this phase.
- **Lesson**: The generated structure was a starting point; real correctness came from the security passes that followed.

## Iteration 3: Authentication & Role Authorization Fixes
- **Problem**: After building auth, login misbehaved in some flows, and the server was not actually enforcing roles consistently — clients could trigger reassignments and other actions that should have been refused.
- **Root Cause (my diagnosis)**: Auth and RBAC checks existed but were incomplete on several endpoints, and registration accepted invalid input.
- **Fix**: Fixed the authentication issues, tightened role checks on every protected route (`authenticateToken` + `checkTicketPermission` + `userCanActOnTicket`), closed the registration vulnerability, and enforced agent-only reassignment (an agent can only reassign tickets away from themselves if they are the current assignee — everyone else gets HTTP 403).
- **Result**: Server-side RBAC became the source of truth; the frontend cannot escalate privileges.

## Iteration 4: Seed Script Failure — `hoursAgo` SQL Error
- **Problem**: Running `npm run seed` threw `SQLITE_ERROR: no such function: hoursAgo`.
- **Root Cause (my diagnosis)**: The seed file interpolated `hoursAgo(4)` as raw text inside the SQL template string, so SQLite tried to call a nonexistent SQL function instead of receiving a value.
- **Fix**: Replaced the interpolated text with `?` placeholders and passed `hoursAgo(4)` in the parameter array: `await execute("... VALUES (?, ?)", [ticketId, hoursAgo(4)])`.
- **Result**: Seed ran cleanly and populated sample users, tickets (with SLA states), collaborators, history, and replies.

## Iteration 5: Ticket Lifecycle Status-Transition Bug
- **Problem**: Marking a ticket Resolved produced `Illegal status move from 'OPEN' to 'undefined'`.
- **Root Cause (my diagnosis)**: The status-transition button sent `{ status: newStatus }`, but the backend route reads `req.body.new_status`. Because the key never matched, the server always saw `undefined`.
- **Fix**: A one-line key rename on the frontend call.
- **Follow-up**: Applied the same check to reassignment since it looked like the same class of bug — and it was (`primary_assignee_id` vs the backend's `new_assignee_id`).

## Iteration 6: SLA Engine, Immutable Timeline & Alerts
- **Prompt Used** (paraphrase): "Compute SLA correctly when a ticket waits in PENDING, keep a tamper-proof history timeline, and add breach alerts that an assignee can acknowledge."
- **What I did first**: Chose a denormalized design — `pending_duration_seconds` and `pending_started_at` stored on `tickets` — so queue pagination gets O(1) SLA math instead of re-scanning history.
- **Result**: Server-computed SLA (breach/near-breach), immutable `ticket_history` via `BEFORE UPDATE` / `BEFORE DELETE` SQLite triggers (later extended to `replies`), SLA alert center, and acknowledgment rules scoped to the assigned agent — cleared on reassignment and reopen so alerts stay honest.
- **Lesson**: Immutability belongs at the database layer; raw SQL and supervisor actions must not be able to rewrite the timeline either.

## Iteration 7: Final Gap-Filling & Submission
- **Prompt Used** (paraphrase): "Audit the implementation against the assessment requirements and fill whatever is missing before submission."
- **What I did first**: Walked each scenario against the running app and the docs, then closed the remaining gaps (structure, edge cases, and documentation).
- **Result**: Final submission with architecture, schema, decisions, plan, and this log in `docs/`, plus demo credentials in `SUBMISSION.md`.
