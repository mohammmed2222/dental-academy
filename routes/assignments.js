const express = require('express');
const path = require('path');
const multer = require('multer');
const { getDb } = require('../config/database');
const { isAuthenticated, isInstructor } = require('../middleware/auth');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'assignments');
const assignmentStorage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, uploadDir); },
  filename: function (req, file, cb) { cb(null, 'submission-' + req.session.userId + '-' + Date.now() + path.extname(file.originalname)); }
});
const uploadAssignment = multer({
  storage: assignmentStorage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// List assignments for a lesson
router.get('/lesson/:lessonId', isAuthenticated, (req, res) => {
  const db = getDb();
  const lessonId = parseInt(req.params.lessonId);
  const lesson = db.prepare('SELECT l.*, c.instructor_id FROM lessons l JOIN courses c ON l.course_id = c.id WHERE l.id = ?').get(lessonId);
  if (!lesson) {
    return res.status(404).render('error', { title: 'غير موجود', message: 'الدرس غير موجود', error: null });
  }
  // Check if user is enrolled or instructor
  const enrollment = db.prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.session.userId, lesson.course_id);
  const isInstructorUser = lesson.instructor_id === req.session.userId;
  if (!enrollment && !isInstructorUser && req.session.role !== 'admin') {
    return res.redirect('/courses/' + lesson.course_slug);
  }
  const assignments = db.prepare('SELECT * FROM assignments WHERE lesson_id = ? ORDER BY created_at DESC').all(lessonId);
  res.render('assignments/list', { title: 'الواجبات', lesson, assignments });
});

// View assignment
router.get('/:id', isAuthenticated, (req, res) => {
  const db = getDb();
  const assignment = db.prepare(`
    SELECT a.*, l.title as lesson_title, l.course_id, c.title as course_title, c.slug as course_slug, c.instructor_id
    FROM assignments a
    JOIN lessons l ON a.lesson_id = l.id
    JOIN courses c ON l.course_id = c.id
    WHERE a.id = ?
  `).get(parseInt(req.params.id));
  if (!assignment) {
    return res.status(404).render('error', { title: 'غير موجود', message: 'الواجب غير موجود', error: null });
  }
  // Check enrollment or instructor
  const enrollment = db.prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.session.userId, assignment.course_id);
  const isInstructorUser = assignment.instructor_id === req.session.userId;
  if (!enrollment && !isInstructorUser && req.session.role !== 'admin') {
    return res.redirect('/courses/' + assignment.course_slug);
  }
  const submission = db.prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND user_id = ?').get(assignment.id, req.session.userId);
  res.render('assignments/view', { title: assignment.title, assignment, submission });
});

// Create assignment form
router.get('/create/:lessonId', isInstructor, (req, res) => {
  const db = getDb();
  const lesson = db.prepare(`
    SELECT l.*, c.instructor_id
    FROM lessons l
    JOIN courses c ON l.course_id = c.id
    WHERE l.id = ?
  `).get(parseInt(req.params.lessonId));
  if (!lesson || lesson.instructor_id !== req.session.userId) {
    return res.redirect('/courses/my-courses');
  }
  res.render('assignments/create', { title: 'إنشاء واجب جديد', lesson, error: null });
});

