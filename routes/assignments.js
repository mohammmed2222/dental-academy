const express = require('express');
const path = require('path');
const multer = require('multer');
const { getDb, sqlNow } = require('../config/database');
const { isAuthenticated, isInstructor } = require('../middleware/auth');
const { toSafeInt } = require('../config/security');
const { sendMail } = require('../config/mail');
const { createNotification } = require('../config/notifications');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'assignments');
const assignmentStorage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, uploadDir); },
  filename: function (req, file, cb) { cb(null, 'submission-' + req.session.userId + '-' + Date.now() + path.extname(file.originalname)); }
});
const uploadAssignment = multer({
  storage: assignmentStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    var ext = path.extname(file.originalname).toLowerCase();
    var allowedExts = ['.pdf', '.doc', '.docx', '.zip', '.rar', '.jpg', '.jpeg', '.png', '.gif', '.txt', '.ppt', '.pptx', '.xls', '.xlsx'];
    var allowedMimes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/x-rar-compressed', 'image/jpeg', 'image/png', 'image/gif', 'text/plain', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    if (allowedExts.indexOf(ext) === -1 || allowedMimes.indexOf(file.mimetype) === -1) {
      return cb(new Error('نوع الملف غير مسموح به'), false);
    }
    cb(null, true);
  }
});

// List assignments for a lesson
router.get('/lesson/:lessonId', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const lessonId = toSafeInt(req.params.lessonId);
    const lesson = await db.prepare('SELECT l.*, c.instructor_id, c.slug as course_slug, c.title as course_title FROM lessons l JOIN courses c ON l.course_id = c.id WHERE l.id = ?').get(lessonId);
    if (!lesson) {
      return res.status(404).render('error', { title: 'غير موجود', message: 'الدرس غير موجود', error: null });
    }
    // Check if user is enrolled or instructor
    const enrollment = await db.prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.session.userId, lesson.course_id);
    const isInstructorUser = lesson.instructor_id === req.session.userId;
    if (!enrollment && !isInstructorUser && req.session.role !== 'admin') {
      return res.redirect('/courses/' + lesson.course_slug);
    }
    const assignments = await db.prepare('SELECT * FROM assignments WHERE lesson_id = ? ORDER BY created_at DESC').all(lessonId);
    return res.render('assignments/list', { title: 'الواجبات', lesson, assignments });
  } catch (err) {
    next(err);
  }
});

// View assignment
router.get('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const assignment = await db.prepare(`
      SELECT a.*, l.title as lesson_title, l.course_id, c.title as course_title, c.slug as course_slug, c.instructor_id
      FROM assignments a
      JOIN lessons l ON a.lesson_id = l.id
      JOIN courses c ON l.course_id = c.id
      WHERE a.id = ?
    `).get(toSafeInt(req.params.id));
    if (!assignment) {
      return res.status(404).render('error', { title: 'غير موجود', message: 'الواجب غير موجود', error: null });
    }
    // Check enrollment or instructor
    const enrollment = await db.prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.session.userId, assignment.course_id);
    const isInstructorUser = assignment.instructor_id === req.session.userId;
    if (!enrollment && !isInstructorUser && req.session.role !== 'admin') {
      return res.redirect('/courses/' + assignment.course_slug);
    }
    const submission = await db.prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND user_id = ?').get(assignment.id, req.session.userId);
    return res.render('assignments/view', { title: assignment.title, assignment, submission });
  } catch (err) {
    next(err);
  }
});

// Create assignment form
router.get('/create/:lessonId', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const lesson = await db.prepare(`
      SELECT l.*, c.instructor_id
      FROM lessons l
      JOIN courses c ON l.course_id = c.id
      WHERE l.id = ?
    `).get(toSafeInt(req.params.lessonId));
    if (!lesson || lesson.instructor_id !== req.session.userId) {
      return res.redirect('/courses/my-courses');
    }
    return res.render('assignments/create', { title: 'إنشاء واجب جديد', lesson, courseId: lesson.course_id, error: null });
  } catch (err) {
    next(err);
  }
});

// Create assignment
router.post('/create/:lessonId', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const lesson = await db.prepare(`
      SELECT l.*, c.instructor_id
      FROM lessons l
      JOIN courses c ON l.course_id = c.id
      WHERE l.id = ?
    `).get(toSafeInt(req.params.lessonId));
    if (!lesson || lesson.instructor_id !== req.session.userId) {
      return res.redirect('/courses/my-courses');
    }
    const { title, description, due_date, max_points, file_allowed } = req.body;
    if (!title) {
      return res.render('assignments/create', { title: 'إنشاء واجب جديد', lesson, error: 'عنوان الواجب مطلوب' });
    }
    await db.prepare(`
      INSERT INTO assignments (lesson_id, title, description, due_date, max_points, file_allowed)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(lesson.id, title, description || '', due_date || null, toSafeInt(max_points) || 100, file_allowed ? 1 : 0);

    return res.redirect('/lessons/' + lesson.id);
  } catch (err) {
    next(err);
  }
});

