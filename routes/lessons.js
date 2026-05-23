const express = require('express');
const { getDb } = require('../config/database');
const { isAuthenticated, isInstructor } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '..', 'public', 'uploads', 'videos'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const allowed = /\.(mp4|webm|ogg|mov|avi|mkv|flv|wmv)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('صيغة الملف غير مدعومة. الصيغ المدعومة: mp4, webm, ogg, mov, avi, mkv, flv, wmv'), false);
    }
  }
});

function convertYouTubeUrl(url) {
  if (!url) return '';
  url = url.trim();
  var match;
  match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  if (match) {
    return 'https://www.youtube.com/embed/' + match[1];
  }
  if (url.startsWith('http') || url.startsWith('/uploads/')) {
    return url;
  }
  return '';
}

const router = express.Router();

router.get('/create/:courseId', isInstructor, (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE id = ? AND instructor_id = ?')
    .get(parseInt(req.params.courseId), req.session.userId);

  if (!course) return res.redirect('/courses/my-courses');

  const lessonCount = db.prepare('SELECT COUNT(*) as count FROM lessons WHERE course_id = ?')
    .get(course.id).count;

  res.render('lessons/create', {
    title: 'إضافة درس جديد',
    course,
    courseId: course.id,
    lessonCount,
    error: null
  });
});

function handleUpload(req, res, next) {
  upload.single('video_file')(req, res, function (err) {
    if (err) {
      req.session.flash = { type: 'error', message: err.message || 'حدث خطأ في رفع الملف. تأكد من أن حجم الملف أقل من 200MB والصيغة مدعومة.' };
      return res.redirect('back');
    }
    next();
  });
}

router.post('/create/:courseId', isInstructor, handleUpload, (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE id = ? AND instructor_id = ?')
    .get(parseInt(req.params.courseId), req.session.userId);

  if (!course) return res.redirect('/courses/my-courses');

  const { title, content, video_url, duration, type, quiz_title, quiz_passing_score, quiz_time_limit, questions } = req.body;

  if (!title) {
    const errLessonCount = db.prepare('SELECT COUNT(*) as count FROM lessons WHERE course_id = ?')
      .get(course.id).count;
    return res.render('lessons/create', {
      title: 'إضافة درس جديد',
      course,
      courseId: course.id,
      lessonCount: errLessonCount,
      error: 'عنوان الدرس مطلوب'
    });
  }

  let finalVideoUrl = video_url || '';
  if (req.file) {
    finalVideoUrl = '/uploads/videos/' + req.file.filename;
  } else if (finalVideoUrl) {
    finalVideoUrl = convertYouTubeUrl(finalVideoUrl);
  }

  const lessonCount = db.prepare('SELECT COUNT(*) as count FROM lessons WHERE course_id = ?')
    .get(course.id).count;

  const lessonResult = db.prepare(`
    INSERT INTO lessons (course_id, title, content, video_url, duration, order_index, type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(course.id, title, content || '', finalVideoUrl, parseInt(duration) || 0, lessonCount + 1, type || 'text');

  if (questions && Array.isArray(questions) && questions.some(function(q) { return q.question_text && q.correct_answer; })) {
    const quizResult = db.prepare('INSERT INTO quizzes (lesson_id, title, passing_score, time_limit) VALUES (?, ?, ?, ?)')
      .run(lessonResult.lastInsertRowid, quiz_title || ('اختبار: ' + title), parseInt(quiz_passing_score) || 70, parseInt(quiz_time_limit) || 0);

    questions.forEach(function(q, index) {
      if (q.question_text && q.correct_answer) {
        var opts = q.options || [];
        if (!Array.isArray(opts)) opts = [opts];
        db.prepare(`
          INSERT INTO quiz_questions (quiz_id, question_text, question_type, options, correct_answer, points, order_index)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          quizResult.lastInsertRowid,
          q.question_text,
          q.question_type || 'multiple_choice',
          JSON.stringify(opts),
          q.correct_answer,
          parseInt(q.points) || 1,
          index + 1
        );
      }
    });
  }

  db.prepare('UPDATE courses SET total_lessons = (SELECT COUNT(*) FROM lessons WHERE course_id = ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(course.id, course.id);

  res.redirect('/courses/' + course.slug);
});

