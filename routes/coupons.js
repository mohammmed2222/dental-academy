const express = require('express');
const { getDb } = require('../config/database');
const { isAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/admin', isAdmin, (req, res) => {
  const db = getDb();
  const coupons = db.prepare(`
    SELECT c.*, u.name as creator_name, co.title as course_title
    FROM coupons c
    LEFT JOIN users u ON c.created_by = u.id
    LEFT JOIN courses co ON c.course_id = co.id
    ORDER BY c.created_at DESC
  `).all();
  const courses = db.prepare("SELECT id, title FROM courses WHERE status = 'published' ORDER BY title").all();
  res.render('coupons/admin', { title: 'إدارة كوبونات الخصم', coupons, courses, error: null });
});

router.post('/create', isAdmin, (req, res) => {
  const db = getDb();
  const { code, discount_percent, max_uses, expires_at, course_id } = req.body;

  if (!code || !discount_percent) {
    const coupons = db.prepare(`
      SELECT c.*, u.name as creator_name, co.title as course_title
      FROM coupons c
      LEFT JOIN users u ON c.created_by = u.id
      LEFT JOIN courses co ON c.course_id = co.id
      ORDER BY c.created_at DESC
    `).all();
    const courses = db.prepare("SELECT id, title FROM courses WHERE status = 'published' ORDER BY title").all();
    return res.render('coupons/admin', { title: 'إدارة كوبونات الخصم', coupons, courses, error: 'رمز الكوبون ونسبة الخصم مطلوبان' });
  }

  const existing = db.prepare('SELECT id FROM coupons WHERE code = ?').get(code.trim());
  if (existing) {
    const coupons = db.prepare(`
      SELECT c.*, u.name as creator_name, co.title as course_title
      FROM coupons c
      LEFT JOIN users u ON c.created_by = u.id
      LEFT JOIN courses co ON c.course_id = co.id
      ORDER BY c.created_at DESC
    `).all();
    const courses = db.prepare("SELECT id, title FROM courses WHERE status = 'published' ORDER BY title").all();
    return res.render('coupons/admin', { title: 'إدارة كوبونات الخصم', coupons, courses, error: 'رمز الكوبون موجود بالفعل' });
  }

  db.prepare(`
    INSERT INTO coupons (code, discount_percent, max_uses, expires_at, course_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    code.trim().toUpperCase(),
    parseInt(discount_percent) || 10,
    parseInt(max_uses) || 0,
    expires_at || null,
    parseInt(course_id) || null,
    req.session.userId
  );

  req.session.flash = { type: 'success', message: 'تم إنشاء الكوبون بنجاح' };
  res.redirect('/coupons/admin');
});

router.post('/:id/delete', isAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM coupons WHERE id = ?').run(parseInt(req.params.id));
  req.session.flash = { type: 'success', message: 'تم حذف الكوبون' };
  res.redirect('/coupons/admin');
});

module.exports = router;
