const express = require('express');
const { getDb } = require('../config/database');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

const router = express.Router();

// Request payment (student initiates payment for a paid course)
router.post('/request/:courseId', isAuthenticated, (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(parseInt(req.params.courseId));
  if (!course || course.price <= 0) return res.redirect('/courses');

  const existing = db.prepare('SELECT id FROM payments WHERE user_id = ? AND course_id = ? AND status = \'pending\'').get(req.session.userId, course.id);
  if (existing) {
    req.session.flash = { type: 'error', message: 'لديك طلب دفع قيد المراجعة بالفعل' };
    return res.redirect('/courses/' + course.slug);
  }

  let finalAmount = course.price;
  let couponId = null;
  let discountAmount = 0;

  const couponCode = req.body.coupon_code ? req.body.coupon_code.trim().toUpperCase() : '';
  if (couponCode) {
    const coupon = db.prepare('SELECT * FROM coupons WHERE code = ?').get(couponCode);
    if (coupon) {
      const now = new Date();
      const expired = coupon.expires_at && new Date(coupon.expires_at) < now;
      const maxedOut = coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses;
      const courseMismatch = coupon.course_id && coupon.course_id !== course.id;

      if (expired) {
        req.session.flash = { type: 'error', message: 'كود الخصم منتهي الصلاحية' };
        return res.redirect('/courses/' + course.slug);
      }
      if (maxedOut) {
        req.session.flash = { type: 'error', message: 'تم استنفاذ عدد مرات استخدام كود الخصم' };
        return res.redirect('/courses/' + course.slug);
      }
      if (courseMismatch) {
        req.session.flash = { type: 'error', message: 'كود الخصم غير صالح لهذا المساق' };
        return res.redirect('/courses/' + course.slug);
      }

      discountAmount = Math.round(course.price * coupon.discount_percent / 100);
      finalAmount = course.price - discountAmount;
      couponId = coupon.id;

      db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(coupon.id);
    } else {
      req.session.flash = { type: 'error', message: 'كود الخصم غير صالح' };
      return res.redirect('/courses/' + course.slug);
    }
  }

  const allowedMethods = ['cash', 'bank'];
  var method = allowedMethods.indexOf(req.body.method) !== -1 ? req.body.method : 'cash';
  db.prepare('INSERT INTO payments (user_id, course_id, amount, method, status, coupon_id, discount_amount) VALUES (?, ?, ?, ?, \'pending\', ?, ?)')
    .run(req.session.userId, course.id, finalAmount, method, couponId, discountAmount);

  req.session.flash = { type: 'success', message: 'تم إرسال طلب الدفع. سيقوم الإدارة بمراجعته قريباً.' };
  res.redirect('/courses/' + course.slug);
});

// Admin: list all payments
router.get('/admin', isAdmin, (req, res) => {
  const db = getDb();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 20;
  const offset = (page - 1) * limit;
  const total = db.prepare('SELECT COUNT(*) as count FROM payments').get().count;
  const totalPages = Math.ceil(total / limit);
  const payments = db.prepare(`
    SELECT p.*, u.name as user_name, c.title as course_title, c.slug as course_slug
    FROM payments p
    JOIN users u ON p.user_id = u.id
    JOIN courses c ON p.course_id = c.id
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
  res.render('payments/admin', { title: 'إدارة المدفوعات', payments, page, totalPages });
});

// Admin: confirm payment
router.post('/admin/:id/confirm', isAdmin, (req, res) => {
  const db = getDb();
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(parseInt(req.params.id));
  if (payment && payment.status === 'pending') {
    db.prepare("UPDATE payments SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE id = ?").run(payment.id);
    // Enable enrollment
    const existing = db.prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?').get(payment.user_id, payment.course_id);
    if (!existing) {
      db.prepare('INSERT INTO enrollments (user_id, course_id) VALUES (?, ?)').run(payment.user_id, payment.course_id);
    }
    // Notify user
    const { createNotification } = require('../config/notifications');
    const course = db.prepare('SELECT title FROM courses WHERE id = ?').get(payment.course_id);
    createNotification(payment.user_id, 'payment', 'تم تأكيد الدفع', 'تم تأكيد دفعة مادة ' + (course ? course.title : '') + ' بنجاح. تم تفعيل التسجيل.');
    req.session.flash = { type: 'success', message: 'تم تأكيد الدفع' };
  }
  res.redirect('/payments/admin');
});

// Admin: reject payment
router.post('/admin/:id/reject', isAdmin, (req, res) => {
  const db = getDb();
  db.prepare("UPDATE payments SET status = 'rejected' WHERE id = ?").run(parseInt(req.params.id));
  req.session.flash = { type: 'error', message: 'تم رفض الدفع' };
  res.redirect('/payments/admin');
});

module.exports = router;
