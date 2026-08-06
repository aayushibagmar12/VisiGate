const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const fs = require('fs');

const app = express();
const PORT = 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve visitor frontend
app.use(express.static(path.join(__dirname, '../visitor')));
app.use(express.static(path.join(__dirname, '..')));

// Serve guard frontend
app.use('/guard', express.static(path.join(__dirname, '../guard')));

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

  CREATE TABLE IF NOT EXISTS otps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    mobile      TEXT NOT NULL,
    otp_code    TEXT NOT NULL,
    verified    INTEGER DEFAULT 0,
    expires_at  TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS meeting_requests (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    pass_id             TEXT NOT NULL,
    visitor_name        TEXT NOT NULL,
    reason              TEXT,
    enrollment_number   TEXT NOT NULL,
    token               TEXT UNIQUE NOT NULL,
    status              TEXT DEFAULT 'pending',
    created_at          TEXT DEFAULT (datetime('now','localtime'))
  );
`);
// Add preserve_location column if it doesn't exist yet
try {
  db.exec(`ALTER TABLE visitors ADD COLUMN preserve_location INTEGER DEFAULT 0`);
} catch (e) {
  // Column already exists, ignore
}

try {
  db.exec(`ALTER TABLE visitors ADD COLUMN accompanying_count INTEGER DEFAULT 0`);
} catch (e) {
  // Column already exists, ignore
}

try {
  db.exec(`ALTER TABLE visitors ADD COLUMN vehicle_number TEXT`);
} catch (e) {
  // Column already exists, ignore
}

try {
  db.exec(`ALTER TABLE visitors ADD COLUMN id_photo_path TEXT`);
} catch (e) {
  // Column already exists, ignore
}

// Admins table
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
`);

// Seed default admin account if not already present
const defaultAdminExists = db.prepare('SELECT * FROM admins WHERE username = ?').get('IIIT NR admin');
if (!defaultAdminExists) {
  const hashedPassword = bcrypt.hashSync('IIIT NR login0987', 10);
  db.prepare('INSERT INTO admins (username, password) VALUES (?, ?)').run('IIIT NR admin', hashedPassword);
  console.log('✅ Default admin account created: IIIT NR admin');
}

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

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
}

// Simulated SMS sender — replace this with a real SMS provider later
// (e.g. Twilio, MSG91, Fast2SMS). For now it just prints to the server console.
function sendSms(mobile, message) {
  console.log(`📱 [SIMULATED SMS] To: ${mobile} | Message: ${message}`);
}

function generateApprovalToken() {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
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

// ─────────────────────────────────────────────
//  AUTH ROUTES (Mobile OTP login)
// ─────────────────────────────────────────────

const OTP_EXPIRY_MINUTES = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 30;

// POST /api/auth/send-otp
app.post('/api/auth/send-otp', (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile || !/^[0-9]{10}$/.test(mobile))
      return res.status(400).json({ success: false, message: 'A valid 10-digit mobile number is required.' });

    const blocked = db.prepare('SELECT * FROM blacklist WHERE mobile = ?').get(mobile);
    if (blocked)
      return res.status(403).json({ success: false, message: 'This number is not allowed to register.' });

    // Misuse protection: block if the last OTP for this number was requested too recently
    const lastOtp = db.prepare(`
      SELECT * FROM otps WHERE mobile = ? ORDER BY created_at DESC LIMIT 1
    `).get(mobile);

    if (lastOtp) {
      const secondsSinceLast = (Date.now() - new Date(lastOtp.created_at).getTime()) / 1000;
      if (secondsSinceLast < OTP_RESEND_COOLDOWN_SECONDS) {
        const waitSeconds = Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLast);
        return res.status(429).json({
          success: false,
          message: `Please wait ${waitSeconds}s before requesting another OTP.`,
          wait_seconds: waitSeconds
        });
      }
    }

    const otp_code   = generateOtp();
    const expires_at = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

    db.prepare(`INSERT INTO otps (mobile, otp_code, expires_at) VALUES (?, ?, ?)`)
      .run(mobile, otp_code, expires_at);

    sendSms(mobile, `Your VisiGate OTP is ${otp_code}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`);

    res.json({ success: true, message: 'OTP sent successfully.' });
  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ success: false, message: 'Server error sending OTP.' });
  }
});

