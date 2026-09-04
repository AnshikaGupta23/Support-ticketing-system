# Submission

## Links

- **GitHub repository:** <public repo URL>
- **Live application:** <deployed URL>

## Notes for the reviewer

No live host yet — run it locally. Backend: `cd backend && npm install && npm run seed && npm run start` (API on http://localhost:5000). Frontend: `cd frontend && npm install && npm run dev` (UI on http://localhost:5173). The backend auto-seeds an empty database on first startup, and `npm run seed` resets it to the full demo set (4 users, 6 tickets). All setup steps are also in the repo README.

## Demo credentials

| Role | Email | Password |
|------|-------|----------|
| Supervisor (Sarah Connor) | sarah@company.com | SarahPass#2026 |
| Agent (Alex Mercer) | alex@company.com | AlexPass#2026 |
| Agent (Maya Lin) | maya@company.com | MayaPass#2026 |
| Agent (David Kim) | david@company.com | DavidPass#2026 |

## Stack

| Layer | What you used | Why |
|-------|---------------|-----|
| Frontend | React 19 + Vite, React Router, Recharts, axios | Component SPA with charts for the dashboard; role-aware UI that hides nothing it can't back with server checks. |
| Backend | Node.js + Express, JWT (jsonwebtoken), bcryptjs | Lightweight REST API; middleware makes per-route RBAC and state-machine enforcement straightforward. |
| Database | SQLite via `sqlite3` | Zero-config, single-file, portable; `BEFORE UPDATE/DELETE` triggers give storage-level immutability guarantees. |
| Hosting | None — runs locally | Deployment was out of scope for this exercise; no infra-specific coupling, so it can be hosted later as-is. |

## Goal checklist

Mark each honestly. Partial is fine — say what is partial.

| # | Goal | Status | Notes |
|---|------|--------|-------|
| 1 | Accounts with Supervisor and Agent roles, RBAC enforced server-side | Done | JWT on every route; agents scoped to tickets they own or collaborate on; agents cannot create-for-other agents or reassign away from self (HTTP 403). |
| 2 | Ticket create / edit / detail with reassignment and collaborators | Done | Agents may only assign to self or leave unassigned; collaborators must be Agents; primary assignee can't also be a collaborator. |
| 3 | Archive and restore without permanent deletion | Done | Soft `is_archived` flag; archived tickets hidden from the default queue and dashboard, still filterable. |
| 4 | Ticket lifecycle state machine with reopening rules | Done | `NEW → OPEN → PENDING → RESOLVED → CLOSED`; illegal moves return 400 with allowed transitions; CLOSED reopen limited to 7 days; same-state moves are idempotent no-ops. |
| 5 | Replies, staff-only internal notes, customer replies | Done | Customer reply to a PENDING ticket auto-returns it to OPEN and resumes the SLA clock; internal notes never trigger that. |
| 6 | Server-side queue search, filter, sort, pagination + CSV export | Done | All in SQL — the browser is never handed the full dataset; agents are always server-scoped; CSV export mirrors the active filters. |
| 7 | Bulk actions with per-ticket reporting | Done | Bulk reassign (Supervisor) and bulk close; each ticket validated independently, response reports success/refusal per ticket with reasons. |
| 8 | SLA engine with paused pending time and alert list | Done | Clock counts active time only (URGENT 2h, HIGH 4h, MEDIUM 24h, LOW 48h); alert center is role-scoped with live nav badge; SLA math is server-side everywhere. |
| 9 | Immutable history timeline | Done | Every action appends a `ticket_history` row; SQLite triggers block edits/deletes at the storage level, replies included — even Supervisors or raw SQL can't tamper. |
| 10 | SLA acknowledgment correctness across reassignment/reopen | Done | Only the current assignee can acknowledge; acks are scoped to assignee + breach generation and cleared on reassignment/reopen so stale acks can't suppress new alerts. |

## How much time did you actually spend?

About 10.5 hours across 5 sessions: requirement analysis & architecture (1.5h), schema/triggers/auth (2h), REST API — state machine, SLA engine, bulk actions (2.5h), React frontend — queue, detail view, dashboard, alerts (3h), and docs, edge-case testing & seed data (1.5h).

## What would you do next, with another 12 hours?

- Add a real automated test framework (Vitest/Jest) and CI so the state machine, SLA math, and RBAC rules are regression-tested on every change (currently a standalone `test-api.js` script).
- Deploy it: host the API and UI, move the DB to managed Postgres or keep SQLite with volume persistence.
- Add the deferred stretch features: canned responses, customer satisfaction surveys, and an incident status page.
- Realtime updates via WebSockets instead of 15s/30s polling for SLA timers and the alert badge.
- Integrate an AI chatbot into the app — draft reply suggestions for agents from the ticket thread, and let customers get instant answers to common questions before they raise a ticket.

## What are you least happy with in this codebase, and why?

- **Testing is still manual.** The tests live in one standalone script (`backend/src/test-api.js`) instead of a proper test runner wired into CI, so the trickiest logic (SLA pause/resume, ack reset, immutability triggers) only gets checked when someone remembers to run it.
- **`POST /api/seed` has no login check.** It's handy for demos, but anyone who can reach the server can wipe and re-fill the database — fine on a local machine, risky once it's deployed.
- **The frontend has the API URL hardcoded** (`http://localhost:5000/api`) with no way to change it via settings, so pointing the UI at a different backend means editing the code.
- **Some database indexes are missing.** The schema relies on primary/unique keys only, so the paginated queue query will slow down as tickets grow — the docs describe the needed composite index but it isn't created yet.
