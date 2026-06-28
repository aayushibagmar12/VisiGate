const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const multer = require('multer');

const app = express();
const PORT = 3000;

// ── middleware ──
app.use(cors({
    origin: ['http://127.0.0.1:5500', 'http://localhost:5500', 'http://localhost:3000']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.urlencoded({ extended: true }));

// ── serve frontend files ──
app.use(express.static(path.join(__dirname, '../VisiGate')));

// ── setup uploads folder ──
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/uploads', express.static(uploadDir));

// ── setup database ──
const db = new Database(path.join(__dirname, 'visigate.db'));

// create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS visitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pass_id TEXT UNIQUE,
    name TEXT,
    age INTEGER,
    mobile TEXT,
    id_type TEXT,
    id_number TEXT,
    photo_path TEXT,
    status TEXT DEFAULT 'inside',
    check_in TEXT,
    check_out TEXT
  );

  CREATE TABLE IF NOT EXISTS location_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id INTEGER,
    latitude REAL,
    longitude REAL,
    accuracy REAL,
    recorded_at TEXT
  );

  CREATE TABLE IF NOT EXISTS location_gaps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id INTEGER,
    gap_start TEXT,
    gap_end TEXT
  );

  CREATE TABLE IF NOT EXISTS guard_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pass_id TEXT,
    action TEXT,
    note TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mobile TEXT UNIQUE,
    reason TEXT,
    created_at TEXT
  );
