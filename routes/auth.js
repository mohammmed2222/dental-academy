const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../config/database');
const { sendMail } = require('../config/mail');
const { createNotification } = require('../config/notifications');
const { isAuthenticated } = require('../middleware/auth');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('auth/login', { title: 'تسجيل الدخول', error: null, success: null });
});

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('auth/register', { title: 'إنشاء حساب جديد', error: null, success: null });
});

router.post('/register', (req, res) => {
  const db = getDb();
  const { email, password, confirmPassword, role } = req.body;
  var name = String(req.body.name || '').trim();
  var mail = String(email || '').trim();

  if (!name || !mail || !password) {
    return res.render('auth/register', { title: 'إنشاء حساب جديد', error: 'جميع الحقول مطلوبة', success: null });
  }

  if (password.length < 6) {
    return res.render('auth/register', { title: 'إنشاء حساب جديد', error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل', success: null });
  }

  if (password !== confirmPassword) {
    return res.render('auth/register', { title: 'إنشاء حساب جديد', error: 'كلمة المرور غير متطابقة', success: null });
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(mail);
  if (existingUser) {
    return res.render('auth/register', { title: 'إنشاء حساب جديد', error: 'البريد الإلكتروني مستخدم بالفعل', success: null });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const userRole = role === 'instructor' ? 'instructor' : 'student';

  const result = db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run(
    name, mail, hashedPassword, userRole
  );

  req.session.userId = result.lastInsertRowid;
  req.session.userName = name;
  req.session.userEmail = email;
  req.session.role = userRole;
  req.session.userAvatar = '/images/default-avatar.png';

  createNotification(result.lastInsertRowid, 'info', 'مرحباً بك في أكاديمية طب الأسنان!', 'نتمنى لك رحلة تعليمية موفقة');

  res.redirect('/dashboard');
});

router.post('/login', (req, res) => {
  const db = getDb();
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('auth/login', { title: 'تسجيل الدخول', error: 'البريد الإلكتروني وكلمة المرور مطلوبان', success: null });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    return res.render('auth/login', { title: 'تسجيل الدخول', error: 'بريد إلكتروني أو كلمة مرور غير صحيحة', success: null });
  }

  if (!bcrypt.compareSync(password, user.password)) {
    return res.render('auth/login', { title: 'تسجيل الدخول', error: 'بريد إلكتروني أو كلمة مرور غير صحيحة', success: null });
  }

  req.session.userId = user.id;
  req.session.userName = user.name;
  req.session.userEmail = user.email;
  req.session.role = user.role;
  req.session.userAvatar = user.avatar;

  res.redirect('/dashboard');
});

router.get('/forgot-password', (req, res) => {
  res.render('auth/forgot-password', { title: 'نسيت كلمة المرور', error: null, success: null });
});

router.post('/forgot-password', async (req, res) => {
  const db = getDb();
  const { email } = req.body;
  if (!email) {
    return res.render('auth/forgot-password', { title: 'نسيت كلمة المرور', error: 'يرجى إدخال البريد الإلكتروني', success: null });
  }
  const user = db.prepare('SELECT id, name FROM users WHERE email = ?').get(email);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    db.prepare('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expiresAt);

    const resetLink = req.protocol + '://' + req.get('host') + '/auth/reset-password/' + token;

    try {
      await sendMail({
        to: email,
        subject: 'إعادة تعيين كلمة المرور - أكاديمية طب الأسنان',
        html: '<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><h1 style="color:#a30019">أكاديمية طب الأسنان</h1><p>مرحباً ' + user.name + '،</p><p>لقد تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بك.</p><p><a href="' + resetLink + '" style="display:inline-block;background:#ce1126;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">إعادة تعيين كلمة المرور</a></p><p>رابط إعادة التعيين صالح لمدة ساعة واحدة.</p><p>إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذا البريد.</p><hr/><p style="color:#777;font-size:12px">أكاديمية طب الأسنان</p></div>',
      });
    } catch (e) {
      console.error('Mail error:', e);
    }
  }

  res.render('auth/forgot-password', { title: 'نسيت كلمة المرور', success: 'إذا كان البريد مسجلاً لدينا، ستتلقى رابط إعادة تعيين كلمة المرور', error: null });
});

router.get('/reset-password/:token', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > datetime(\'now\')').get(req.params.token);
  if (!row) {
    return res.render('auth/forgot-password', { title: 'نسيت كلمة المرور', error: 'رابط إعادة التعيين غير صالح أو منتهي الصلاحية', success: null });
  }
  res.render('auth/reset-password', { title: 'إعادة تعيين كلمة المرور', token: req.params.token, error: null });
});

router.post('/reset-password/:token', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > datetime(\'now\')').get(req.params.token);
  if (!row) {
    return res.render('auth/forgot-password', { title: 'نسيت كلمة المرور', error: 'رابط إعادة التعيين غير صالح أو منتهي الصلاحية', success: null });
  }

  const { password, confirmPassword } = req.body;
  if (!password || password.length < 6) {
    return res.render('auth/reset-password', { title: 'إعادة تعيين كلمة المرور', token: req.params.token, error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
  }
  if (password !== confirmPassword) {
    return res.render('auth/reset-password', { title: 'إعادة تعيين كلمة المرور', token: req.params.token, error: 'كلمة المرور غير متطابقة' });
  }

  const hashed = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hashed, row.user_id);
  db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ?').run(row.user_id);

  res.render('auth/login', { title: 'تسجيل الدخول', error: null, success: 'تم إعادة تعيين كلمة المرور بنجاح. سجل الدخول الآن.' });
});

router.get('/verify-email', (req, res) => {
  res.render('auth/verify-email', { title: 'تأكيد البريد الإلكتروني', email: req.query.email || '' });
});

router.get('/logout', (req, res) => {
  req.session.destroy(function() {
    res.redirect('/');
  });
});

module.exports = router;
