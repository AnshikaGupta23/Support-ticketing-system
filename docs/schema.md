# Database Schema Documentation

## 1. Database Entity Overview

The relational schema is implemented in SQLite with strict foreign keys, check constraints, and immutability triggers.

### Entity Relationship Summary

- **Users** `(1)` <---> `(N)` **Tickets** (as Primary Assignee)
- **Users** `(M)` <---> `(N)` **Tickets** (via `ticket_collaborators` join table)
- **Tickets** `(1)` <---> `(N)` **Replies**
- **Tickets** `(1)` <---> `(N)` **Ticket History** (Immutable Audit Trail)
- **Tickets** `(1)` <---> `(N)` **SLA Acknowledgments**

---

## 2. Table Definitions

### `users`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique user identifier |
| `name` | TEXT | NOT NULL | User full name |
| `email` | TEXT | UNIQUE NOT NULL | Account email address |
| `password_hash` | TEXT | NOT NULL | Bcrypt hashed password |
| `role` | TEXT | CHECK(role IN ('SUPERVISOR', 'AGENT')) | RBAC role |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | Registration timestamp |

### `tickets`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique ticket identifier |
| `ticket_number` | TEXT | UNIQUE NOT NULL | Human readable code (e.g. TCK-1001) |
| `subject` | TEXT | NOT NULL | Ticket title |
| `description` | TEXT | NOT NULL | Initial issue description |
| `requester_name` | TEXT | NOT NULL | Customer name |
| `requester_email` | TEXT | NOT NULL | Customer email |
| `status` | TEXT | CHECK IN ('NEW','OPEN','PENDING','RESOLVED','CLOSED') | Lifecycle status |
| `priority` | TEXT | CHECK IN ('URGENT','HIGH','MEDIUM','LOW') | Priority level |
| `category` | TEXT | CHECK IN ('BUG','BILLING','QUESTION','FEATURE','OTHER') | Classification category |
| `primary_assignee_id` | INTEGER | REFERENCES users(id) | Primary assigned agent |
| `is_archived` | INTEGER | DEFAULT 0 | Soft archive flag |
| `pending_started_at` | DATETIME | NULLABLE | Timestamp when ticket entered PENDING |
| `pending_duration_seconds` | INTEGER | DEFAULT 0 | Cumulative seconds spent in PENDING |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | Ticket creation time |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | Last modification time |
| `resolved_at` | DATETIME | NULLABLE | Resolution timestamp |
| `closed_at` | DATETIME | NULLABLE | Closure timestamp |

### `ticket_collaborators`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `ticket_id` | INTEGER | REFERENCES tickets(id) ON DELETE CASCADE | Associated ticket |
| `user_id` | INTEGER | REFERENCES users(id) ON DELETE CASCADE | Collaborating agent |
| `added_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | Added timestamp |
| **PRIMARY KEY** | `(ticket_id, user_id)` | | Composite PK |

### `replies`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique reply ID |
| `ticket_id` | INTEGER | REFERENCES tickets(id) ON DELETE CASCADE | Target ticket |
| `author_id` | INTEGER | REFERENCES users(id) | Null for customer replies |
| `author_name` | TEXT | NOT NULL | Author display name |
| `author_email` | TEXT | NOT NULL | Author email |
| `body` | TEXT | NOT NULL | Reply message content |
| `is_internal_note` | INTEGER | DEFAULT 0 | Flag for internal staff note |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | Reply timestamp |

### `ticket_history` (Immutable)
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique audit log ID |
| `ticket_id` | INTEGER | REFERENCES tickets(id) ON DELETE CASCADE | Target ticket |
| `actor_id` | INTEGER | REFERENCES users(id) | User performing action |
| `actor_name` | TEXT | NOT NULL | Actor display name |
| `action_type` | TEXT | NOT NULL | Action category |
| `old_value` | TEXT | NULLABLE | Pre-action state string |
| `new_value` | TEXT | NULLABLE | Post-action state string |
| `details` | TEXT | NULLABLE | Human readable description |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | Audit log timestamp |

---

## 3. Immutability & Database Constraints

- **Database-Level Immutability**:
  ```sql
  CREATE TRIGGER prevent_history_update BEFORE UPDATE ON ticket_history
  BEGIN SELECT RAISE(FAIL, 'Ticket history timeline records are immutable and cannot be edited.'); END;

  CREATE TRIGGER prevent_history_delete BEFORE DELETE ON ticket_history
  BEGIN SELECT RAISE(FAIL, 'Ticket history timeline records are immutable and cannot be deleted.'); END;
  ```
- **Application vs Database Constraints**:
  - State machine transitions (`NEW` -> `OPEN` -> `PENDING` -> `RESOLVED` -> `CLOSED` and 7-day reopening window) are enforced in application logic to provide explicit human-readable error messages to clients.

---

## 4. Denormalization & 100x Scale Performance Analysis

- **Deliberate Denormalization**:
  - `pending_duration_seconds` is stored directly on `tickets` to allow O(1) SLA clock calculations during queue pagination without re-scanning all historical status changes.
- **Scaling to 100x Data**:
  1. Add composite index `CREATE INDEX idx_tickets_queue ON tickets(is_archived, status, priority, created_at)`.
  2. Partition `ticket_history` table or archive historical logs over 1 year to dedicated cold storage.
