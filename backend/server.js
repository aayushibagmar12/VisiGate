const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const Database = require('better-sqlite3');
const fs = require('fs');

const app = express();
const PORT = 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve visitor frontend
app.use(express.static(path.join(__dirname, '../visitor')));

// Serve uploaded photos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Database ─────────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'visigate.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS visitors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    pass_id     TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    age         INTEGER,
    mobile      TEXT NOT NULL,
    id_type     TEXT,
    id_number   TEXT,
    photo_path  TEXT,
    status      TEXT DEFAULT 'pending',
    check_in    TEXT,
    check_out   TEXT
  );

  CREATE TABLE IF NOT EXISTS location_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id  INTEGER NOT NULL,
    latitude    REAL,
    longitude   REAL,
    accuracy    REAL,
    recorded_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS location_gaps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id  INTEGER NOT NULL,
    gap_start   TEXT,
    gap_end     TEXT
  );

  CREATE TABLE IF NOT EXISTS guard_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    pass_id     TEXT NOT NULL,
    action      TEXT NOT NULL,
    note        TEXT,
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS blacklist (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    mobile      TEXT UNIQUE NOT NULL,
    reason      TEXT,
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  );
`);

// ─── Multer ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({ storage });

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generatePassId() {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `VG-${ts}-${rand}`;
}

function saveBase64Photo(base64String) {
  if (!base64String) return null;
  const matches = base64String.match(/^data:(.+);base64,(.+)$/);
  const data    = matches ? matches[2] : base64String;
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const filepath = path.join(__dirname, 'uploads', filename);
  fs.writeFileSync(filepath, Buffer.from(data, 'base64'));
  return `/uploads/${filename}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  VISITOR ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/visitor/checkin
app.post('/api/visitor/checkin', (req, res) => {
  try {
    const { name, age, mobile, id_type, id_number, photo } = req.body;

    if (!name || !mobile)
      return res.status(400).json({ success: false, message: 'Name and mobile are required.' });

    const blocked = db.prepare('SELECT * FROM blacklist WHERE mobile = ?').get(mobile);
    if (blocked)
      return res.status(403).json({
        success: false,
        message: `Entry denied. Blacklisted. Reason: ${blocked.reason || 'Not specified'}`
      });

    const pass_id    = generatePassId();
    const photo_path = photo ? saveBase64Photo(photo) : null;
    const check_in   = new Date().toISOString();

    db.prepare(`
      INSERT INTO visitors (pass_id, name, age, mobile, id_type, id_number, photo_path, status, check_in)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'checked_in', ?)
    `).run(pass_id, name, age || null, mobile, id_type || null, id_number || null, photo_path, check_in);

    res.json({ success: true, pass_id, check_in });
  } catch (err) {
    console.error('Checkin error:', err);
    res.status(500).json({ success: false, message: 'Server error during check-in.' });
  }
});

