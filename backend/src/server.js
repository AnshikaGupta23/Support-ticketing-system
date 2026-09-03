import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db.js';

import authRouter from './routes/auth.router.js';
import ticketsRouter from './routes/tickets.router.js';
import repliesRouter from './routes/replies.router.js';
import dashboardRouter from './routes/dashboard.router.js';
import { seedDatabase } from './seed.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Repo root is one level above backend/ (server runs from backend/).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Allowlist of documentation files served by the in-app docs viewer.
const DOC_FILES = {
  submission: 'SUBMISSION.md',
  architecture: 'docs/architecture.md',
  schema: 'docs/schema.md',
  plan: 'docs/plan.md',
  decisions: 'docs/decisions.md',
  'ai-prompts': 'docs/ai-prompts.md',
};

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Mount Routes
app.use('/api/auth', authRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/tickets/:id/replies', repliesRouter);
app.use('/api/dashboard', dashboardRouter);

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Support Ticketing System API running smoothly.' });
});

// In-app docs viewer: serve the repo's markdown files by allowlisted key.
app.get('/api/docs/:file', (req, res) => {
  const fileKey = String(req.params.file || '').toLowerCase();
  const relativePath = DOC_FILES[fileKey];

  if (!relativePath) {
    return res.status(404).json({ error: `Unknown document: ${fileKey}` });
  }

  const filePath = path.join(REPO_ROOT, relativePath);
  res.sendFile(filePath, (err) => {
    if (err) {
      res.status(404).json({ error: 'Document not found.', details: err.message });
    }
  });
});

// Seed API endpoint for instant demo reset
app.post('/api/seed', async (req, res) => {
  try {
    await seedDatabase();
    res.json({ message: 'Database successfully re-seeded with demo data.' });
  } catch (err) {
    res.status(500).json({ error: 'Database seed failed.', details: err.message });
  }
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});

// Initialize DB and Start Server
const startServer = async () => {
  try {
    await initDb();
    // Auto seed if empty
    await seedDatabase();

    app.listen(PORT, () => {
      console.log(`🚀 Support Ticketing API Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

startServer();
