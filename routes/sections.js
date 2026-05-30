const express = require('express');
const { getDb } = require('../config/database');
const { isInstructor } = require('../middleware/auth');
const { toSafeInt } = require('../config/security');

const router = express.Router();

router.post('/create/:courseId', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const course = await db.prepare('SELECT * FROM courses WHERE id = ? AND instructor_id = ?')
      .get(toSafeInt(req.params.courseId), req.session.userId);
    if (!course) return res.redirect('/courses/my-courses');

    var maxOrder = await db.prepare('SELECT COALESCE(MAX(order_index), 0) as max FROM course_sections WHERE course_id = ?')
      .get(course.id);

    await db.prepare('INSERT INTO course_sections (course_id, title, order_index) VALUES (?, ?, ?)')
      .run(course.id, req.body.title || 'قسم جديد', maxOrder.max + 1);

    return res.redirect('/courses/' + course.slug + '/edit');
  } catch(err) { next(err); }
});

router.post('/:id/rename', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    var section = await db.prepare(`
      SELECT s.*, c.instructor_id, c.slug FROM course_sections s
      JOIN courses c ON s.course_id = c.id WHERE s.id = ?
    `).get(toSafeInt(req.params.id));
    if (!section || section.instructor_id !== req.session.userId) return res.redirect('/courses/my-courses');

    await db.prepare('UPDATE course_sections SET title = ? WHERE id = ?')
      .run(req.body.title || 'قسم جديد', section.id);

    return res.redirect('/courses/' + section.slug + '/edit');
  } catch(err) { next(err); }
});

router.post('/:id/delete', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    var section = await db.prepare(`
      SELECT s.*, c.instructor_id, c.slug FROM course_sections s
      JOIN courses c ON s.course_id = c.id WHERE s.id = ?
    `).get(toSafeInt(req.params.id));
    if (!section || section.instructor_id !== req.session.userId) return res.redirect('/courses/my-courses');

    await db.prepare('UPDATE lessons SET section_id = NULL WHERE section_id = ?').run(section.id);
    await db.prepare('DELETE FROM course_sections WHERE id = ?').run(section.id);

    return res.redirect('/courses/' + section.slug + '/edit');
  } catch(err) { next(err); }
});

router.post('/reorder/:courseId', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const course = await db.prepare('SELECT * FROM courses WHERE id = ? AND instructor_id = ?')
      .get(toSafeInt(req.params.courseId), req.session.userId);
    if (!course) return res.status(403).json({ error: 'غير مصرح' });

    var order = req.body.order;
    if (Array.isArray(order)) {
      for (var i = 0; i < order.length; i++) {
        await db.prepare('UPDATE course_sections SET order_index = ? WHERE id = ? AND course_id = ?')
          .run(i + 1, toSafeInt(order[i]), course.id);
      }
    }

    return res.json({ success: true });
  } catch(err) { next(err); }
});

module.exports = router;
