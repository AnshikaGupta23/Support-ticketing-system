# AI Prompts & Development Iterations Log

This document records the prompt engineering, iterations, failure cases, and corrections during the implementation of the Support Ticketing System.

---

## Prompt 1: Initial System Architecture & Data Schema
- **Objective**: Design the relational database schema, SLA engine, and Express server structure.
- **Prompt Used**:
  > "Design a SQLite schema and Express REST API architecture for a support ticketing queue. Requirements: 2 roles (Supervisor, Agent), ticket lifecycle (NEW -> OPEN -> PENDING -> RESOLVED -> CLOSED), SLA calculation with paused PENDING state, immutable history timeline, and server-side RBAC."
- **Output & Evaluation**: Generated clean table definitions. Identified the need to add SQLite database triggers to enforce timeline immutability at the storage level.

---

## Prompt 2: Handling Seed Query Template Syntax Issue (Encountered Failure & Fix)
- **Problem**: When running `npm run seed`, SQLite threw error: `SQLITE_ERROR: no such function: hoursAgo`.
- **Root Cause Analysis**: Parameter string interpolation in `seed.js` placed `hoursAgo(4)` inside the SQL template string instead of binding as a JavaScript array parameter.
- **Correction**: Replaced raw string text with `?` parameter placeholder and passed `hoursAgo(4)` in the argument array: `await execute("... VALUES (?, ?)", [ticketId, hoursAgo(4)])`.
- **Resolution**: Seed script ran cleanly, initializing sample users, tickets, SLA breaches, and replies.

---

##Prompt3:Fixing the ticket lifecycle status-transition bug
Sent a screenshot of an error: "Illegal status move from 'OPEN' to 'undefined'" when trying to mark a ticket Resolved, and asked why.
-**Problem**:my status-transition button sent { status: newStatus }, but the backend route read req.body.new_status. 
-**Root cause**:Since the key never matched, the server always saw undefined. Fix was a one-line key rename on the frontend call.
-**correction**:Applied the fix, then asked for the same check on reassignment, since it looked like the same class of bug — which it was (primary_assignee_id vs the backend's new_assignee_id).

---