// Edit assignment form
router.get('/:id/edit', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const assignment = await db.prepare(`
      SELECT a.*, l.id as lesson_id, c.instructor_id
      FROM assignments a
      JOIN lessons l ON a.lesson_id = l.id
      JOIN courses c ON l.course_id = c.id
      WHERE a.id = ?
    `).get(toSafeInt(req.params.id));
    if (!assignment || assignment.instructor_id !== req.session.userId) {
      return res.redirect('/courses/my-courses');
    }
    return res.render('assignments/edit', { title: 'تعديل الواجب', assignment, error: null });
  } catch (err) {
    next(err);
  }
});

// Edit assignment
router.post('/:id/edit', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const assignment = await db.prepare(`
      SELECT a.*, l.id as lesson_id, c.instructor_id
      FROM assignments a
      JOIN lessons l ON a.lesson_id = l.id
      JOIN courses c ON l.course_id = c.id
      WHERE a.id = ?
    `).get(toSafeInt(req.params.id));
    if (!assignment || assignment.instructor_id !== req.session.userId) {
      return res.redirect('/courses/my-courses');
    }
    const { title, description, due_date, max_points, file_allowed } = req.body;
    if (!title) {
      return res.render('assignments/edit', { title: 'تعديل الواجب', assignment, error: 'عنوان الواجب مطلوب' });
    }
    await db.prepare(`
      UPDATE assignments SET title = ?, description = ?, due_date = ?, max_points = ?, file_allowed = ?, updated_at = ${sqlNow()}
      WHERE id = ?
    `).run(title, description || '', due_date || null, toSafeInt(max_points) || 100, file_allowed ? 1 : 0, assignment.id);
    return res.redirect('/assignments/' + assignment.id);
  } catch (err) {
    next(err);
  }
});

// Delete assignment
router.post('/:id/delete', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const assignment = await db.prepare(`
      SELECT a.*, l.id as lesson_id, c.instructor_id
      FROM assignments a
      JOIN lessons l ON a.lesson_id = l.id
      JOIN courses c ON l.course_id = c.id
      WHERE a.id = ?
    `).get(toSafeInt(req.params.id));
    if (assignment && assignment.instructor_id === req.session.userId) {
      await db.prepare('DELETE FROM assignments WHERE id = ?').run(assignment.id);
      await db.prepare('DELETE FROM assignment_submissions WHERE assignment_id = ?').run(assignment.id);
      return res.redirect('/lessons/' + assignment.lesson_id);
    } else {
      return res.redirect('/courses/my-courses');
    }
  } catch (err) {
    next(err);
  }
});

