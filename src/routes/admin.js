// Admin panel: login, dashboard, reports, matches, resolution.
const express = require('express');
const bcrypt = require('bcryptjs');
const { q, getMatchThreshold } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ---------- login / logout -----------------------------------------------
router.get('/login', (req, res) => {
  res.render('admin_login', { title: 'Admin Login', error: null });
});

router.post('/login', async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const rows = await q(
      "SELECT * FROM users WHERE email = ? AND role = 'ADMIN' LIMIT 1", [email]
    );
    const admin = rows[0];
    if (!admin || !admin.password_hash ||
        !bcrypt.compareSync(password, admin.password_hash)) {
      return res.status(401).render('admin_login', {
        title: 'Admin Login', error: 'Invalid admin email or password.',
      });
    }
    req.session.adminId = admin.user_id;
    req.session.adminName = admin.name;
    res.redirect('/admin');
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---------- dashboard ----------------------------------------------------
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    // refresh matches BEFORE reading counts so the numbers are current
    await q('CALL SP_REFRESH_MATCHES()');
    const [lost, found, pending, resolved, thresholdRow] = await Promise.all([
      q("SELECT COUNT(*) c FROM lost_reports WHERE status = 'OPEN'"),
      q("SELECT COUNT(*) c FROM found_reports WHERE status = 'UNCLAIMED'"),
      q("SELECT COUNT(*) c FROM matches WHERE status = 'PENDING'"),
      q("SELECT COUNT(*) c FROM matches WHERE status = 'RESOLVED'"),
      getMatchThreshold(),
    ]);
    const threshold = Number.isInteger(thresholdRow) ? thresholdRow : 50;
    const top = await q(
      `SELECT * FROM possible_matches_view
       WHERE match_status = 'PENDING'
       ORDER BY match_score DESC LIMIT 5`
    );
    res.render('dashboard', {
      title: 'Admin Dashboard',
      counts: {
        lost: lost[0].c, found: found[0].c,
        pending: pending[0].c, resolved: resolved[0].c,
      },
      threshold, top,
      adminName: req.session.adminName,
    });
  } catch (e) { next(e); }
});

// ---------- lost reports -------------------------------------------------
router.get('/lost-reports', requireAdmin, async (req, res, next) => {
  try {
    const search = (req.query.q || '').trim();
    const rows = await q(
      `SELECT lr.lost_id, i.item_name, i.category, loc.location_name,
              lr.lost_date, lr.status
       FROM lost_reports lr
       JOIN items i ON i.item_id = lr.item_id
       JOIN locations loc ON loc.location_id = lr.location_id
       ${search ? `WHERE i.item_name LIKE ? OR i.category LIKE ?
              OR loc.location_name LIKE ?` : ''}
       ORDER BY lr.lost_id DESC`,
      search ? [`%${search}%`, `%${search}%`, `%${search}%`] : []
    );
    res.render('lost_reports', {
      title: 'Lost Reports', reports: rows, search,
      count: rows.length,
    });
  } catch (e) { next(e); }
});

