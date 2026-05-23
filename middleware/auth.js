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

function setUser(req, res, next) {
  res.locals.user = null;
  if (req.session && req.session.userId) {
    res.locals.user = {
      id: req.session.userId,
      name: req.session.userName,
      email: req.session.userEmail,
      role: req.session.role,
      avatar: req.session.userAvatar
    };
  }
  res.locals.flash = req.session.flash || null;
  req.session.flash = null;
  next();
}

module.exports = { isAuthenticated, isInstructor, isAdmin, setUser };
