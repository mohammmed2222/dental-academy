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
  var ctype = req.headers['content-type'] || '';
  if (['POST', 'PUT', 'PATCH', 'DELETE'].indexOf(req.method) !== -1) {
    var token = String(req.body && req.body._csrf || req.headers['x-csrf-token'] || '');
    if (!token || !req.session.csrfToken || token.length !== req.session.csrfToken.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(req.session.csrfToken))) {
      if (req.xhr || ctype.indexOf('json') !== -1) {
        return res.status(403).json({ error: 'رمز CSRF غير صالح' });
      }
      return res.status(403).render('error', { title: 'خطأ', message: 'رمز CSRF غير صالح، حاول تحديث الصفحة', error: null });
    }
  }
  next();
}

function toSafeInt(val, defaultVal) {
  var n = parseInt(val);
  if (isNaN(n) || n < 0 || !isFinite(n)) {
    return arguments.length >= 2 ? defaultVal : 0;
  }
  return n;
}

module.exports = { escapeHtml, generateCsrfToken, csrfProtection, toSafeInt };