router.get('/:id', isAuthenticated, (req, res) => {
  const db = getDb();
  const lesson = db.prepare(`
    SELECT l.*, c.title as course_title, c.slug as course_slug, c.instructor_id
    FROM lessons l
    JOIN courses c ON l.course_id = c.id
    WHERE l.id = ?
  `).get(parseInt(req.params.id));

  if (!lesson) {
    return res.status(404).render('error', { title: 'غير موجود', message: 'الدرس غير موجود', error: null });
  }

  const allLessons = db.prepare(`
    SELECT l.*,
      CASE WHEN lp.completed = 1 THEN 1 ELSE 0 END as is_completed
    FROM lessons l
    LEFT JOIN lesson_progress lp ON l.id = lp.lesson_id AND lp.user_id = ?
    WHERE l.course_id = ?
    ORDER BY l.order_index ASC
  `).all(req.session.userId, lesson.course_id);

  const currentIndex = allLessons.findIndex(function(l) { return l.id === lesson.id; });
  const prevLesson = currentIndex > 0 ? allLessons[currentIndex - 1] : null;
  const nextLesson = currentIndex < allLessons.length - 1 ? allLessons[currentIndex + 1] : null;

  const enrollment = db.prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?')
    .get(req.session.userId, lesson.course_id);

  if (!enrollment && req.session.role !== 'admin' && lesson.instructor_id !== req.session.userId) {
    return res.redirect('/courses/' + lesson.course_slug);
  }

  const quiz = db.prepare('SELECT * FROM quizzes WHERE lesson_id = ?').get(lesson.id);

  const isOwner = lesson.instructor_id === req.session.userId;

  const comments = db.prepare(`
    SELECT lc.*, u.name as user_name, u.avatar as user_avatar
    FROM lesson_comments lc
    JOIN users u ON lc.user_id = u.id
    WHERE lc.lesson_id = ?
    ORDER BY lc.created_at ASC
  `).all(lesson.id);

  res.render('lessons/view', {
    title: lesson.title,
    lesson,
    allLessons,
    prevLesson,
    nextLesson,
    currentIndex,
    quiz,
    totalLessons: allLessons.length,
    isOwner,
    comments
  });
});

router.post('/:id/complete', isAuthenticated, (req, res) => {
  const db = getDb();
  const lesson = db.prepare('SELECT l.*, c.instructor_id FROM lessons l JOIN courses c ON l.course_id = c.id WHERE l.id = ?').get(parseInt(req.params.id));
  if (!lesson) return res.status(404).json({ error: 'الدرس غير موجود' });

  var enrollment = db.prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.session.userId, lesson.course_id);
  if (!enrollment && lesson.instructor_id !== req.session.userId && req.session.role !== 'admin') {
    return res.status(403).json({ error: 'غير مسجل في هذا الكورس' });
  }

  const existing = db.prepare('SELECT id FROM lesson_progress WHERE user_id = ? AND lesson_id = ?')
    .get(req.session.userId, lesson.id);

  if (!existing) {
    db.prepare('INSERT INTO lesson_progress (user_id, lesson_id, completed, completed_at) VALUES (?, ?, 1, CURRENT_TIMESTAMP)')
      .run(req.session.userId, lesson.id);
  }

  const allLessons = db.prepare('SELECT COUNT(*) as count FROM lessons WHERE course_id = ?')
    .get(lesson.course_id).count;
  const completedLessons = db.prepare(`
    SELECT COUNT(*) as count FROM lesson_progress lp
    JOIN lessons l ON lp.lesson_id = l.id
    WHERE l.course_id = ? AND lp.user_id = ? AND lp.completed = 1
  `).get(lesson.course_id, req.session.userId).count;

  let completed = false;
  if (allLessons === completedLessons) {
    db.prepare('UPDATE enrollments SET completed_at = CURRENT_TIMESTAMP WHERE user_id = ? AND course_id = ? AND completed_at IS NULL')
      .run(req.session.userId, lesson.course_id);
    completed = true;
  }

  res.json({ success: true, completed: completed, progress: allLessons > 0 ? Math.round((completedLessons / allLessons) * 100) : 0 });
});

router.get('/:id/edit', isInstructor, (req, res) => {
  const db = getDb();
  const lesson = db.prepare(`
    SELECT l.*, c.id as course_id, c.slug as course_slug, c.instructor_id
    FROM lessons l
    JOIN courses c ON l.course_id = c.id
    WHERE l.id = ?
  `).get(parseInt(req.params.id));

  if (!lesson || lesson.instructor_id !== req.session.userId) {
    return res.redirect('/courses/my-courses');
  }

  const quiz = db.prepare('SELECT * FROM quizzes WHERE lesson_id = ?').get(lesson.id);
  const quizQuestions = quiz ? db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY order_index ASC').all(quiz.id) : [];

  res.render('lessons/edit', { title: 'تعديل الدرس', lesson, quiz, quizQuestions, error: null });
});