// CSV export (same filter as the list view)
router.get('/lost-reports/export.csv', requireAdmin, async (req, res, next) => {
  try {
    const search = (req.query.q || '').trim();
    const rows = await q(
      `SELECT lr.lost_id, i.item_name, i.category, loc.location_name,
              lr.lost_date, lr.status
       FROM lost_reports lr
       JOIN items i ON i.item_id = lr.item_id
       JOIN locations loc ON loc.location_id = lr.location_id
       ${search ? `WHERE i.item_name LIKE ? OR i.category LIKE ?
              OR loc.location_name LIKE ?` : ''}
       ORDER BY lr.lost_id DESC`,
      search ? [`%${search}%`, `%${search}%`, `%${search}%`] : []
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="lost_reports.csv"');
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    res.write('id,item,category,location,date_lost,status\n');
    rows.forEach(r => res.write(
      [r.lost_id, r.item_name, r.category, r.location_name, r.lost_date, r.status]
        .map(esc).join(',') + '\n'
    ));
    res.end();
  } catch (e) { next(e); }
});

router.get('/lost-reports/:id', requireAdmin, async (req, res, next) => {
  try {
    const rows = await q(
      `SELECT lr.*, i.item_name, i.category, i.description, i.color, i.brand,
              i.photo, loc.location_name, u.name AS reporter, u.email, u.phone
       FROM lost_reports lr
       JOIN items i ON i.item_id = lr.item_id
       JOIN locations loc ON loc.location_id = lr.location_id
       JOIN users u ON u.user_id = lr.user_id
       WHERE lr.lost_id = ?`, [req.params.id]
    );
    if (!rows.length) return res.status(404).send('Lost report not found');
    const matches = await q(
      `SELECT match_id, match_score, status FROM matches
       WHERE lost_id = ? ORDER BY match_score DESC`, [req.params.id]
    );
    res.render('lost_report_detail', {
      title: 'Lost Report', report: rows[0], matches,
    });
  } catch (e) { next(e); }
});

// ---------- found reports ------------------------------------------------
router.get('/found-reports', requireAdmin, async (req, res, next) => {
  try {
    const search = (req.query.q || '').trim();
    const rows = await q(
      `SELECT fr.found_id, i.item_name, i.category, loc.location_name,
              fr.found_date, fr.source, fr.status
       FROM found_reports fr
       JOIN items i ON i.item_id = fr.item_id
       JOIN locations loc ON loc.location_id = fr.location_id
       ${search ? `WHERE i.item_name LIKE ? OR i.category LIKE ?
              OR loc.location_name LIKE ?` : ''}
       ORDER BY fr.found_id DESC`,
      search ? [`%${search}%`, `%${search}%`, `%${search}%`] : []
    );
    res.render('found_reports', {
      title: 'Found Reports', reports: rows, search,
      count: rows.length,
      notice: req.query.added
        ? 'Found item added — matches were generated for open lost reports.'
        : null,
    });
  } catch (e) { next(e); }
});

// CSV export (same filter as the list view)
router.get('/found-reports/export.csv', requireAdmin, async (req, res, next) => {
  try {
    const search = (req.query.q || '').trim();
    const rows = await q(
      `SELECT fr.found_id, i.item_name, i.category, loc.location_name,
              fr.found_date, fr.source, fr.status
       FROM found_reports fr
       JOIN items i ON i.item_id = fr.item_id
       JOIN locations loc ON loc.location_id = fr.location_id
       ${search ? `WHERE i.item_name LIKE ? OR i.category LIKE ?
              OR loc.location_name LIKE ?` : ''}
       ORDER BY fr.found_id DESC`,
      search ? [`%${search}%`, `%${search}%`, `%${search}%`] : []
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="found_reports.csv"');
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    res.write('id,item,category,location,date_found,source,status\n');
    rows.forEach(r => res.write(
      [r.found_id, r.item_name, r.category, r.location_name, r.found_date, r.source, r.status]
        .map(esc).join(',') + '\n'
    ));
    res.end();
  } catch (e) { next(e); }
});

router.get('/found-reports/:id', requireAdmin, async (req, res, next) => {
  try {
    const rows = await q(
      `SELECT fr.*, i.item_name, i.category, i.description, i.color, i.brand,
              i.photo, loc.location_name, u.name AS reporter, u.email, u.phone
       FROM found_reports fr
       JOIN items i ON i.item_id = fr.item_id
       JOIN locations loc ON loc.location_id = fr.location_id
       JOIN users u ON u.user_id = fr.user_id
       WHERE fr.found_id = ?`, [req.params.id]
    );
    if (!rows.length) return res.status(404).send('Found report not found');
    const matches = await q(
      `SELECT match_id, match_score, status FROM matches
       WHERE found_id = ? ORDER BY match_score DESC`, [req.params.id]
    );
    res.render('found_report_detail', {
      title: 'Found Report', report: rows[0], matches,
    });
  } catch (e) { next(e); }
});

// ---------- add found item from the physical BOX -------------------------
const multer = require('multer');
const path = require('path');
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}_${Math.round(Math.random() * 1e6)}_${safe}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  },
});

router.get('/box-entry', requireAdmin, async (req, res, next) => {
  try {
    res.render('box_entry', {
      title: 'Add Found Item (Box)',
      categories: ['Electronics', 'Wallet', 'Bottle', 'Book', 'ID Card', 'Keys',
        'Bag', 'Clothing', 'Accessories', 'Jewellery', 'Other'],
      locations: await q('SELECT location_id, location_name FROM locations ORDER BY location_name'),
      values: {}, errors: [],
    });
  } catch (e) { next(e); }
});