// POST /api/auth/verify-otp
app.post('/api/auth/verify-otp', (req, res) => {
  try {
    const { mobile, otp } = req.body;
    if (!mobile || !otp)
      return res.status(400).json({ success: false, message: 'Mobile and OTP are required.' });

    const record = db.prepare(`
      SELECT * FROM otps
      WHERE mobile = ? AND otp_code = ? AND verified = 0
      ORDER BY created_at DESC LIMIT 1
    `).get(mobile, otp);

    if (!record)
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });

    if (new Date(record.expires_at) < new Date())
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });

    db.prepare('UPDATE otps SET verified = 1 WHERE id = ?').run(record.id);

    res.json({ success: true, message: 'Mobile number verified successfully.' });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ success: false, message: 'Server error verifying OTP.' });
  }
});

// ─────────────────────────────────────────────
//  MEETING REQUEST ROUTES (Whom to meet & approval)
// ─────────────────────────────────────────────

// POST /api/meet/request
app.post('/api/meet/request', (req, res) => {
  try {
    const { pass_id, visitor_name, reason, enrollment_number } = req.body;
    if (!pass_id || !visitor_name || !enrollment_number)
      return res.status(400).json({ success: false, message: 'pass_id, visitor_name, and enrollment_number are required.' });

    const token = generateApprovalToken();

    db.prepare(`
      INSERT INTO meeting_requests (pass_id, visitor_name, reason, enrollment_number, token)
      VALUES (?, ?, ?, ?, ?)
    `).run(pass_id, visitor_name, reason || null, enrollment_number, token);

    const approvalLink = `http://localhost:${PORT}/approve.html?token=${token}`;
    console.log(`🔔 [APPROVAL LINK] For enrollment ${enrollment_number}: ${approvalLink}`);

    res.json({ success: true, message: 'Meeting request created.', token });
  } catch (err) {
    console.error('Meet request error:', err);
    res.status(500).json({ success: false, message: 'Server error creating meeting request.' });
  }
});

// GET /api/meet/status/:token
app.get('/api/meet/status/:token', (req, res) => {
  try {
    const request = db.prepare('SELECT * FROM meeting_requests WHERE token = ?').get(req.params.token);
    if (!request)
      return res.status(404).json({ success: false, message: 'Request not found.' });

    // Also fetch the visitor's fuller details (photo, mobile, vehicle, accompanying count)
    const visitor = db.prepare('SELECT photo_path, mobile, accompanying_count, vehicle_number FROM visitors WHERE pass_id = ?').get(request.pass_id);

    res.json({ success: true, request, visitor: visitor || null });
  } catch (err) {
    console.error('Meet status error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching request.' });
  }
});
// POST /api/meet/respond
app.post('/api/meet/respond', (req, res) => {
  try {
    const { token, decision } = req.body;
    if (!token || !['approved', 'denied'].includes(decision))
      return res.status(400).json({ success: false, message: 'token and a valid decision (approved/denied) are required.' });

    const request = db.prepare('SELECT * FROM meeting_requests WHERE token = ?').get(token);
    if (!request)
      return res.status(404).json({ success: false, message: 'Request not found.' });

    db.prepare('UPDATE meeting_requests SET status = ? WHERE token = ?').run(decision, token);

    res.json({ success: true, message: `Request ${decision}.` });
  } catch (err) {
    console.error('Meet respond error:', err);
    res.status(500).json({ success: false, message: 'Server error responding to request.' });
  }
});

