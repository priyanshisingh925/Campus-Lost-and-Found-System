// Campus Lost & Found — application entry point.
require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
// uploaded photos live in /uploads at the project root
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
}));

// shared view locals: current path (nav highlighting), admin flag, one-shot notice
app.use((req, res, next) => {
  res.locals.path = req.originalUrl.split('?')[0];
  res.locals.isAdmin = !!(req.session && req.session.adminId);
  res.locals.notice = req.session.notice || null;
  delete req.session.notice;
  next();
});

app.use('/', publicRoutes);
app.use('/admin', adminRoutes);

// 404
app.use((req, res) => res.status(404).send('Page not found. <a href="/">Back to home</a>'));

// error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const msg =
    err.code === 'ER_ACCESS_DENIED_ERROR' ? 'MySQL access denied — check DB_USER/DB_PASS in .env' :
    err.code === 'ECONNREFUSED' ? 'Cannot connect to MySQL — is the server running?' :
    err.code === 'ER_BAD_DB_ERROR' ? 'Database missing — run: npm run setup' :
    err.code === 'ER_NO_SUCH_TABLE' ? 'Tables missing — run: npm run setup' :
    err.message === 'Only image files are allowed' ? 'Only image files are allowed for the photo.' :
    'Something went wrong. Please go back and try again.';
  res.status(err.status || 500).send(
    `<h2>Error</h2><p>${msg}</p><a href="/">Back to home</a>`
  );
});

app.listen(PORT, () => {
  console.log(`Campus Lost & Found running at http://localhost:${PORT}`);
});
