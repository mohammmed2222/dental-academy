const express = require('express');
const { getDb, sqlNow, isUsingPg } = require('../config/database');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function enrollSql() {
  return isUsingPg() ? 'INSERT INTO enrollments (user_id, course_id) VALUES (?, ?) ON CONFLICT DO NOTHING' : 'INSERT OR IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)';
}
const router = express.Router();
const multer = require('multer');

const uploadReceipt = multer({
  storage: multer.diskStorage({
    destination: function(req, file, cb) { cb(null, path.join(__dirname, '..', 'public', 'uploads', 'payments')); },
    filename: function(req, file, cb) {
      const safeExt = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
      cb(null, crypto.randomBytes(16).toString('hex') + safeExt);
    }
  }),
  fileFilter: function(req, file, cb) {
    if (file.mimetype.startsWith('image/')) { cb(null, true); } else { cb(new Error('فقط الصور مسموحة'), false); }
  }
});

function getStripe() {
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return null;
    return require('stripe')(key);
  } catch(e) { return null; }
}

router.get('/checkout/:courseId', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const course = await db.prepare('SELECT * FROM courses WHERE id = ?').get(parseInt(req.params.courseId));
    if (!course || course.price <= 0) return res.redirect('/courses');
    const existing = await db.prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.session.userId, course.id);
    if (existing) return res.redirect('/courses/' + course.slug);
    return res.render('payments/checkout', { title: 'إتمام الدفع', course, error: null, success: null });
  } catch(err) { next(err); }
});

router.post('/request/:courseId', isAuthenticated, uploadReceipt.single('receipt_image'), async (req, res, next) => {
  try {
    const db = getDb();
    const course = await db.prepare('SELECT * FROM courses WHERE id = ?').get(parseInt(req.params.courseId));
    if (!course || course.price <= 0) return res.redirect('/courses');

    const existing = await db.prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.session.userId, course.id);
    if (existing) {
      req.session.flash = { type: 'error', message: 'أنت مسجل بالفعل في هذا الكورس' };
      return res.redirect('/courses/' + course.slug);
    }

    const pendingPayment = await db.prepare("SELECT id FROM payments WHERE user_id = ? AND course_id = ? AND status = 'pending'").get(req.session.userId, course.id);
    if (pendingPayment) {
      req.session.flash = { type: 'error', message: 'لديك طلب دفع قيد المراجعة بالفعل' };
      return res.redirect('/courses/' + course.slug);
    }

    let finalAmount = course.price;
    let couponId = null;
    let discountAmount = 0;

    const couponCode = req.body.coupon_code ? req.body.coupon_code.trim().toUpperCase() : '';
    if (couponCode) {
      const coupon = await db.prepare('SELECT * FROM coupons WHERE code = ?').get(couponCode);
      if (!coupon) {
        req.session.flash = { type: 'error', message: 'كود الخصم غير صالح' };
        return res.redirect('/payments/checkout/' + course.id);
      }
      const now = new Date();
      if (coupon.expires_at && new Date(coupon.expires_at) < now) {
        req.session.flash = { type: 'error', message: 'كود الخصم منتهي الصلاحية' };
        return res.redirect('/payments/checkout/' + course.id);
      }
      if (coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses) {
        req.session.flash = { type: 'error', message: 'تم استنفاذ عدد مرات استخدام كود الخصم' };
        return res.redirect('/payments/checkout/' + course.id);
      }
      if (coupon.course_id && coupon.course_id !== course.id) {
        req.session.flash = { type: 'error', message: 'كود الخصم غير صالح لهذا المساق' };
        return res.redirect('/payments/checkout/' + course.id);
      }
      discountAmount = Math.round(course.price * coupon.discount_percent / 100);
      finalAmount = course.price - discountAmount;
      couponId = coupon.id;
      // لا نحتسب الكوبون هنا — يُحتسب فقط بعد تأكيد الدفع
    }

    var method = String(req.body.method || 'cash');
    var receiptPath = '';

    if (method === 'stripe') {
      const stripe = getStripe();
      if (!stripe) {
        req.session.flash = { type: 'error', message: 'الدفع الإلكتروني غير متاح حالياً' };
        return res.redirect('/payments/checkout/' + course.id);
      }
      const payment = await db.prepare('INSERT INTO payments (user_id, course_id, amount, method, status, coupon_id, discount_amount) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(req.session.userId, course.id, finalAmount, 'stripe', 'pending', couponId, discountAmount);
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{ price_data: { currency: process.env.STRIPE_CURRENCY || 'sar', product_data: { name: course.title }, unit_amount: Math.round(finalAmount * 100) }, quantity: 1 }],
        mode: 'payment',
        success_url: req.protocol + '://' + req.get('host') + '/payments/success/' + payment.lastInsertRowid,
        cancel_url: req.protocol + '://' + req.get('host') + '/payments/checkout/' + course.id,
        metadata: { paymentId: String(payment.lastInsertRowid), userId: String(req.session.userId), courseId: String(course.id) }
      });
      await db.prepare('UPDATE payments SET stripe_session_id = ? WHERE id = ?').run(session.id, payment.lastInsertRowid);
      return res.redirect(session.url);
    }

    if (method === 'bank') {
      receiptPath = req.file ? '/uploads/payments/' + req.file.filename : '';
    }

    await db.prepare('INSERT INTO payments (user_id, course_id, amount, method, status, receipt_image, coupon_id, discount_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.session.userId, course.id, finalAmount, method, method === 'bank' ? 'pending' : 'pending', receiptPath, couponId, discountAmount);

    if (method === 'cash') {
      req.session.flash = { type: 'success', message: 'تم إرسال طلب الدفع نقداً. سيتم التواصل معك لتأكيد الدفع.' };
    } else {
      req.session.flash = { type: 'success', message: 'تم إرسال إيصال التحويل. سيقوم الإدارة بمراجعته قريباً.' };
    }
    return res.redirect('/courses/' + course.slug);
  } catch(err) { next(err); }
});