// GET /api/meet/status-by-pass/:pass_id
app.get('/api/meet/status-by-pass/:pass_id', (req, res) => {
  try {
    const request = db.prepare(`
      SELECT * FROM meeting_requests WHERE pass_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(req.params.pass_id);

    if (!request)
      return res.json({ success: true, request: null });

    res.json({ success: true, request });
  } catch (err) {
    console.error('Meet status-by-pass error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching request.' });
  }
});

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

// POST /api/visitor/upload-photo
app.post('/api/visitor/upload-photo', (req, res) => {
  try {
    const { photo } = req.body;
    if (!photo)
      return res.status(400).json({ success: false, message: 'Photo data is required.' });

    const photo_path = saveBase64Photo(photo);
    res.json({ success: true, photo_path });
  } catch (err) {
    console.error('Photo upload error:', err);
    res.status(500).json({ success: false, message: 'Server error uploading photo.' });
  }
});

// GET /api/visitor/status/:pass_id
app.get('/api/visitor/status/:pass_id', (req, res) => {
  try {
    const visitor = db.prepare('SELECT status, check_in, check_out FROM visitors WHERE pass_id = ?').get(req.params.pass_id);
    if (!visitor)
      return res.json({ success: true, status: 'not_found' });

    res.json({ success: true, status: visitor.status, check_in: visitor.check_in, check_out: visitor.check_out });
  } catch (err) {
    console.error('Status poll error:', err);
    res.status(500).json({ success: false, message: 'Server error checking status.' });
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
// Creates visitor record in DB (if not exists) and confirms entry
app.post('/api/guard/entry', (req, res) => {
  try {
      const { pass_id, name, age, mobile, id_type, id_number, photo_path, note, accompanying_count, vehicle_number, id_photo_path } = req.body;    if (!pass_id || !name || !mobile)
      return res.status(400).json({ success: false, message: 'pass_id, name, and mobile are required.' });

    // Blacklist check
    const blocked = db.prepare('SELECT * FROM blacklist WHERE mobile = ?').get(mobile);
    if (blocked)
      return res.status(403).json({
        success: false,
        message: `Entry denied. Blacklisted. Reason: ${blocked.reason || 'Not specified'}`
      });

    // Check if visitor already exists (e.g. re-scan)
    const existing = db.prepare('SELECT * FROM visitors WHERE pass_id = ?').get(pass_id);

    if (!existing) {
      // Create the visitor record
      const check_in = new Date().toISOString();
       db.prepare(`
          INSERT INTO visitors (pass_id, name, age, mobile, id_type, id_number, photo_path, status, check_in, accompanying_count, vehicle_number, id_photo_path)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'inside', ?, ?, ?, ?)
        `).run(pass_id, name, age || null, mobile, id_type || null, id_number || null, photo_path || null, check_in, accompanying_count || 0, vehicle_number || null, id_photo_path || null);
    } else {
      // Update status to inside
      db.prepare(`UPDATE visitors SET status = 'inside' WHERE pass_id = ?`).run(pass_id);
    }

    // Log guard action
    db.prepare(`INSERT INTO guard_logs (pass_id, action, note) VALUES (?, 'entry', ?)`)
      .run(pass_id, note || 'Guard verified entry via QR');

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

// GET /api/guard/active?search=name_or_mobile
app.get('/api/guard/active', (req, res) => {
  try {
    const { search } = req.query;
    let query = `SELECT * FROM visitors WHERE status IN ('inside', 'checked_in')`;
    const params = [];

    if (search) {
      query += ' AND (name LIKE ? OR mobile LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY check_in DESC';

    const visitors = db.prepare(query).all(...params);
    res.json({ success: true, visitors });
  } catch (err) {
    console.error('Guard active search error:', err);
    res.status(500).json({ success: false, message: 'Server error searching active visitors.' });
  }
});

// GET /api/guard/logs/today
app.get('/api/guard/logs/today', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const logs = db.prepare(`
      SELECT
        gl.id, gl.pass_id, gl.action, gl.note, gl.created_at,
        v.name AS visitor_name, v.mobile AS visitor_mobile
      FROM guard_logs gl
      LEFT JOIN visitors v ON v.pass_id = gl.pass_id
      WHERE date(gl.created_at) = date('now', 'localtime')
      ORDER BY gl.created_at DESC
    `).all();
    res.json({ success: true, logs });
  } catch (err) {
    console.error('Guard today logs error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching today\'s logs.' });
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

// POST /api/admin/login
app.post('/api/admin/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: 'Username and password are required.' });

    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    if (!admin)
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });

    const match = bcrypt.compareSync(password, admin.password);
    if (!match)
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });

    res.json({ success: true, message: 'Login successful.', username: admin.username });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});

// POST /api/admin/create-account
app.post('/api/admin/create-account', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: 'Username and password are required.' });

    const exists = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
    if (exists)
      return res.status(409).json({ success: false, message: 'Username already exists.' });

    const hashed = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO admins (username, password) VALUES (?, ?)').run(username, hashed);
    res.json({ success: true, message: `Account '${username}' created successfully.` });
  } catch (err) {
    console.error('Create account error:', err);
    res.status(500).json({ success: false, message: 'Server error creating account.' });
  }
});

// DELETE /api/admin/visitor/:id
app.delete('/api/admin/visitor/:id', (req, res) => {
  try {
    const { id } = req.params;
    const visitor = db.prepare('SELECT * FROM visitors WHERE id = ?').get(id);
    if (!visitor)
      return res.status(404).json({ success: false, message: 'Visitor not found.' });

    db.prepare('DELETE FROM location_logs WHERE visitor_id = ?').run(id);
    db.prepare('DELETE FROM location_gaps WHERE visitor_id = ?').run(id);
    db.prepare('DELETE FROM guard_logs WHERE pass_id = ?').run(visitor.pass_id);
    db.prepare('DELETE FROM visitors WHERE id = ?').run(id);

    // Delete photo file if exists
    if (visitor.photo_path) {
      const fullPath = path.join(__dirname, visitor.photo_path.replace('/uploads/', 'uploads/'));
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }

    res.json({ success: true, message: 'Visitor deleted successfully.' });
  } catch (err) {
    console.error('Delete visitor error:', err);
    res.status(500).json({ success: false, message: 'Server error deleting visitor.' });
  }
});

// PATCH /api/admin/visitor/:id/preserve
app.patch('/api/admin/visitor/:id/preserve', (req, res) => {
  try {
    const { id } = req.params;
    const visitor = db.prepare('SELECT * FROM visitors WHERE id = ?').get(id);
    if (!visitor)
      return res.status(404).json({ success: false, message: 'Visitor not found.' });

    const newValue = visitor.preserve_location === 1 ? 0 : 1;
    db.prepare('UPDATE visitors SET preserve_location = ? WHERE id = ?').run(newValue, id);
    res.json({ success: true, preserve_location: newValue });
  } catch (err) {
    console.error('Preserve toggle error:', err);
    res.status(500).json({ success: false, message: 'Server error toggling preserve.' });
  }
});

// 7-day location cleanup (skips preserved visitors)
function runLocationCleanup() {
  try {
    const result = db.prepare(`
      DELETE FROM location_logs
      WHERE recorded_at < datetime('now', '-7 days', 'localtime')
      AND visitor_id NOT IN (
        SELECT id FROM visitors WHERE preserve_location = 1
      )
    `).run();
    if (result.changes > 0)
      console.log(`🧹 Cleanup: deleted ${result.changes} old location logs`);
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}

// Run cleanup on start and every 24 hours
runLocationCleanup();
setInterval(runLocationCleanup, 24 * 60 * 60 * 1000);

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