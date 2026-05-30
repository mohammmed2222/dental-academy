const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { getDb, sqlNow } = require('../config/database');
const { sendMail } = require('../config/mail');
const { createNotification } = require('../config/notifications');
const { isAuthenticated } = require('../middleware/auth');

const router = express.Router();

var loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, handler: function(req, res) { res.status(429).render('auth/login', { title: 'تسجيل الدخول', error: 'محاولات كثيرة جداً، حاول بعد 15 دقيقة', success: null }); } });
var registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, handler: function(req, res) { res.status(429).render('auth/register', { title: 'إنشاء حساب جديد', error: 'محاولات تسجيل كثيرة جداً، حاول بعد ساعة', success: null }); } });
var forgotLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 3, handler: function(req, res) { res.status(429).render('auth/forgot-password', { title: 'نسيت كلمة المرور', error: 'طلبات كثيرة جداً، حاول بعد ساعة', success: null }); } });

router.get('/login', async (req, res, next) => {
  try {
    if (req.session.userId) return res.redirect('/dashboard');
    return res.render('auth/login', { title: 'تسجيل الدخول', error: null, success: null });
  } catch(err) { next(err); }
});

router.get('/register', async (req, res, next) => {
  try {
    if (req.session.userId) return res.redirect('/dashboard');
    return res.render('auth/register', { title: 'إنشاء حساب جديد', error: null, success: null });
  } catch(err) { next(err); }
});

router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const db = getDb();
    const { email, password, confirmPassword, role, phone } = req.body;
    var name = String(req.body.name || '').trim();
    var mail = String(email || '').trim();

    if (!name || !mail || !password) {
      return res.render('auth/register', { title: 'إنشاء حساب جديد', error: 'جميع الحقول مطلوبة', success: null });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      return res.render('auth/register', { title: 'إنشاء حساب جديد', error: 'البريد الإلكتروني غير صالح', success: null });
    }

    if (password.length < 12) {
      return res.render('auth/register', { title: 'إنشاء حساب جديد', error: 'كلمة المرور يجب أن تكون 12 حرفاً على الأقل', success: null });
    }

    if (password !== confirmPassword) {
      return res.render('auth/register', { title: 'إنشاء حساب جديد', error: 'كلمة المرور غير متطابقة', success: null });
    }

    const existingUser = await db.prepare('SELECT id FROM users WHERE email = ?').get(mail);
    if (existingUser) {
      return res.render('auth/register', { title: 'إنشاء حساب جديد', error: 'البريد الإلكتروني مستخدم بالفعل', success: null });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userRole = 'student';
    const verificationToken = crypto.randomBytes(32).toString('hex');

    const result = await db.prepare('INSERT INTO users (name, email, password, role, email_verified, phone) VALUES (?, ?, ?, ?, ?, ?)').run(
      name, mail, hashedPassword, userRole, 1, (phone || '').replace(/[^0-9+]/g, '')
    );

    var newUserId = result.lastInsertRowid;
    req.session.regenerate(function(err) {
      if (err) return next(err);
      req.session.userId = newUserId;
      req.session.userName = name;
      req.session.userEmail = mail;
      req.session.role = userRole;
      req.session.userAvatar = '/images/default-avatar.png';
      req.session.emailVerified = true;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');

      createNotification(newUserId, 'info', 'مرحباً بك في أكاديمية طب الأسنان!', 'نتمنى لك رحلة تعليمية موفقة').catch(function() {});

      return res.redirect('/dashboard');
    });
  } catch(err) { next(err); }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const db = getDb();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.render('auth/login', { title: 'تسجيل الدخول', error: 'البريد الإلكتروني وكلمة المرور مطلوبان', success: null });
    }

    const user = await db.prepare('SELECT id, name, email, password, role, avatar, email_verified, dark_mode FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.render('auth/login', { title: 'تسجيل الدخول', error: 'بريد إلكتروني أو كلمة مرور غير صحيحة', success: null });
    }

    if (!(await bcrypt.compare(password, user.password))) {
      return res.render('auth/login', { title: 'تسجيل الدخول', error: 'بريد إلكتروني أو كلمة مرور غير صحيحة', success: null });
    }

    if (user.role !== 'admin' && !user.email_verified) {
      return res.render('auth/login', { title: 'تسجيل الدخول', error: 'يرجى تأكيد بريدك الإلكتروني أولاً. تحقق من بريدك الوارد.', success: null });
    }

    req.session.regenerate(function(err) {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.userName = user.name;
      req.session.userEmail = user.email;
      req.session.role = user.role;
      req.session.userAvatar = user.avatar;
      req.session.emailVerified = user.email_verified ? true : false;
      req.session.darkMode = user.dark_mode || 0;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');

      return res.redirect('/dashboard');
    });
  } catch(err) { next(err); }
});

router.get('/forgot-password', async (req, res, next) => {
  try {
    return res.render('auth/forgot-password', { title: 'نسيت كلمة المرور', error: null, success: null });
  } catch(err) { next(err); }
});

