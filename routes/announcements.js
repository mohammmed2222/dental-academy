const express = require('express');
const { getDb } = require('../config/database');
const { isAuthenticated, isInstructor } = require('../middleware/auth');

const router = express.Router();

router.get('/course/:courseId', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const courseId = parseInt(req.params.courseId);

    const course = await db.prepare(`
      SELECT c.*, u.name as instructor_name
      FROM courses c
      JOIN users u ON c.instructor_id = u.id
      WHERE c.id = ?
    `).get(courseId);

    if (!course) {
      return res.status(404).render('error', { title: 'غير موجود', message: 'الدورة غير موجودة', error: null });
    }

    const enrollment = await db.prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.session.userId, courseId);
    const isOwner = course.instructor_id === req.session.userId;
    if (!enrollment && !isOwner && req.session.role !== 'admin') {
      return res.redirect('/courses/' + (course.slug || course.id));
    }

    const announcements = await db.prepare(`
      SELECT ca.*, u.name as instructor_name
      FROM course_announcements ca
      JOIN users u ON ca.instructor_id = u.id
      WHERE ca.course_id = ?
      ORDER BY ca.created_at DESC
    `).all(courseId);

    return res.render('announcements/list', {
      title: 'الإعلانات',
      announcements,
      course,
      isOwner: isOwner
    });
  } catch(err) { next(err); }
});

router.post('/create/:courseId', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const courseId = parseInt(req.params.courseId);

    const course = await db.prepare('SELECT * FROM courses WHERE id = ? AND instructor_id = ?').get(courseId, req.session.userId);
    if (!course) {
      return res.redirect('/courses/my-courses');
    }

    const { title, content } = req.body;
    if (!title || !content) {
      req.session.flash = { type: 'error', message: 'عنوان الإعلان والمحتوى مطلوبان' };
      return res.redirect('/announcements/course/' + courseId);
    }

    await db.prepare(`
      INSERT INTO course_announcements (course_id, instructor_id, title, content)
      VALUES (?, ?, ?, ?)
    `).run(courseId, req.session.userId, title, content);

    req.session.flash = { type: 'success', message: 'تم إنشاء الإعلان بنجاح' };
    return res.redirect('/announcements/course/' + courseId);
  } catch(err) { next(err); }
});

router.post('/:id/delete', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);

    const announcement = await db.prepare(`
      SELECT ca.*, c.instructor_id as course_instructor_id
      FROM course_announcements ca
      JOIN courses c ON ca.course_id = c.id
      WHERE ca.id = ?
    `).get(id);

    if (!announcement || announcement.course_instructor_id !== req.session.userId) {
      return res.redirect('/courses/my-courses');
    }

    await db.prepare('DELETE FROM course_announcements WHERE id = ?').run(id);
    req.session.flash = { type: 'success', message: 'تم حذف الإعلان بنجاح' };
    return res.redirect('/announcements/course/' + announcement.course_id);
  } catch(err) { next(err); }
});

module.exports = router;
