const express = require('express');
const { getDb } = require('../config/database');
const { isInstructor } = require('../middleware/auth');
const { toSafeInt } = require('../config/security');

const router = express.Router();

router.post('/add/:courseId', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const course = await db.prepare('SELECT * FROM courses WHERE id = ? AND instructor_id = ?').get(toSafeInt(req.params.courseId), req.session.userId);
    if (!course) {
      return res.redirect('/courses/my-courses');
    }
    const { prerequisite_id } = req.body;
    if (!prerequisite_id) {
      return res.redirect('/courses/' + course.slug + '/edit');
    }
    const prereqId = toSafeInt(prerequisite_id);
    if (prereqId === course.id) {
      return res.redirect('/courses/' + course.slug + '/edit');
    }
    const prereqCourse = await db.prepare("SELECT * FROM courses WHERE id = ? AND status = 'published'").get(prereqId);
    if (!prereqCourse) {
      return res.redirect('/courses/' + course.slug + '/edit');
    }
    try {
      await db.prepare('INSERT INTO course_prerequisites (course_id, prerequisite_course_id) VALUES (?, ?)').run(course.id, prereqId);
    } catch (e) {
      // Already exists
    }
    return res.redirect('/courses/' + course.slug + '/edit');
  } catch(err) { next(err); }
});

router.post('/remove/:prereqId', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const prereqId = toSafeInt(req.params.prereqId);
    const coursePrereq = await db.prepare(`
      SELECT cp.*, c.title as course_title, c.slug as course_slug, c.instructor_id
      FROM course_prerequisites cp
      JOIN courses c ON cp.course_id = c.id
      WHERE cp.id = ?
    `).get(prereqId);
    if (!coursePrereq || coursePrereq.instructor_id !== req.session.userId) {
      return res.redirect('/courses/my-courses');
    }
    await db.prepare('DELETE FROM course_prerequisites WHERE id = ?').run(prereqId);
    return res.redirect('/courses/' + coursePrereq.course_slug + '/edit');
  } catch(err) { next(err); }
});

module.exports = router;
