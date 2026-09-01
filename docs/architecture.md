# System Architecture Documentation

## 1. High-Level Architecture Overview

The **Support Ticketing System** is designed as a full-stack web application replacing fragmented group email workflows with a unified, state-managed ticket queue, real-time SLA tracking, and audit-compliant ticket history.

```
+-------------------------------------------------------+
|                React Single Page App                  |
|  (Vite + React 19 + Recharts + Lucide Icons + CSS)    |
+-------------------------------------------------------+
                           |
                     REST API (JSON)
                           |
                           v
+-------------------------------------------------------+
|                 Node.js + Express API                 |
|  (JWT Auth, RBAC Enforcement, SLA Engine, History)    |
+-------------------------------------------------------+
                           |
                      SQL Driver
                           |
                           v
+-------------------------------------------------------+
|               SQLite Database Storage                 |
| (Users, Tickets, Collaborators, Replies, History)    |
+-------------------------------------------------------+
```

---

## 2. Moving Components & Responsibilities

1. **Frontend (Client-Side)**:
   - Built with React 19 and React Router v7.
   - Responsible for rendering interactive views: **Dashboard (KPIs & Charts)**, **Ticket Queue**, **Ticket Details**, **SLA Alert Center**, and **In-App Docs Viewer**.
   - Performs state updates, debounced text searches, dynamic modal triggers, and CSV downloads.

2. **Backend (Server-Side)**:
   - Built with Node.js & Express.
   - Enforces strict server-side Role-Based Access Control (RBAC):
     - **SUPERVISOR**: Full control across all tickets, reassignments, archiving, bulk closing, and SLA monitoring.
     - **AGENT**: Restricted to acting only on tickets where they are primary assignee or collaborator; cannot reassign tickets away from themselves.
   - Enforces Ticket Lifecycle State Machine (`NEW` -> `OPEN` -> `PENDING` -> `RESOLVED` -> `CLOSED`).
   - Rejection of illegal state moves with informative HTTP 400 error payloads.
   - Enforcement of 7-day post-resolution reopening window.
   - Calculation of SLA active execution time and paused durations in `PENDING` state.

3. **Database Layer**:
   - Single-file SQLite persistent database (`backend/database.sqlite`).
   - SQLite Triggers (`prevent_history_update`, `prevent_history_delete`) providing database-level enforcement of immutable ticket history.

---

## 3. Representative End-to-End User Action Flow

**Scenario: Customer replies to a ticket currently in `PENDING` state.**

1. **User Action**: The customer sends a message or a user clicks "Simulate Customer Reply".
2. **API Request**: `POST /api/tickets/:id/replies` sent with body payload `{ body: "...", is_customer_reply: true }`.
3. **Authentication & Auth Check**: Express `authenticateToken` middleware verifies JWT token.
4. **State Machine & SLA Calculation**:
   - The server inspects ticket status. If status is `PENDING`, the server computes elapsed pending duration: `(now - pending_started_at)` and adds it to `pending_duration_seconds`.
   - The status is updated to `OPEN`, `pending_started_at` is cleared, resuming the active SLA timer against the assigned agent.
5. **Immutable History Recording**:
   - An entry is inserted into `ticket_history`: Action `STATUS_CHANGE`, Old: `PENDING`, New: `OPEN`, Details: `"Ticket status automatically returned to OPEN due to customer reply. SLA clock resumed."`
6. **Response & UI Update**:
   - Server responds with HTTP 201 containing the updated ticket, reply object, and fresh SLA metrics.
   - React state re-renders the conversation thread and updates the SLA timer pill in real time.

---

## 4. Architectural Trade-offs & Deliberate Omissions

- **SQLite vs PostgreSQL**: Chosen SQLite for zero-config simplicity, reproducible local assessment, and atomic single-file portability. Designed schema and queries to be ANSI-SQL compliant for fast migration to Postgres via Knex/Prisma.
- **WebSocket vs Polling/Timer**: Used client-side state updates and periodic polling for SLA timers rather than WebSocket overhead to keep server footprint minimal and deployment seamless on free tier hosts (Render / Vercel).
