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

  const allowedMethods = ['cash', 'bank'];
  var method = allowedMethods.indexOf(req.body.method) !== -1 ? req.body.method : 'cash';
  db.prepare('INSERT INTO payments (user_id, course_id, amount, method, status) VALUES (?, ?, ?, ?, \'pending\')')
    .run(req.session.userId, course.id, course.price, method);

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