// POST /api/visitor/checkout
app.post('/api/visitor/checkout', (req, res) => {
  try {
    const { pass_id } = req.body;
    if (!pass_id)
      return res.status(400).json({ success: false, message: 'pass_id is required.' });

    const visitor = db.prepare('SELECT * FROM visitors WHERE pass_id = ?').get(pass_id);
    if (!visitor)
      return res.status(404).json({ success: false, message: 'Visitor not found.' });

    const check_out = new Date().toISOString();
    db.prepare(`UPDATE visitors SET status = 'checked_out', check_out = ? WHERE pass_id = ?`)
      .run(check_out, pass_id);

    res.json({ success: true, pass_id, check_out });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ success: false, message: 'Server error during check-out.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  LOCATION ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/location/ping
app.post('/api/location/ping', (req, res) => {
  try {
    const { pass_id, latitude, longitude, accuracy } = req.body;
    if (!pass_id)
      return res.status(400).json({ success: false, message: 'pass_id is required.' });

    const visitor = db.prepare('SELECT id FROM visitors WHERE pass_id = ?').get(pass_id);
    if (!visitor)
      return res.status(404).json({ success: false, message: 'Visitor not found.' });

    db.prepare(`
      INSERT INTO location_logs (visitor_id, latitude, longitude, accuracy)
      VALUES (?, ?, ?, ?)
    `).run(visitor.id, latitude, longitude, accuracy || null);

    res.json({ success: true });
  } catch (err) {
    console.error('Location ping error:', err);
    res.status(500).json({ success: false, message: 'Server error saving location.' });
  }
});

// POST /api/location/gap-start
app.post('/api/location/gap-start', (req, res) => {
  try {
    const { pass_id } = req.body;
    if (!pass_id)
      return res.status(400).json({ success: false, message: 'pass_id is required.' });

    const visitor = db.prepare('SELECT id FROM visitors WHERE pass_id = ?').get(pass_id);
    if (!visitor)
      return res.status(404).json({ success: false, message: 'Visitor not found.' });

    const gap_start = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO location_gaps (visitor_id, gap_start) VALUES (?, ?)
    `).run(visitor.id, gap_start);

    res.json({ success: true, gap_id: result.lastInsertRowid });
  } catch (err) {
    console.error('Gap start error:', err);
    res.status(500).json({ success: false, message: 'Server error logging gap start.' });
  }
});

// POST /api/location/gap-end
app.post('/api/location/gap-end', (req, res) => {
  try {
    const { pass_id } = req.body;
    if (!pass_id)
      return res.status(400).json({ success: false, message: 'pass_id is required.' });

    const visitor = db.prepare('SELECT id FROM visitors WHERE pass_id = ?').get(pass_id);
    if (!visitor)
      return res.status(404).json({ success: false, message: 'Visitor not found.' });

    const openGap = db.prepare(`
      SELECT id FROM location_gaps
      WHERE visitor_id = ? AND gap_end IS NULL
      ORDER BY id DESC LIMIT 1
    `).get(visitor.id);

    if (!openGap)
      return res.status(404).json({ success: false, message: 'No open gap found.' });

    const gap_end = new Date().toISOString();
    db.prepare('UPDATE location_gaps SET gap_end = ? WHERE id = ?').run(gap_end, openGap.id);

    res.json({ success: true });
  } catch (err) {
    console.error('Gap end error:', err);
    res.status(500).json({ success: false, message: 'Server error logging gap end.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GUARD ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/guard/scan/:pass_id
app.get('/api/guard/scan/:pass_id', (req, res) => {
  try {
    const visitor = db.prepare('SELECT * FROM visitors WHERE pass_id = ?').get(req.params.pass_id);
    if (!visitor)
      return res.status(404).json({ success: false, message: 'Visitor not found.' });

    res.json({ success: true, visitor });
  } catch (err) {
    console.error('Guard scan error:', err);
    res.status(500).json({ success: false, message: 'Server error scanning pass.' });
  }
});

// POST /api/guard/entry
app.post('/api/guard/entry', (req, res) => {
  try {
    const { pass_id, note } = req.body;
    if (!pass_id)
      return res.status(400).json({ success: false, message: 'pass_id is required.' });

    db.prepare(`INSERT INTO guard_logs (pass_id, action, note) VALUES (?, 'entry', ?)`)
      .run(pass_id, note || null);
    db.prepare(`UPDATE visitors SET status = 'inside' WHERE pass_id = ?`).run(pass_id);

    res.json({ success: true, message: 'Entry confirmed.' });
  } catch (err) {
    console.error('Guard entry error:', err);
    res.status(500).json({ success: false, message: 'Server error confirming entry.' });
  }
});

// POST /api/guard/exit
app.post('/api/guard/exit', (req, res) => {
  try {
    const { pass_id, note } = req.body;
    if (!pass_id)
      return res.status(400).json({ success: false, message: 'pass_id is required.' });

    db.prepare(`INSERT INTO guard_logs (pass_id, action, note) VALUES (?, 'exit', ?)`)
      .run(pass_id, note || null);

    const check_out = new Date().toISOString();
    db.prepare(`UPDATE visitors SET status = 'checked_out', check_out = ? WHERE pass_id = ?`)
      .run(check_out, pass_id);

    res.json({ success: true, message: 'Exit confirmed.' });
  } catch (err) {
    console.error('Guard exit error:', err);
    res.status(500).json({ success: false, message: 'Server error confirming exit.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/admin/visitors?status=inside&search=name_or_mobile
app.get('/api/admin/visitors', (req, res) => {
  try {
    const { status, search } = req.query;
    let query = 'SELECT * FROM visitors WHERE 1=1';
    const params = [];

    if (status)  { query += ' AND status = ?';                           params.push(status); }
    if (search)  { query += ' AND (name LIKE ? OR mobile LIKE ?)';       params.push(`%${search}%`, `%${search}%`); }

    query += ' ORDER BY check_in DESC';

    const visitors = db.prepare(query).all(...params);
    res.json({ success: true, visitors });
  } catch (err) {
    console.error('Admin visitors error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching visitors.' });
  }
});

// GET /api/admin/visitor/:id
app.get('/api/admin/visitor/:id', (req, res) => {
  try {
    const { id } = req.params;
    const visitor = db.prepare('SELECT * FROM visitors WHERE id = ?').get(id);
    if (!visitor)
      return res.status(404).json({ success: false, message: 'Visitor not found.' });

    const location_logs = db.prepare(
      'SELECT * FROM location_logs WHERE visitor_id = ? ORDER BY recorded_at ASC'
    ).all(id);

    const location_gaps = db.prepare(
      'SELECT * FROM location_gaps WHERE visitor_id = ? ORDER BY gap_start ASC'
    ).all(id);

    const guard_logs = db.prepare(
      'SELECT * FROM guard_logs WHERE pass_id = ? ORDER BY created_at ASC'
    ).all(visitor.pass_id);

    res.json({ success: true, visitor, location_logs, location_gaps, guard_logs });
  } catch (err) {
    console.error('Admin visitor detail error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching visitor detail.' });
  }
});

// POST /api/admin/blacklist
app.post('/api/admin/blacklist', (req, res) => {
  try {
    const { mobile, reason } = req.body;
    if (!mobile)
      return res.status(400).json({ success: false, message: 'Mobile is required.' });

    db.prepare(`INSERT OR REPLACE INTO blacklist (mobile, reason) VALUES (?, ?)`)
      .run(mobile, reason || null);

    res.json({ success: true, message: `${mobile} has been blacklisted.` });
  } catch (err) {
    console.error('Blacklist error:', err);
    res.status(500).json({ success: false, message: 'Server error adding to blacklist.' });
  }
});

// GET /api/admin/blacklist
app.get('/api/admin/blacklist', (req, res) => {
  try {
    const list = db.prepare('SELECT * FROM blacklist ORDER BY created_at DESC').all();
    res.json({ success: true, blacklist: list });
  } catch (err) {
    console.error('Blacklist fetch error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching blacklist.' });
  }
});

// DELETE /api/admin/blacklist/:mobile
app.delete('/api/admin/blacklist/:mobile', (req, res) => {
  try {
    db.prepare('DELETE FROM blacklist WHERE mobile = ?').run(req.params.mobile);
    res.json({ success: true, message: `${req.params.mobile} removed from blacklist.` });
  } catch (err) {
    console.error('Blacklist delete error:', err);
    res.status(500).json({ success: false, message: 'Server error removing from blacklist.' });
  }
});

// ─── 404 fallback ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ VisiGate running at http://localhost:${PORT}`);
  console.log(`   Frontend : http://localhost:${PORT}/index.html`);
  console.log(`   Database : ${path.join(__dirname, 'visigate.db')}`);
});