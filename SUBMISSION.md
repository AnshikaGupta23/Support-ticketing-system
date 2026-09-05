# Submission

## Links

- **GitHub repository:** https://github.com/AnshikaGupta23/Support-ticketing-system
- **Live application (Vercel):** https://support-ticketing-system-alpha.vercel.app/login
- **Live API (Render):** https://support-ticketing-system-jcp5.onrender.com

## Notes for the reviewer

Live on free tiers. **Database:** Supabase Postgres — the backend uses it whenever `DATABASE_URL` is set (the db layer auto-translates SQLite queries/triggers to Postgres). **Server-side:** Render — Express API; on boot it creates the schema and seeds the demo data only if the DB is empty, so a shared database is never wiped. **Browser-side:** Vercel — React/Vite SPA with rewrites to `index.html`, built with `VITE_API_URL` pointing at the Render API origin. `POST /api/seed` can re-seed the demo data on demand. Local dev still works unchanged (SQLite + `npm run dev`).

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
| Database | Postgres on Supabase (free tier); SQLite via `sqlite3` for local dev | Single managed Postgres for the live site; the backend's hybrid adapter (same routers both modes) runs Postgres when `DATABASE_URL` is set, with triggers recreated natively for storage-level immutability. |
| Hosting | Supabase (managed Postgres) + Render (Node/Express API) + Vercel (React/Vite UI) — all free tiers | API and UI are separated so each host does one job; auto-seeds only on an empty DB so Render reboots never wipe shared data; Vercel SPA rewrites + `VITE_API_URL` wire the browser to the API. |

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
| 11 | Live deployment reachable by URL, free tiers only | Done | Supabase Postgres (managed DB) + Render (API) + Vercel (UI); live URLs at the top. |

## How much time did you actually spend?

About 10.5 hours across 5 sessions: requirement analysis & architecture (1.5h), schema/triggers/auth (2h), REST API — state machine, SLA engine, bulk actions (2.5h), React frontend — queue, detail view, dashboard, alerts (3h), and docs, edge-case testing & seed data (1.5h).

## What would you do next, with another 12 hours?

- Add a real automated test framework (Vitest/Jest) and CI so the state machine, SLA math, and RBAC rules are regression-tested on every change (currently a standalone `test-api.js` script).
- Add the deferred stretch features: canned responses, customer satisfaction surveys, and an incident status page.
- Realtime updates via WebSockets instead of 15s/30s polling for SLA timers and the alert badge.
- Integrate an AI chatbot into the app — draft reply suggestions for agents from the ticket thread, and let customers get instant answers to common questions before they raise a ticket.

## What are you least happy with in this codebase, and why?

- **Testing is still manual.** The tests live in one standalone script (`backend/src/test-api.js`) instead of a proper test runner wired into CI, so the trickiest logic (SLA pause/resume, ack reset, immutability triggers) only gets checked when someone remembers to run it.
- **`POST /api/seed` has no login check.** It's handy for demos, but anyone who can reach the server can wipe and re-fill the database — acceptable on local, a real risk on the live URL. Should be gated behind a supervisor token or disabled in production.
- **The live API URL comes from a build-time `VITE_API_URL`**, so pointing the UI at a different backend means rebuilding the frontend (rather than a runtime setting).
- **Some database indexes are missing.** The schema relies on primary/unique keys only, so the paginated queue query will slow down as tickets grow — the docs describe the needed composite index but it isn't created yet.