router.post('/forgot-password', forgotLimiter, async (req, res, next) => {
  try {
    const db = getDb();
    const { email } = req.body;
    if (!email) {
      return res.render('auth/forgot-password', { title: 'نسيت كلمة المرور', error: 'يرجى إدخال البريد الإلكتروني', success: null });
    }
    const user = await db.prepare('SELECT id, name FROM users WHERE email = ?').get(email);
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      await db.prepare('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expiresAt);

      var appUrl = process.env.APP_URL || 'https://dental-academy-production.up.railway.app';
      if (appUrl.endsWith('/')) appUrl = appUrl.slice(0, -1);
      const resetLink = appUrl + '/auth/reset-password/' + token;

      try {
        await sendMail({
          to: email,
          subject: 'إعادة تعيين كلمة المرور - أكاديمية طب الأسنان',
          html: '<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><h1 style="color:#a30019">أكاديمية طب الأسنان</h1><p>مرحباً ' + (user.name || '').replace(/[&<>"']/g, function(m) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]; }) + '،</p><p>لقد تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بك.</p><p><a href="' + resetLink + '" style="display:inline-block;background:#ce1126;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">إعادة تعيين كلمة المرور</a></p><p>رابط إعادة التعيين صالح لمدة ساعة واحدة.</p><p>إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذا البريد.</p><hr/><p style="color:#777;font-size:12px">أكاديمية طب الأسنان</p></div>',
        });
      } catch (e) {
        console.error('Mail error:', e);
      }
    }

    return res.render('auth/forgot-password', { title: 'نسيت كلمة المرور', success: 'إذا كان البريد مسجلاً لدينا، ستتلقى رابط إعادة تعيين كلمة المرور', error: null });
  } catch(err) { next(err); }
});

router.get('/reset-password/:token', async (req, res, next) => {
  try {
    const db = getDb();
    const row = await db.prepare(`SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > ${sqlNow()}`).get(req.params.token);
    if (!row) {
      return res.render('auth/forgot-password', { title: 'نسيت كلمة المرور', error: 'رابط إعادة التعيين غير صالح أو منتهي الصلاحية', success: null });
    }
    return res.render('auth/reset-password', { title: 'إعادة تعيين كلمة المرور', token: req.params.token, error: null });
  } catch(err) { next(err); }
});

router.post('/reset-password/:token', async (req, res, next) => {
  try {
    const db = getDb();
    const row = await db.prepare(`SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > ${sqlNow()}`).get(req.params.token);
    if (!row) {
      return res.render('auth/forgot-password', { title: 'نسيت كلمة المرور', error: 'رابط إعادة التعيين غير صالح أو منتهي الصلاحية', success: null });
    }

    const { password, confirmPassword } = req.body;
    if (!password || password.length < 12) {
      return res.render('auth/reset-password', { title: 'إعادة تعيين كلمة المرور', token: req.params.token, error: 'كلمة المرور يجب أن تكون 12 حرفاً على الأقل' });
    }
    if (password !== confirmPassword) {
      return res.render('auth/reset-password', { title: 'إعادة تعيين كلمة المرور', token: req.params.token, error: 'كلمة المرور غير متطابقة' });
    }

    const hashed = await bcrypt.hash(password, 10);
    await db.prepare(`UPDATE users SET password = ?, updated_at = ${sqlNow()} WHERE id = ?`).run(hashed, row.user_id);
    await db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?').run(row.id);

    return res.render('auth/login', { title: 'تسجيل الدخول', error: null, success: 'تم إعادة تعيين كلمة المرور بنجاح. سجل الدخول الآن.' });
  } catch(err) { next(err); }
});

router.get('/verify-email', async (req, res, next) => {
  try {
    const db = getDb();
    var token = req.query.token || '';
    if (token) {
      var user = await db.prepare('SELECT id FROM users WHERE verification_token = ? AND email_verified = 0').get(token);
      if (user) {
        await db.prepare(`UPDATE users SET email_verified = 1, verification_token = NULL, updated_at = ${sqlNow()} WHERE id = ?`).run(user.id);
        if (req.session.userId === user.id) {
          req.session.emailVerified = true;
        }
        return res.render('auth/verify-email', { title: 'تأكيد البريد الإلكتروني', success: 'تم تأكيد بريدك الإلكتروني بنجاح!', error: null, email: '' });
      }
      return res.render('auth/verify-email', { title: 'تأكيد البريد الإلكتروني', error: 'رابط التأكيد غير صالح أو منتهي الصلاحية', success: null, email: '' });
    }
    return res.render('auth/verify-email', { title: 'تأكيد البريد الإلكتروني', error: null, success: null, email: req.query.email || '' });
  } catch(err) { next(err); }
});

router.get('/logout', async (req, res, next) => {
  try {
    req.session.destroy(function(err) {
      if (err) { return next(err); }
      res.clearCookie('dental_sid');
      res.redirect('/');
    });
  } catch(err) { next(err); }
});

module.exports = router;
