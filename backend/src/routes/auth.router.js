import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getOne, query } from '../db.js';
import { JWT_SECRET, authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// User Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await getOne('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed.', details: err.message });
  }
});

// Get Current User Profile
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await getOne('SELECT id, name, email, role, created_at FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user profile.' });
  }
});

// List All Agents & Supervisors (for assignees & collaborators selection)
router.get('/users', authenticateToken, async (req, res) => {
  try {
    const users = await query('SELECT id, name, email, role FROM users ORDER BY name ASC');
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users list.' });
  }
});

export default router;
