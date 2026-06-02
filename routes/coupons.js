const express = require('express');
const { getDb } = require('../config/database');
const { isAdmin } = require('../middleware/auth');
const { toSafeInt } = require('../config/security');

const router = express.Router();

router.get('/admin', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const coupons = await db.prepare(`
      SELECT c.*, u.name as creator_name, co.title as course_title
      FROM coupons c
      LEFT JOIN users u ON c.created_by = u.id
      LEFT JOIN courses co ON c.course_id = co.id
      ORDER BY c.created_at DESC
    `).all();
    const courses = await db.prepare("SELECT id, title FROM courses WHERE status = 'published' ORDER BY title").all();
    return res.render('coupons/admin', { title: 'إدارة كوبونات الخصم', coupons, courses, error: null });
  } catch (err) {
    next(err);
  }
});

router.post('/create', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const { discount_percent, max_uses, expires_at, course_id } = req.body;
    const rawCode = (req.body.code || '').trim();
    if (!rawCode || !discount_percent) {
      const coupons = await db.prepare(`
        SELECT c.*, u.name as creator_name, co.title as course_title
        FROM coupons c
        LEFT JOIN users u ON c.created_by = u.id
        LEFT JOIN courses co ON c.course_id = co.id
        ORDER BY c.created_at DESC
      `).all();
      const courses = await db.prepare("SELECT id, title FROM courses WHERE status = 'published' ORDER BY title").all();
      return res.render('coupons/admin', { title: 'إدارة كوبونات الخصم', coupons, courses, error: 'رمز الكوبون ونسبة الخصم مطلوبان' });
    }
    const code = rawCode.toUpperCase();

    const existing = await db.prepare('SELECT id FROM coupons WHERE code = ?').get(code);
    if (existing) {
      const coupons = await db.prepare(`
        SELECT c.*, u.name as creator_name, co.title as course_title
        FROM coupons c
        LEFT JOIN users u ON c.created_by = u.id
        LEFT JOIN courses co ON c.course_id = co.id
        ORDER BY c.created_at DESC
      `).all();
      const courses = await db.prepare("SELECT id, title FROM courses WHERE status = 'published' ORDER BY title").all();
      return res.render('coupons/admin', { title: 'إدارة كوبونات الخصم', coupons, courses, error: 'رمز الكوبون موجود بالفعل' });
    }

    await db.prepare(`
      INSERT INTO coupons (code, discount_percent, max_uses, expires_at, course_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      code,
      toSafeInt(discount_percent) || 10,
      toSafeInt(max_uses) || 0,
      expires_at || null,
      toSafeInt(course_id) || null,
      req.session.userId
    );

    req.session.flash = { type: 'success', message: 'تم إنشاء الكوبون بنجاح' };
    return res.redirect('/coupons/admin');
  } catch (err) {
    next(err);
  }
});

router.post('/:id/delete', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare('DELETE FROM coupons WHERE id = ?').run(toSafeInt(req.params.id));
    req.session.flash = { type: 'success', message: 'تم حذف الكوبون' };
    return res.redirect('/coupons/admin');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
