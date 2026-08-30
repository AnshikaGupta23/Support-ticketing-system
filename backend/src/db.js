import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(__dirname, '../database.sqlite');
const db = new sqlite3.Database(dbPath);

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

export const query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

export const getOne = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export const execute = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

export const initDb = async () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Create Users Table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT CHECK(role IN ('SUPERVISOR', 'AGENT')) NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create Tickets Table
      db.run(`
        CREATE TABLE IF NOT EXISTS tickets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_number TEXT UNIQUE NOT NULL,
          subject TEXT NOT NULL,
          description TEXT NOT NULL,
          requester_name TEXT NOT NULL,
          requester_email TEXT NOT NULL,
          status TEXT CHECK(status IN ('NEW', 'OPEN', 'PENDING', 'RESOLVED', 'CLOSED')) NOT NULL DEFAULT 'NEW',
          priority TEXT CHECK(priority IN ('URGENT', 'HIGH', 'MEDIUM', 'LOW')) NOT NULL DEFAULT 'MEDIUM',
          category TEXT CHECK(category IN ('BUG', 'BILLING', 'QUESTION', 'FEATURE', 'OTHER')) NOT NULL DEFAULT 'QUESTION',
          primary_assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          is_archived INTEGER DEFAULT 0,
          pending_started_at DATETIME,
          pending_duration_seconds INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          resolved_at DATETIME,
          closed_at DATETIME
        )
      `);

      // Create Collaborators Table
      db.run(`
        CREATE TABLE IF NOT EXISTS ticket_collaborators (
          ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (ticket_id, user_id)
        )
      `);

      // Create Replies Table
      db.run(`
        CREATE TABLE IF NOT EXISTS replies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
          author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          author_name TEXT NOT NULL,
          author_email TEXT NOT NULL,
          body TEXT NOT NULL,
          is_internal_note INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create Immutable Ticket History Table
      db.run(`
        CREATE TABLE IF NOT EXISTS ticket_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
          actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          actor_name TEXT NOT NULL,
          action_type TEXT NOT NULL,
          old_value TEXT,
          new_value TEXT,
          details TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create Triggers to Enforce Immutability on Ticket History
      db.run(`
        CREATE TRIGGER IF NOT EXISTS prevent_history_update
        BEFORE UPDATE ON ticket_history
        BEGIN
          SELECT RAISE(FAIL, 'Ticket history timeline records are immutable and cannot be edited.');
        END;
      `);

      db.run(`
        CREATE TRIGGER IF NOT EXISTS prevent_history_delete
        BEFORE DELETE ON ticket_history
        BEGIN
          SELECT RAISE(FAIL, 'Ticket history timeline records are immutable and cannot be deleted.');
        END;
      `);

      // Create SLA Acknowledgments Table
      db.run(`
        CREATE TABLE IF NOT EXISTS sla_acknowledgments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          acknowledged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          breach_count INTEGER DEFAULT 1,
          UNIQUE(ticket_id, user_id, breach_count)
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
};

export default db;
