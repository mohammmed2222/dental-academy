var crypto = require('crypto');

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str || '');
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function generateCsrfToken(session) {
  if (!session.csrfToken) {
    session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return session.csrfToken;
}

function csrfProtection(req, res, next) {
  var skipPaths = ['/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password'];
  if (skipPaths.indexOf(req.path) !== -1) return next();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].indexOf(req.method) !== -1) {
    var token = req.body._csrf || req.query._csrf || req.headers['x-csrf-token'];
    if (token && req.session.csrfToken && token !== req.session.csrfToken) {
      if (req.xhr || (req.headers['content-type'] || '').indexOf('json') !== -1) {
        return res.status(403).json({ error: 'رمز CSRF غير صالح' });
      }
      return res.status(403).render('error', { title: 'خطأ', message: 'رمز CSRF غير صالح، حاول تحديث الصفحة', error: null });
    }
  }
  next();
}

module.exports = { escapeHtml, generateCsrfToken, csrfProtection };