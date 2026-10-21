// Tiny admin-session guard. Real password auth is deliberately simple (MVP).
function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) return next();
  req.session.flash = { type: 'error', text: 'Please log in as admin first.' };
  return res.redirect('/admin/login');
}

module.exports = { requireAdmin };
