// Student-facing pages: home, lost form, found form.
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { q, withTransaction, getMatchThreshold } = require('../db');
const { previewForLost, previewForFound } = require('../matching');

const router = express.Router();

const CATEGORIES = [
  'Electronics', 'Wallet', 'Bottle', 'Book', 'ID Card', 'Keys',
  'Bag', 'Clothing', 'Accessories', 'Jewellery', 'Other',
];

// ---- photo upload (optional) -------------------------------------------
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
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

// ---- helpers ------------------------------------------------------------
async function allLocations() {
  return q('SELECT location_id, location_name FROM locations ORDER BY location_name');
}

async function resolveLocationId(conn, name) {
  const clean = (name || '').trim();
  if (!clean) throw new Error('Location is required');
  let rows = await conn.query(
    'SELECT location_id FROM locations WHERE location_name = ? LIMIT 1', [clean]
  );
  if (rows[0].length) return rows[0][0].location_id;
  const ins = await conn.query(
    'INSERT INTO locations (location_name) VALUES (?)', [clean]
  );
  return ins[0].insertId;
}

function pickItemFields(body) {
  return {
    item_name: (body.item_name || '').trim(),
    category: (body.category || '').trim(),
    description: (body.description || '').trim(),
    color: (body.color || '').trim() || null,
    brand: (body.brand || '').trim() || null,
  };
}

function pickPersonFields(body) {
  return {
    name: (body.name || '').trim(),
    email: (body.email || '').trim().toLowerCase(),
    phone: (body.phone || '').trim(),
  };
}

function validateForm(body) {
  const errs = [];
  const person = pickPersonFields(body);
  const item = pickItemFields(body);
  if (!person.name) errs.push('Name is required.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(person.email)) errs.push('A valid email is required.');
  if (!/^[0-9+\-\s]{7,15}$/.test(person.phone)) errs.push('A valid phone number is required.');
  if (!item.item_name) errs.push('Item name is required.');
  if (!item.category) errs.push('Category is required.');
  if (!item.description) errs.push('Description is required.');
  if (!(body.location_name || '').trim()) errs.push('Location is required.');
  if (!body.report_date) errs.push('Date is required.');
  return { errs, person, item };
}

async function getOrCreateUser(conn, person) {
  const rows = await conn.query(
    'SELECT user_id FROM users WHERE email = ? LIMIT 1', [person.email]
  );
  if (rows[0].length) return rows[0][0].user_id;
  const ins = await conn.query(
    "INSERT INTO users (name, email, phone, role) VALUES (?, ?, ?, 'STUDENT')",
    [person.name, person.email, person.phone]
  );
  return ins[0].insertId;
}

function renderForm(res, opts) {
  res.render(opts.view, {
    title: opts.title,
    action: opts.action,
    categories: CATEGORIES,
    locations: opts.locations,
    values: opts.values || {},
    errors: opts.errors || [],
  });
}

// ---- routes -------------------------------------------------------------
router.get('/', (req, res) => {
  res.render('home', { title: 'Campus Lost & Found' });
});

router.get('/how-it-works', (req, res) => {
  res.render('how_it_works', { title: 'How It Works' });
});

// ---------- LOST ----------
router.get('/lost', async (req, res, next) => {
  try {
    renderForm(res, {
      view: 'form_lost', title: 'I Lost Something', action: '/lost',
      locations: await allLocations(), values: {},
    });
  } catch (e) { next(e); }
});

router.post('/lost', upload.single('photo'), async (req, res, next) => {
  try {
    const { errs, person, item } = validateForm(req.body);
    if (errs.length) {
      return renderForm(res, {
        view: 'form_lost', title: 'I Lost Something', action: '/lost',
        locations: await allLocations(), values: req.body, errors: errs,
      });
    }
    const threshold = await getMatchThreshold();
    let lostId;
    await withTransaction(async (conn) => {
      const userId = await getOrCreateUser(conn, person);
      const locationId = await resolveLocationId(conn, req.body.location_name);
      const photo = req.file ? `uploads/${req.file.filename}` : null;
      const itemRes = await conn.query(
        `INSERT INTO items (item_name, category, description, color, brand, photo)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [item.item_name, item.category, item.description, item.color, item.brand, photo]
      );
      const reportRes = await conn.query(
        `INSERT INTO lost_reports (user_id, item_id, location_id, lost_date, lost_time, status)
         VALUES (?, ?, ?, ?, ?, 'OPEN')`,
        [userId, itemRes[0].insertId, locationId, req.body.report_date, req.body.report_time || null]
      );
      lostId = reportRes[0].insertId;
      await conn.query('CALL SP_REFRESH_MATCHES()');
    });
    // preview AFTER commit: previewForLost uses a different pooled connection,
    // which cannot see the uncommitted report from inside the transaction
    const preview = await previewForLost(lostId, threshold);
    res.render('success', {
      title: 'Report submitted',
      heading: 'Your lost-item report has been submitted successfully.',
      matches: preview,
      matchLabel: 'Possible found-item matches for your report (checked by the admin):',
      againHref: '/lost',
    });
  } catch (e) { next(e); }
});

// ---------- FOUND ----------
router.get('/found', async (req, res, next) => {
  try {
    renderForm(res, {
      view: 'form_found', title: 'I Found Something', action: '/found',
      locations: await allLocations(), values: {},
    });
  } catch (e) { next(e); }
});

router.post('/found', upload.single('photo'), async (req, res, next) => {
  try {
    const { errs, person, item } = validateForm(req.body);
    const source = req.body.source === 'BOX' ? 'BOX' : 'USER';
    if (errs.length) {
      return renderForm(res, {
        view: 'form_found', title: 'I Found Something', action: '/found',
        locations: await allLocations(), values: req.body, errors: errs,
      });
    }
    const threshold = await getMatchThreshold();
    let foundId;
    await withTransaction(async (conn) => {
      const userId = await getOrCreateUser(conn, person);
      const locationId = await resolveLocationId(conn, req.body.location_name);
      const photo = req.file ? `uploads/${req.file.filename}` : null;
      const itemRes = await conn.query(
        `INSERT INTO items (item_name, category, description, color, brand, photo)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [item.item_name, item.category, item.description, item.color, item.brand, photo]
      );
      const reportRes = await conn.query(
        `INSERT INTO found_reports
           (user_id, item_id, location_id, found_date, found_time, source, status)
         VALUES (?, ?, ?, ?, ?, ?, 'UNCLAIMED')`,
        [userId, itemRes[0].insertId, locationId,
         req.body.report_date, req.body.report_time || null, source]
      );
      foundId = reportRes[0].insertId;
      await conn.query('CALL SP_REFRESH_MATCHES()');
    });
    // preview AFTER commit (see comment in the lost handler above)
    const preview = await previewForFound(foundId, threshold);
    res.render('success', {
      title: 'Report submitted',
      heading:
        source === 'BOX'
          ? 'Thank you for handing the item to the Lost & Found Box. Your found-item report has been submitted successfully.'
          : 'Your found-item report has been submitted successfully.',
      matches: preview,
      matchLabel: 'Possible owners already looking for this item (checked by the admin):',
      againHref: '/found',
    });
  } catch (e) { next(e); }
});

module.exports = router;