// Submit assignment
router.post('/:id/submit', isAuthenticated, async (req, res, next) => {
  try {
    uploadAssignment.single('file')(req, res, async function(err) {
      try {
        if (err) {
          req.session.flash = { type: 'error', message: err.message };
          return res.redirect('/assignments/' + req.params.id);
        }

        const db = getDb();
        const assignment = await db.prepare(`
          SELECT a.*, l.course_id, c.instructor_id, c.title as course_title
          FROM assignments a
          JOIN lessons l ON a.lesson_id = l.id
          JOIN courses c ON l.course_id = c.id
          WHERE a.id = ?
        `).get(toSafeInt(req.params.id));
        if (!assignment) {
          return res.status(404).json({ error: 'الواجب غير موجود' });
        }

        // Check due date
        if (assignment.due_date) {
          var dueDate = new Date(assignment.due_date);
          if (Date.now() > dueDate.getTime()) {
            req.session.flash = { type: 'error', message: 'انتهى موعد تسليم هذا الواجب' };
            return res.redirect('/assignments/' + assignment.id);
          }
        }

        // Check enrollment
        const enrollment = await db.prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.session.userId, assignment.course_id);
        if (!enrollment && req.session.role !== 'admin' && assignment.instructor_id !== req.session.userId) {
          return res.status(403).json({ error: 'غير مصرح بالتسجيل في هذا الواجب' });
        }

        const notes = req.body.notes || '';
        const fileUrl = req.file ? '/uploads/assignments/' + req.file.filename : '';

        const existing = await db.prepare('SELECT id FROM assignment_submissions WHERE assignment_id = ? AND user_id = ?').get(assignment.id, req.session.userId);
        if (existing) {
          await db.prepare(`
            UPDATE assignment_submissions SET notes = ?, file_url = ?, submitted_at = ${sqlNow()}, grade = NULL, feedback = NULL, graded_at = NULL
            WHERE assignment_id = ? AND user_id = ?
          `).run(notes, fileUrl, assignment.id, req.session.userId);
        } else {
          await db.prepare(`
            INSERT INTO assignment_submissions (assignment_id, user_id, notes, file_url, submitted_at)
            VALUES (?, ?, ?, ?, ${sqlNow()})
          `).run(assignment.id, req.session.userId, notes, fileUrl);
        }
        try {
          const instructor = await db.prepare('SELECT email FROM users WHERE id = ?').get(assignment.instructor_id);
          if (instructor && instructor.email) {
            await sendMail({
              to: instructor.email,
              subject: 'تقديم واجب جديد: ' + assignment.title,
              html: '<p>قام الطالب ' + req.session.userName + ' بتقديم واجب ' + assignment.title + ' في دورة ' + assignment.course_title + '</p>',
            });
          }
        } catch (err) {
          console.error('فشل إرسال إشعار البريد الإلكتروني:', err);
        }
        return res.redirect('/assignments/' + assignment.id);
      } catch (err) {
        next(err);
      }
    });
  } catch (err) {
    next(err);
  }
});

// Grade submission (instructor only)
router.post('/submissions/:id/grade', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const submission = await db.prepare(`
      SELECT s.*, a.lesson_id, a.title as assignment_title, a.max_points, c.instructor_id, c.title as course_title
      FROM assignment_submissions s
      JOIN assignments a ON s.assignment_id = a.id
      JOIN lessons l ON a.lesson_id = l.id
      JOIN courses c ON l.course_id = c.id
      WHERE s.id = ?
    `).get(toSafeInt(req.params.id));
    if (!submission || submission.instructor_id !== req.session.userId) {
      return res.redirect('/courses/my-courses');
    }
    const { score, feedback } = req.body;
    const finalScore = toSafeInt(score) || 0;
    await db.prepare(`
      UPDATE assignment_submissions SET grade = ?, feedback = ?, graded_at = ${sqlNow()} WHERE id = ?
    `).run(finalScore, feedback || '', submission.id);
    try {
      const student = await db.prepare('SELECT name, email FROM users WHERE id = ?').get(submission.user_id);
      if (student && student.email) {
        await sendMail({
          to: student.email,
          subject: 'تصحيح الواجب: ' + submission.assignment_title,
          html: '<p>تم تصحيح واجبك ' + submission.assignment_title + '. الدرجة: ' + finalScore + '/' + submission.max_points + '</p>',
        });
      }
      await createNotification(submission.user_id, 'grade', 'تصحيح الواجب: ' + submission.assignment_title, 'تم تصحيح واجبك ' + submission.assignment_title + '. الدرجة: ' + finalScore + '/' + submission.max_points, submission.assignment_id, 'assignment');
    } catch (err) {
      console.error('فشل إرسال إشعار التصحيح:', err);
    }
    return res.redirect('/assignments/' + submission.assignment_id);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
