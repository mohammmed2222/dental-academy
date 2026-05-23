const express = require('express');
const { getDb } = require('../config/database');
const { isInstructor } = require('../middleware/auth');

const router = express.Router();

// Add prerequisite
router.post('/add/:courseId', isInstructor, (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE id = ? AND instructor_id = ?').get(parseInt(req.params.courseId), req.session.userId);
  if (!course) {
    return res.redirect('/courses/my-courses');
  }
  const { prerequisite_id } = req.body;
  if (!prerequisite_id) {
    return res.redirect('/courses/' + course.slug + '/edit');
  }
  const prereqId = parseInt(prerequisite_id);
  if (prereqId === course.id) {
    return res.redirect('/courses/' + course.slug + '/edit');
  }
  const prereqCourse = db.prepare('SELECT * FROM courses WHERE id = ? AND instructor_id = ?').get(prereqId, req.session.userId);
  if (!prereqCourse) {
    return res.redirect('/courses/' + course.slug + '/edit');
  }
  try {
    db.prepare('INSERT INTO course_prerequisites (course_id, prerequisite_course_id) VALUES (?, ?)').run(course.id, prereqId);
  } catch (e) {
    // Already exists
  }
  res.redirect('/courses/' + course.slug + '/edit');
});

// Remove prerequisite
router.post('/remove/:prereqId', isInstructor, (req, res) => {
  const db = getDb();
  const prereqId = parseInt(req.params.prereqId);
  const coursePrereq = db.prepare(`
    SELECT cp.*, c.title as course_title, c.slug as course_slug, c.instructor_id
    FROM course_prerequisites cp
    JOIN courses c ON cp.course_id = c.id
    WHERE cp.id = ?
  `).get(prereqId);
  if (!coursePrereq || coursePrereq.instructor_id !== req.session.userId) {
    return res.redirect('/courses/my-courses');
  }
  db.prepare('DELETE FROM course_prerequisites WHERE id = ?').run(prereqId);
  res.redirect('/courses/' + coursePrereq.course_slug + '/edit');
});

module.exports = router;