// Create assignment
router.post('/create/:lessonId', isInstructor, (req, res) => {
  const db = getDb();
  const lesson = db.prepare(`
    SELECT l.*, c.instructor_id
    FROM lessons l
    JOIN courses c ON l.course_id = c.id
    WHERE l.id = ?
  `).get(parseInt(req.params.lessonId));
  if (!lesson || lesson.instructor_id !== req.session.userId) {
    return res.redirect('/courses/my-courses');
  }
  const { title, description, due_date, max_points, file_allowed } = req.body;
  if (!title) {
    return res.render('assignments/create', { title: 'إنشاء واجب جديد', lesson, error: 'عنوان الواجب مطلوب' });
  }
  db.prepare(`
    INSERT INTO assignments (lesson_id, title, description, due_date, max_points, file_allowed)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(lesson.id, title, description || '', due_date || null, parseInt(max_points) || 100, file_allowed ? 1 : 0);
  res.redirect('/lessons/' + lesson.id);
});

// Edit assignment form
router.get('/:id/edit', isInstructor, (req, res) => {
  const db = getDb();
  const assignment = db.prepare(`
    SELECT a.*, l.id as lesson_id, c.instructor_id
    FROM assignments a
    JOIN lessons l ON a.lesson_id = l.id
    JOIN courses c ON l.course_id = c.id
    WHERE a.id = ?
  `).get(parseInt(req.params.id));
  if (!assignment || assignment.instructor_id !== req.session.userId) {
    return res.redirect('/courses/my-courses');
  }
  res.render('assignments/edit', { title: 'تعديل الواجب', assignment, error: null });
});

// Edit assignment
router.post('/:id/edit', isInstructor, (req, res) => {
  const db = getDb();
  const assignment = db.prepare(`
    SELECT a.*, l.id as lesson_id, c.instructor_id
    FROM assignments a
    JOIN lessons l ON a.lesson_id = l.id
    JOIN courses c ON l.course_id = c.id
    WHERE a.id = ?
  `).get(parseInt(req.params.id));
  if (!assignment || assignment.instructor_id !== req.session.userId) {
    return res.redirect('/courses/my-courses');
  }
  const { title, description, due_date, max_points, file_allowed } = req.body;
  if (!title) {
    return res.render('assignments/edit', { title: 'تعديل الواجب', assignment, error: 'عنوان الواجب مطلوب' });
  }
  db.prepare(`
    UPDATE assignments SET title = ?, description = ?, due_date = ?, max_points = ?, file_allowed = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(title, description || '', due_date || null, parseInt(max_points) || 100, file_allowed ? 1 : 0, assignment.id);
  res.redirect('/assignments/' + assignment.id);
});

// Delete assignment
router.post('/:id/delete', isInstructor, (req, res) => {
  const db = getDb();
  const assignment = db.prepare(`
    SELECT a.*, l.id as lesson_id, c.instructor_id
    FROM assignments a
    JOIN lessons l ON a.lesson_id = l.id
    JOIN courses c ON l.course_id = c.id
    WHERE a.id = ?
  `).get(parseInt(req.params.id));
  if (assignment && assignment.instructor_id === req.session.userId) {
    db.prepare('DELETE FROM assignments WHERE id = ?').run(assignment.id);
    db.prepare('DELETE FROM assignment_submissions WHERE assignment_id = ?').run(assignment.id);
    res.redirect('/lessons/' + assignment.lesson_id);
  } else {
    res.redirect('/courses/my-courses');
  }
});

// Submit assignment
router.post('/:id/submit', isAuthenticated, function(req, res) {
  uploadAssignment.single('file')(req, res, function(err) {
    if (err) {
      req.session.flash = { type: 'error', message: err.message };
      return res.redirect('/assignments/' + req.params.id);
    }

    const db = getDb();
    const assignment = db.prepare(`
      SELECT a.*, l.course_id, c.instructor_id
      FROM assignments a
      JOIN lessons l ON a.lesson_id = l.id
      JOIN courses c ON l.course_id = c.id
      WHERE a.id = ?
    `).get(parseInt(req.params.id));
    if (!assignment) {
      return res.status(404).json({ error: 'الواجب غير موجود' });
    }

    // Check enrollment
    const enrollment = db.prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.session.userId, assignment.course_id);
    if (!enrollment && req.session.role !== 'admin' && assignment.instructor_id !== req.session.userId) {
      return res.status(403).json({ error: 'غير مصرح بالتسجيل في هذا الواجب' });
    }

    const content = req.body.notes || req.body.content || '';
    const filePath = req.file ? '/uploads/assignments/' + req.file.filename : '';

    // Check if already submitted
    const existing = db.prepare('SELECT id FROM assignment_submissions WHERE assignment_id = ? AND user_id = ?').get(assignment.id, req.session.userId);
    if (existing) {
      db.prepare(`
        UPDATE assignment_submissions SET content = ?, file_path = ?, submitted_at = CURRENT_TIMESTAMP, score = NULL, feedback = NULL, graded_at = NULL
        WHERE assignment_id = ? AND user_id = ?
      `).run(content || '', filePath, assignment.id, req.session.userId);
    } else {
      db.prepare(`
        INSERT INTO assignment_submissions (assignment_id, user_id, content, file_path, submitted_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(assignment.id, req.session.userId, content || '', filePath);
    }
    res.redirect('/assignments/' + assignment.id);
  });
});

// Grade submission (instructor only)
router.post('/submissions/:id/grade', isInstructor, (req, res) => {
  const db = getDb();
  const submission = db.prepare(`
    SELECT s.*, a.lesson_id, a.title as assignment_title, c.instructor_id
    FROM assignment_submissions s
    JOIN assignments a ON s.assignment_id = a.id
    JOIN lessons l ON a.lesson_id = l.id
    JOIN courses c ON l.course_id = c.id
    WHERE s.id = ?
  `).get(parseInt(req.params.id));
  if (!submission || submission.instructor_id !== req.session.userId) {
    return res.redirect('/courses/my-courses');
  }
  const { score, feedback } = req.body;
  db.prepare(`
    UPDATE assignment_submissions SET score = ?, feedback = ?, graded_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(parseInt(score) || 0, feedback || '', submission.id);
  res.redirect('/assignments/' + submission.assignment_id);
});

module.exports = router;