const express = require('express');
const { getDb } = require('../config/database');
const { isInstructor } = require('../middleware/auth');

const router = express.Router();

router.post('/create/:courseId', isInstructor, (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE id = ? AND instructor_id = ?')
    .get(parseInt(req.params.courseId), req.session.userId);
  if (!course) return res.redirect('/courses/my-courses');

  var maxOrder = db.prepare('SELECT COALESCE(MAX(order_index), 0) as max FROM course_sections WHERE course_id = ?')
    .get(course.id).max;

  db.prepare('INSERT INTO course_sections (course_id, title, order_index) VALUES (?, ?, ?)')
    .run(course.id, req.body.title || 'قسم جديد', maxOrder + 1);

  res.redirect('/courses/' + course.slug + '/edit');
});

router.post('/:id/rename', isInstructor, (req, res) => {
  const db = getDb();
  var section = db.prepare(`
    SELECT s.*, c.instructor_id, c.slug FROM course_sections s
    JOIN courses c ON s.course_id = c.id WHERE s.id = ?
  `).get(parseInt(req.params.id));
  if (!section || section.instructor_id !== req.session.userId) return res.redirect('/courses/my-courses');

  db.prepare('UPDATE course_sections SET title = ? WHERE id = ?')
    .run(req.body.title || 'قسم جديد', section.id);

  res.redirect('/courses/' + section.slug + '/edit');
});

router.post('/:id/delete', isInstructor, (req, res) => {
  const db = getDb();
  var section = db.prepare(`
    SELECT s.*, c.instructor_id, c.slug FROM course_sections s
    JOIN courses c ON s.course_id = c.id WHERE s.id = ?
  `).get(parseInt(req.params.id));
  if (!section || section.instructor_id !== req.session.userId) return res.redirect('/courses/my-courses');

  db.prepare('UPDATE lessons SET section_id = NULL WHERE section_id = ?').run(section.id);
  db.prepare('DELETE FROM course_sections WHERE id = ?').run(section.id);

  res.redirect('/courses/' + section.slug + '/edit');
});

router.post('/reorder/:courseId', isInstructor, (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE id = ? AND instructor_id = ?')
    .get(parseInt(req.params.courseId), req.session.userId);
  if (!course) return res.status(403).json({ error: 'غير مصرح' });

  var order = req.body.order;
  if (Array.isArray(order)) {
    order.forEach(function(id, index) {
      db.prepare('UPDATE course_sections SET order_index = ? WHERE id = ? AND course_id = ?')
        .run(index + 1, parseInt(id), course.id);
    });
  }

  res.json({ success: true });
});

module.exports = router;
