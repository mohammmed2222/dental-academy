function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  req.session.flash = { type: 'error', message: 'الرجاء تسجيل الدخول أولاً' };
  res.redirect('/auth/login');
}

function isInstructor(req, res, next) {
  if (req.session && req.session.userId && (req.session.role === 'instructor' || req.session.role === 'admin')) {
    return next();
  }
  req.session.flash = { type: 'error', message: 'غير مصرح بالوصول. هذه الصفحة للمدرسين فقط' };
  res.redirect('/dashboard');
}

function isAdmin(req, res, next) {
  if (req.session && req.session.userId && req.session.role === 'admin') {
    return next();
  }
  req.session.flash = { type: 'error', message: 'غير مصرح بالوصول. هذه الصفحة للمشرفين فقط' };
  res.redirect('/dashboard');
}

async function setUser(req, res, next) {
  res.locals.user = null;
  if (req.session && req.session.userId) {
    // Revalidate session from DB every 5 minutes
    var now = Date.now();
    if (!req.session._lastRevalidated || now - req.session._lastRevalidated > 300000) {
      try {
        var db = require('../config/database').getDb();
        var user = await db.prepare('SELECT id, name, email, role, avatar FROM users WHERE id = ?').get(req.session.userId);
        if (user) {
          req.session.role = user.role;
          req.session.userName = user.name;
          req.session.userEmail = user.email;
          req.session.userAvatar = user.avatar || '/images/default-avatar.png';
        } else {
          // User was deleted - destroy session
          return req.session.destroy(function() { res.redirect('/auth/login'); });
        }
      } catch (e) {}
      req.session._lastRevalidated = now;
    }
    res.locals.user = {
      id: req.session.userId,
      name: req.session.userName,
      email: req.session.userEmail,
      role: req.session.role,
      avatar: req.session.userAvatar
    };
  }
  res.locals.darkMode = req.session.darkMode || 0;
  res.locals.flash = req.session.flash || null;
  req.session.flash = null;
  next();
}

module.exports = { isAuthenticated, isInstructor, isAdmin, setUser };