router.post('/:id/edit', isInstructor, handleUpload, (req, res) => {
  const db = getDb();
  const lesson = db.prepare(`
    SELECT l.*, c.slug as course_slug, c.instructor_id
    FROM lessons l
    JOIN courses c ON l.course_id = c.id
    WHERE l.id = ?
  `).get(parseInt(req.params.id));

  if (!lesson || lesson.instructor_id !== req.session.userId) {
    return res.redirect('/courses/my-courses');
  }

  const { title, content, video_url, duration, type, quiz_title, quiz_passing_score, quiz_time_limit, questions } = req.body;

  if (!title) {
    const existingQuiz = db.prepare('SELECT * FROM quizzes WHERE lesson_id = ?').get(lesson.id);
    const existingQuestions = existingQuiz ? db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY order_index ASC').all(existingQuiz.id) : [];
    return res.render('lessons/edit', { title: 'تعديل الدرس', lesson, quiz: existingQuiz, quizQuestions: existingQuestions, error: 'عنوان الدرس مطلوب' });
  }

  let finalVideoUrl = video_url || '';
  if (req.file) {
    finalVideoUrl = '/uploads/videos/' + req.file.filename;
  } else if (finalVideoUrl && !finalVideoUrl.startsWith('http') && !finalVideoUrl.startsWith('/uploads/')) {
    finalVideoUrl = convertYouTubeUrl(finalVideoUrl);
  } else if (!finalVideoUrl) {
    finalVideoUrl = lesson.video_url || '';
  }

  db.prepare(`
    UPDATE lessons SET title = ?, content = ?, video_url = ?, duration = ?, type = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(title, content || '', finalVideoUrl, parseInt(duration) || 0, type || 'text', lesson.id);

  const hasQuestions = questions && Array.isArray(questions) && questions.some(function(q) { return q.question_text && q.correct_answer; });
  const existingQuiz = db.prepare('SELECT * FROM quizzes WHERE lesson_id = ?').get(lesson.id);

  if (hasQuestions) {
    var quizId;
    if (existingQuiz) {
      quizId = existingQuiz.id;
      db.prepare('UPDATE quizzes SET title = ?, passing_score = ?, time_limit = ? WHERE id = ?')
        .run(quiz_title || ('اختبار: ' + title), parseInt(quiz_passing_score) || 70, parseInt(quiz_time_limit) || 0, quizId);
      db.prepare('DELETE FROM quiz_questions WHERE quiz_id = ?').run(quizId);
    } else {
      const quizResult = db.prepare('INSERT INTO quizzes (lesson_id, title, passing_score, time_limit) VALUES (?, ?, ?, ?)')
        .run(lesson.id, quiz_title || ('اختبار: ' + title), parseInt(quiz_passing_score) || 70, parseInt(quiz_time_limit) || 0);
      quizId = quizResult.lastInsertRowid;
    }

    questions.forEach(function(q, index) {
      if (q.question_text && q.correct_answer) {
        var opts = q.options || [];
        if (!Array.isArray(opts)) opts = [opts];
        db.prepare(`
          INSERT INTO quiz_questions (quiz_id, question_text, question_type, options, correct_answer, points, order_index)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(quizId, q.question_text, q.question_type || 'multiple_choice', JSON.stringify(opts), q.correct_answer, parseInt(q.points) || 1, index + 1);
      }
    });
  } else if (existingQuiz) {
    db.prepare('DELETE FROM quizzes WHERE id = ?').run(existingQuiz.id);
  }

  res.redirect('/lessons/' + lesson.id);
});

router.post('/:id/delete', isInstructor, (req, res) => {
  const db = getDb();
  const lesson = db.prepare(`
    SELECT l.*, c.slug as course_slug, c.instructor_id
    FROM lessons l
    JOIN courses c ON l.course_id = c.id
    WHERE l.id = ?
  `).get(parseInt(req.params.id));

  if (lesson && lesson.instructor_id === req.session.userId) {
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lesson.id);
    db.prepare('UPDATE courses SET total_lessons = (SELECT COUNT(*) FROM lessons WHERE course_id = ?) WHERE id = ?')
      .run(lesson.course_id, lesson.course_id);
    res.redirect('/courses/' + lesson.course_slug);
  } else {
    res.redirect('/courses/my-courses');
  }
});

module.exports = router;