router.post('/box-entry', requireAdmin, upload.single('photo'), async (req, res, next) => {
  try {
    const errors = [];
    const item_name = (req.body.item_name || '').trim();
    const category = (req.body.category || '').trim();
    const description = (req.body.description || '').trim() || 'No description provided';
    const color = (req.body.color || '').trim() || null;
    const brand = (req.body.brand || '').trim() || null;
    const location_name = (req.body.location_name || '').trim();
    const found_date = req.body.found_date;
    const finder_name = (req.body.finder_name || '').trim() || 'Lost & Found Box';
    const finder_email = (req.body.finder_email || '').trim().toLowerCase()
      || 'box@campus.edu';
    const finder_phone = (req.body.finder_phone || '').trim() || '0000000000';

    if (!item_name) errors.push('Item name is required.');
    if (!category) errors.push('Category is required.');
    if (!location_name) errors.push('Location is required.');
    if (!found_date) errors.push('Date found is required.');

    if (errors.length) {
      return res.render('box_entry', {
        title: 'Add Found Item (Box)',
        categories: ['Electronics', 'Wallet', 'Bottle', 'Book', 'ID Card', 'Keys',
          'Bag', 'Clothing', 'Accessories', 'Jewellery', 'Other'],
        locations: await q('SELECT location_id, location_name FROM locations ORDER BY location_name'),
        values: req.body, errors,
      });
    }

    let conn;
    try {
      conn = await require('../db').pool.getConnection();
      await conn.beginTransaction();
      // reuse a student account for the box, or create one
      let userId;
      const [u] = await conn.query(
        'SELECT user_id FROM users WHERE email = ? LIMIT 1', [finder_email]
      );
      if (u.length) userId = u[0].user_id;
      else {
        const [ins] = await conn.query(
          "INSERT INTO users (name, email, phone, role) VALUES (?, ?, ?, 'STUDENT')",
          [finder_name, finder_email, finder_phone]
        );
        userId = ins.insertId;
      }
      const [loc] = await conn.query(
        'SELECT location_id FROM locations WHERE location_name = ? LIMIT 1',
        [location_name]
      );
      let locationId;
      if (loc.length) locationId = loc[0].location_id;
      else {
        const [ins] = await conn.query(
          'INSERT INTO locations (location_name) VALUES (?)', [location_name]
        );
        locationId = ins.insertId;
      }
      const [itemRes] = await conn.query(
        `INSERT INTO items (item_name, category, description, color, brand, photo)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [item_name, category, description, color, brand,
         req.file ? `uploads/${req.file.filename}` : null]
      );
      await conn.query(
        `INSERT INTO found_reports
           (user_id, item_id, location_id, found_date, found_time, source, status)
         VALUES (?, ?, ?, ?, ?, 'BOX', 'UNCLAIMED')`,
        [userId, itemRes.insertId, locationId, found_date, req.body.found_time || null]
      );
      await conn.query('CALL SP_REFRESH_MATCHES()');
      await conn.commit();
    } catch (err) {
      if (conn) await conn.rollback();
      throw err;
    } finally {
      if (conn) conn.release();
    }
    res.redirect('/admin/found-reports?added=1');
  } catch (e) { next(e); }
});

// ---------- matches ------------------------------------------------------
const MATCH_STATUSES = ['Pending', 'RESOLVED', 'REJECTED', 'ALL'];

router.get('/matches', requireAdmin, async (req, res, next) => {
  try {
    const status = MATCH_STATUSES.includes(req.query.status) ? req.query.status : 'Pending';
    const rows = status === 'ALL'
      ? await q('SELECT * FROM possible_matches_view ORDER BY match_score DESC')
      : await q(
          'SELECT * FROM possible_matches_view WHERE match_status = ? ORDER BY match_score DESC',
          [status.toUpperCase()]
        );
    res.render('matches', {
      title: 'Possible Matches', matches: rows, status,
      threshold: await getMatchThreshold(),
    });
  } catch (e) { next(e); }
});

router.get('/matches/:id', requireAdmin, async (req, res, next) => {
  try {
    const rows = await q(
      'SELECT * FROM possible_matches_view WHERE match_id = ?', [req.params.id]
    );
    if (!rows.length) return res.status(404).send('Match not found');
    const m = rows[0];
    // reshape the view row into the two cards the template expects
    res.render('match_detail', {
      title: 'Match Details', match: { match_id: m.match_id, status: m.match_status },
      score: Math.round(Number(m.match_score)),
      lost: {
        item_name: m.lost_item, category: m.lost_category, color: m.lost_color,
        brand: m.lost_brand, location_name: m.lost_location, lost_date: m.lost_date,
        status: m.lost_status, description: m.lost_desc, photo: m.lost_photo,
        reporter: m.lost_user, email: m.lost_email, phone: m.lost_phone,
        lost_id: m.lost_id,
      },
      found: {
        item_name: m.found_item, category: m.found_category, color: m.found_color,
        brand: m.found_brand, location_name: m.found_location, found_date: m.found_date,
        source: m.found_source, status: m.found_status, description: m.found_desc,
        photo: m.found_photo, reporter: m.found_user, email: m.found_email,
        phone: m.found_phone, found_id: m.found_id,
      },
    });
  } catch (e) { next(e); }
});

router.post('/matches/:id/resolve', requireAdmin, async (req, res, next) => {
  try {
    await q("UPDATE matches SET status = 'RESOLVED', resolved_at = NOW() WHERE match_id = ?",
      [req.params.id]);
    // TRG_MATCH_AFTER_UPDATE resolves both reports; SP_REFRESH_MATCHES then
    // rejects the stale PENDING matches of those same reports (a trigger
    // cannot update the `matches` table itself — MySQL error 1442).
    await q('CALL SP_REFRESH_MATCHES()');
    req.session.notice = 'Match confirmed — both reports are now resolved.';
    res.redirect('/admin/matches');
  } catch (e) { next(e); }
});

router.post('/matches/:id/reject', requireAdmin, async (req, res, next) => {
  try {
    await q("UPDATE matches SET status = 'REJECTED' WHERE match_id = ?",
      [req.params.id]);
    req.session.notice = 'Match rejected.';
    res.redirect('/admin/matches');
  } catch (e) { next(e); }
});

// ---------- resolved items ------------------------------------------------
router.get('/resolved', requireAdmin, async (req, res, next) => {
  try {
    const rows = await q(
      `SELECT * FROM resolved_items_view ORDER BY resolved_at DESC`
    );
    res.render('resolved', {
      title: 'Resolved Matches', rows,
      notice: req.session.notice || null,
    });
    delete req.session.notice;
  } catch (e) { next(e); }
});

module.exports = router;