`);

console.log('✅ Database ready');

// ─────────────────────────────────────────
// VISITOR ROUTES
// ─────────────────────────────────────────

// Save visitor form + photo
app.post('/api/visitor/checkin', (req, res) => {
  try {
    const { name, age, mobile, id_type, id_number, photo, pass_id } = req.body;

    // check blacklist
    const blocked = db.prepare('SELECT * FROM blacklist WHERE mobile = ?').get(mobile);
    if (blocked) {
      return res.status(403).json({ error: 'Entry not permitted. Contact the administration office.' });
    }

    // save photo as file
    let photo_path = null;
    if (photo) {
      try {
        const base64Data = photo.replace(/^data:image\/jpeg;base64,/, '').replace(/^data:image\/png;base64,/, '');
        const filename = `${pass_id}.jpg`;
        photo_path = path.join(uploadDir, filename);
        fs.writeFileSync(photo_path, base64Data, 'base64');
      } catch (photoErr) {
        console.error('Photo save error:', photoErr);
      }
    }

    // delete old entry with same pass_id if exists
    db.prepare('DELETE FROM visitors WHERE pass_id = ?').run(pass_id);

    // save visitor
    db.prepare(`
      INSERT INTO visitors (pass_id, name, age, mobile, id_type, id_number, photo_path, status, check_in)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'inside', ?)
    `).run(pass_id, name, age, mobile, id_type, id_number, photo_path, new Date().toISOString());

    res.json({ success: true, pass_id });
  } catch (err) {
    console.error('Checkin error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Checkout visitor
app.post('/api/visitor/checkout', (req, res) => {
  try {
    const { pass_id } = req.body;
    db.prepare(`UPDATE visitors SET status = 'exited', check_out = ? WHERE pass_id = ?`)
      .run(new Date().toISOString(), pass_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────
// LOCATION ROUTES
// ─────────────────────────────────────────

app.post('/api/location/ping', (req, res) => {
  try {
    const { pass_id, latitude, longitude, accuracy, timestamp } = req.body;
    const visitor = db.prepare('SELECT id FROM visitors WHERE pass_id = ?').get(pass_id);
    if (!visitor) return res.status(404).json({ error: 'Visitor not found' });

    db.prepare(`INSERT INTO location_logs (visitor_id, latitude, longitude, accuracy, recorded_at)
      VALUES (?, ?, ?, ?, ?)`)
      .run(visitor.id, latitude, longitude, accuracy, timestamp);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/location/gap-start', (req, res) => {
  try {
    const { pass_id, gap_start } = req.body;
    const visitor = db.prepare('SELECT id FROM visitors WHERE pass_id = ?').get(pass_id);
    if (!visitor) return res.status(404).json({ error: 'Visitor not found' });

    db.prepare('INSERT INTO location_gaps (visitor_id, gap_start) VALUES (?, ?)')
      .run(visitor.id, gap_start);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/location/gap-end', (req, res) => {
  try {
    const { pass_id, gap_start, gap_end } = req.body;
    const visitor = db.prepare('SELECT id FROM visitors WHERE pass_id = ?').get(pass_id);
    if (!visitor) return res.status(404).json({ error: 'Visitor not found' });

    db.prepare(`UPDATE location_gaps SET gap_end = ? 
      WHERE visitor_id = ? AND gap_start = ? AND gap_end IS NULL`)
      .run(gap_end, visitor.id, gap_start);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────
// GUARD ROUTES
// ─────────────────────────────────────────

// Get visitor by pass_id (guard scans QR)
app.get('/api/guard/scan/:pass_id', (req, res) => {
  try {
    const visitor = db.prepare('SELECT * FROM visitors WHERE pass_id = ?').get(req.params.pass_id);
    if (!visitor) return res.status(404).json({ error: 'Invalid QR code' });

    // attach photo URL
    if (visitor.photo_path) {
      visitor.photo_url = `/uploads/${path.basename(visitor.photo_path)}`;
    }

    res.json({ success: true, visitor });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Guard confirms entry
app.post('/api/guard/entry', (req, res) => {
  try {
    const { pass_id, note } = req.body;
    db.prepare('INSERT INTO guard_logs (pass_id, action, note, created_at) VALUES (?, ?, ?, ?)')
      .run(pass_id, 'entry', note || '', new Date().toISOString());
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Guard confirms exit
app.post('/api/guard/exit', (req, res) => {
  try {
    const { pass_id, note } = req.body;
    db.prepare('INSERT INTO guard_logs (pass_id, action, note, created_at) VALUES (?, ?, ?, ?)')
      .run(pass_id, 'exit', note || '', new Date().toISOString());
    db.prepare(`UPDATE visitors SET status = 'exited', check_out = ? WHERE pass_id = ?`)
      .run(new Date().toISOString(), pass_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────

// Get all active visitors
app.get('/api/admin/visitors', (req, res) => {
  try {
    const visitors = db.prepare(`SELECT * FROM visitors ORDER BY check_in DESC`).all();
    visitors.forEach(v => {
      if (v.photo_path) v.photo_url = `/uploads/${path.basename(v.photo_path)}`;
    });
    res.json({ success: true, visitors });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single visitor with location trail
app.get('/api/admin/visitor/:id', (req, res) => {
  try {
    const visitor = db.prepare('SELECT * FROM visitors WHERE id = ?').get(req.params.id);
    if (!visitor) return res.status(404).json({ error: 'Not found' });
    if (visitor.photo_path) visitor.photo_url = `/uploads/${path.basename(visitor.photo_path)}`;

    const locations = db.prepare('SELECT * FROM location_logs WHERE visitor_id = ? ORDER BY recorded_at ASC').all(visitor.id);
    const gaps = db.prepare('SELECT * FROM location_gaps WHERE visitor_id = ? ORDER BY gap_start ASC').all(visitor.id);

    res.json({ success: true, visitor, locations, gaps });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Blacklist
app.post('/api/admin/blacklist', (req, res) => {
  try {
    const { mobile, reason } = req.body;
    db.prepare('INSERT OR REPLACE INTO blacklist (mobile, reason, created_at) VALUES (?, ?, ?)')
      .run(mobile, reason, new Date().toISOString());
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── start server ──
app.listen(PORT, () => {
  console.log(`🚀 VisiGate backend running at http://localhost:${PORT}`);
});