router.get('/success/:id', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const payment = await db.prepare('SELECT * FROM payments WHERE id = ? AND user_id = ?').get(parseInt(req.params.id), req.session.userId);
    if (!payment) return res.redirect('/courses');

    if (payment.status === 'pending' && payment.method === 'stripe') {
      const stripe = getStripe();
      if (stripe && payment.stripe_session_id) {
        const stripeSession = await stripe.checkout.sessions.retrieve(payment.stripe_session_id);
        if (stripeSession.payment_status === 'paid') {
          await db.prepare(`UPDATE payments SET status = 'paid', paid_at = ${sqlNow()} WHERE id = ?`).run(payment.id);
      await db.prepare(enrollSql()).run(payment.user_id, payment.course_id);
          const { createNotification } = require('../config/notifications');
          const course = await db.prepare('SELECT title FROM courses WHERE id = ?').get(payment.course_id);
          await createNotification(payment.user_id, 'payment', 'تم تأكيد الدفع', 'تم تأكيد دفعك الإلكتروني لمادة ' + (course ? course.title : '') + ' بنجاح');
        }
      }
    }

    return res.render('payments/success', { title: 'تم الدفع', payment });
  } catch(err) { next(err); }
});

router.get('/admin', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;
    const total = Number((await db.prepare('SELECT COUNT(*) as count FROM payments').get()).count);
    const totalPages = Math.ceil(total / limit);
    const payments = await db.prepare(`
      SELECT p.*, u.name as user_name, c.title as course_title, c.slug as course_slug
      FROM payments p
      JOIN users u ON p.user_id = u.id
      JOIN courses c ON p.course_id = c.id
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
    return res.render('payments/admin', { title: 'إدارة المدفوعات', payments, page, totalPages });
  } catch(err) { next(err); }
});

router.post('/admin/:id/confirm', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const payment = await db.prepare('SELECT * FROM payments WHERE id = ?').get(parseInt(req.params.id));
    if (payment && payment.status === 'pending') {
      await db.prepare(`UPDATE payments SET status = 'paid', paid_at = ${sqlNow()} WHERE id = ?`).run(payment.id);
      // احتساب الكوبون عند تأكيد الدفع فعلياً
      if (payment.coupon_id) {
        await db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(payment.coupon_id);
      }
      const existing = await db.prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?').get(payment.user_id, payment.course_id);
      if (!existing) await db.prepare(enrollSql()).run(payment.user_id, payment.course_id);
      const { createNotification } = require('../config/notifications');
      const course = await db.prepare('SELECT title FROM courses WHERE id = ?').get(payment.course_id);
      await createNotification(payment.user_id, 'payment', 'تم تأكيد الدفع', 'تم تأكيد دفعة مادة ' + (course ? course.title : '') + ' بنجاح');
      req.session.flash = { type: 'success', message: 'تم تأكيد الدفع' };
    }
    return res.redirect('/payments/admin');
  } catch(err) { next(err); }
});

router.post('/admin/:id/reject', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare("UPDATE payments SET status = 'rejected' WHERE id = ?").run(parseInt(req.params.id));
    if (req.body.reason) {
      const payment = await db.prepare('SELECT * FROM payments WHERE id = ?').get(parseInt(req.params.id));
      if (payment) {
        const { createNotification } = require('../config/notifications');
        const course = await db.prepare('SELECT title FROM courses WHERE id = ?').get(payment.course_id);
        await createNotification(payment.user_id, 'payment', 'تم رفض الدفع', 'تم رفض دفعة مادة ' + (course ? course.title : '') + ': ' + req.body.reason);
      }
    }
    req.session.flash = { type: 'error', message: 'تم رفض الدفع' };
    return res.redirect('/payments/admin');
  } catch(err) { next(err); }
});

module.exports = router;
