const express = require('express');
const { getDb, sqlNow } = require('../config/database');
const { isAuthenticated, isInstructor } = require('../middleware/auth');
const { toSafeInt } = require('../config/security');
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
    var allowedMimes = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/x-flv', 'video/x-ms-wmv'];
    if (allowed.test(path.extname(file.originalname)) && allowedMimes.indexOf(file.mimetype) !== -1) {
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
  match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube-nocookie\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (match) {
    return 'https://www.youtube-nocookie.com/embed/' + match[1];
  }
  if (url.startsWith('http') || url.startsWith('/uploads/')) {
    return url;
  }
  return '';
}

const router = express.Router();

router.get('/create/:courseId', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const course = await db.prepare('SELECT * FROM courses WHERE id = ? AND instructor_id = ?')
      .get(toSafeInt(req.params.courseId), req.session.userId);

    if (!course) return res.redirect('/courses/my-courses');

    const lessonCount = await db.prepare('SELECT COUNT(*) as count FROM lessons WHERE course_id = ?')
      .get(course.id).count;

    return res.render('lessons/create', {
      title: 'إضافة درس جديد',
      course,
      courseId: course.id,
      lessonCount,
      error: null
    });
  } catch(err) {
    next(err);
  }
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

router.post('/create/:courseId', isInstructor, handleUpload, async (req, res, next) => {
  try {
    const db = getDb();
    const course = await db.prepare('SELECT * FROM courses WHERE id = ? AND instructor_id = ?')
      .get(toSafeInt(req.params.courseId), req.session.userId);

    if (!course) return res.redirect('/courses/my-courses');

    const { title, content, video_url, duration, type, release_date, quiz_title, quiz_passing_score, quiz_time_limit, questions } = req.body;

    if (!title) {
      const errLessonCount = Number(await db.prepare('SELECT COUNT(*) as count FROM lessons WHERE course_id = ?')
        .get(course.id).count);
      return res.render('lessons/create', {
        title: 'إضافة درس جديد',
        course,
        courseId: course.id,
        lessonCount: errLessonCount,
        error: 'عنوان الدرس مطلوب'
      });
    }

    let finalVideoUrl = String(video_url || '');
    if (req.file) {
      finalVideoUrl = '/uploads/videos/' + req.file.filename;
    } else if (finalVideoUrl) {
      finalVideoUrl = convertYouTubeUrl(finalVideoUrl);
    }

    const lessonCount = Number(await db.prepare('SELECT COUNT(*) as count FROM lessons WHERE course_id = ?')
      .get(course.id).count);

    const lessonResult = await db.prepare(`
      INSERT INTO lessons (course_id, title, content, video_url, duration, order_index, type, release_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(course.id, title, content || '', finalVideoUrl, toSafeInt(duration) || 0, lessonCount + 1, type || 'text', release_date || null);

    if (questions && Array.isArray(questions) && questions.some(function(q) { return q.question_text && q.correct_answer; })) {
      const quizResult = await db.prepare('INSERT INTO quizzes (lesson_id, title, passing_score, time_limit) VALUES (?, ?, ?, ?)')
        .run(lessonResult.lastInsertRowid, quiz_title || ('اختبار: ' + title), toSafeInt(quiz_passing_score) || 70, toSafeInt(quiz_time_limit) || 0);

      for (let index = 0; index < questions.length; index++) {
        const q = questions[index];
        if (q.question_text && q.correct_answer) {
          var opts = q.options || [];
          if (!Array.isArray(opts)) opts = [opts];
          await db.prepare(`
            INSERT INTO quiz_questions (quiz_id, question_text, question_type, options, correct_answer, points, order_index)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            quizResult.lastInsertRowid,
            q.question_text,
            q.question_type || 'multiple_choice',
            JSON.stringify(opts),
            q.correct_answer,
            toSafeInt(q.points) || 1,
            index + 1
          );
        }
      }
    }

    await db.prepare('UPDATE courses SET total_lessons = (SELECT COUNT(*) FROM lessons WHERE course_id = ?), updated_at = ' + sqlNow() + ' WHERE id = ?')
      .run(course.id, course.id);

    return res.redirect('/courses/' + course.slug);
  } catch(err) {
    next(err);
  }
});

router.get('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const lesson = await db.prepare(`
      SELECT l.*, c.title as course_title, c.slug as course_slug, c.instructor_id
      FROM lessons l
      JOIN courses c ON l.course_id = c.id
      WHERE l.id = ?
    `).get(toSafeInt(req.params.id));

    if (!lesson) {
      return res.status(404).render('error', { title: 'غير موجود', message: 'الدرس غير موجود', error: null });
    }

    const allLessons = await db.prepare(`
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

    const enrollment = await db.prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?')
      .get(req.session.userId, lesson.course_id);

    if (!enrollment && req.session.role !== 'admin' && lesson.instructor_id !== req.session.userId) {
      return res.redirect('/courses/' + lesson.course_slug);
    }

    const quiz = await db.prepare('SELECT * FROM quizzes WHERE lesson_id = ?').get(lesson.id);

    const isOwner = lesson.instructor_id === req.session.userId;

    const comments = await db.prepare(`
      SELECT lc.*, u.name as user_name, u.avatar as user_avatar
      FROM lesson_comments lc
      JOIN users u ON lc.user_id = u.id
      WHERE lc.lesson_id = ?
      ORDER BY lc.created_at ASC
    `).all(lesson.id);

    const now = new Date();
    const releaseDate = lesson.release_date ? new Date(lesson.release_date) : null;
    const isLocked = releaseDate && releaseDate > now && !isOwner && req.session.role !== 'admin';
    if (isLocked) {
      return res.redirect('/courses/' + courseSlug);
    }

    return res.render('lessons/view', {
      title: lesson.title,
      lesson,
      allLessons,
      prevLesson,
      nextLesson,
      currentIndex,
      quiz,
      totalLessons: allLessons.length,
      isOwner,
      isLocked,
      releaseDate,
      comments,
      currentUserId: req.session.userId
    });
  } catch(err) {
    next(err);
  }
});

router.post('/:id/complete', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const lesson = await db.prepare('SELECT l.*, c.instructor_id FROM lessons l JOIN courses c ON l.course_id = c.id WHERE l.id = ?').get(toSafeInt(req.params.id));
    if (!lesson) return res.status(404).json({ error: 'الدرس غير موجود' });

    var enrollment = await db.prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.session.userId, lesson.course_id);
    if (!enrollment && lesson.instructor_id !== req.session.userId && req.session.role !== 'admin') {
      return res.status(403).json({ error: 'غير مسجل في هذا الكورس' });
    }

    const now = new Date();
    const releaseDate = lesson.release_date ? new Date(lesson.release_date) : null;
    const isOwner = lesson.instructor_id === req.session.userId;
    if (releaseDate && releaseDate > now && !isOwner && req.session.role !== 'admin') {
      return res.status(403).json({ error: 'هذا الدرس غير متاح بعد' });
    }

    const existing = await db.prepare('SELECT id FROM lesson_progress WHERE user_id = ? AND lesson_id = ?')
      .get(req.session.userId, lesson.id);

    if (!existing) {
      await db.prepare('INSERT INTO lesson_progress (user_id, lesson_id, completed, completed_at) VALUES (?, ?, 1, ' + sqlNow() + ')')
        .run(req.session.userId, lesson.id);
    }

    const allLessons = Number(await db.prepare('SELECT COUNT(*) as count FROM lessons WHERE course_id = ?')
      .get(lesson.course_id).count);
    const completedLessons = Number(await db.prepare(`
      SELECT COUNT(*) as count FROM lesson_progress lp
      JOIN lessons l ON lp.lesson_id = l.id
      WHERE l.course_id = ? AND lp.user_id = ? AND lp.completed = 1
    `).get(lesson.course_id, req.session.userId).count);

    let completed = false;
    if (allLessons > 0 && allLessons === completedLessons) {
      await db.prepare('UPDATE enrollments SET completed_at = ' + sqlNow() + ' WHERE user_id = ? AND course_id = ? AND completed_at IS NULL')
        .run(req.session.userId, lesson.course_id);
      // Update learning path completion tracking
      var learningPathRows = await db.prepare(`
        SELECT lpe.id, lpe.completed_courses FROM learning_path_enrollments lpe
        JOIN learning_path_courses lpc ON lpe.path_id = lpc.path_id
        WHERE lpe.user_id = ? AND lpc.course_id = ?
      `).all(req.session.userId, lesson.course_id);
      for (var lpi = 0; lpi < learningPathRows.length; lpi++) {
        var lpe = learningPathRows[lpi];
        var cc = [];
        try { cc = JSON.parse(lpe.completed_courses || '[]'); } catch (e) {}
        if (cc.indexOf(lesson.course_id) === -1) {
          cc.push(lesson.course_id);
          await db.prepare('UPDATE learning_path_enrollments SET completed_courses = ? WHERE id = ?').run(JSON.stringify(cc), lpe.id);
        }
      }
      completed = true;
    }

    return res.json({ success: true, completed: completed, progress: allLessons > 0 ? Math.round((completedLessons / allLessons) * 100) : 0 });
  } catch(err) {
    next(err);
  }
});

router.get('/:id/edit', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const lesson = await db.prepare(`
      SELECT l.*, c.id as course_id, c.slug as course_slug, c.instructor_id
      FROM lessons l
      JOIN courses c ON l.course_id = c.id
      WHERE l.id = ?
    `).get(toSafeInt(req.params.id));

    if (!lesson || lesson.instructor_id !== req.session.userId) {
      return res.redirect('/courses/my-courses');
    }

    const quiz = await db.prepare('SELECT * FROM quizzes WHERE lesson_id = ?').get(lesson.id);
    const quizQuestions = quiz ? await db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY order_index ASC').all(quiz.id) : [];

    return res.render('lessons/edit', { title: 'تعديل الدرس', lesson, quiz, quizQuestions, error: null });
  } catch(err) {
    next(err);
  }
});

router.post('/:id/edit', isInstructor, handleUpload, async (req, res, next) => {
  try {
    const db = getDb();
    const lesson = await db.prepare(`
      SELECT l.*, c.slug as course_slug, c.instructor_id
      FROM lessons l
      JOIN courses c ON l.course_id = c.id
      WHERE l.id = ?
    `).get(toSafeInt(req.params.id));

    if (!lesson || lesson.instructor_id !== req.session.userId) {
      return res.redirect('/courses/my-courses');
    }

    const { title, content, video_url, duration, type, release_date, quiz_title, quiz_passing_score, quiz_time_limit, questions } = req.body;

    if (!title) {
      const existingQuiz = await db.prepare('SELECT * FROM quizzes WHERE lesson_id = ?').get(lesson.id);
      const existingQuestions = existingQuiz ? await db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY order_index ASC').all(existingQuiz.id) : [];
      return res.render('lessons/edit', { title: 'تعديل الدرس', lesson, quiz: existingQuiz, quizQuestions: existingQuestions, error: 'عنوان الدرس مطلوب' });
    }

    let finalVideoUrl = String(video_url || '');
    if (req.file) {
      finalVideoUrl = '/uploads/videos/' + req.file.filename;
    } else if (finalVideoUrl) {
      finalVideoUrl = convertYouTubeUrl(finalVideoUrl);
    } else {
      finalVideoUrl = lesson.video_url || '';
    }

    await db.prepare(`
      UPDATE lessons SET title = ?, content = ?, video_url = ?, duration = ?, type = ?, release_date = ?, updated_at = ` + sqlNow() + `
      WHERE id = ?
    `).run(title, content || '', finalVideoUrl, toSafeInt(duration) || 0, type || 'text', release_date || null, lesson.id);

    const hasQuestions = questions && Array.isArray(questions) && questions.some(function(q) { return q.question_text && q.correct_answer; });
    const existingQuiz = await db.prepare('SELECT * FROM quizzes WHERE lesson_id = ?').get(lesson.id);

    if (hasQuestions) {
      var quizId;
      if (existingQuiz) {
        quizId = existingQuiz.id;
        await db.prepare('UPDATE quizzes SET title = ?, passing_score = ?, time_limit = ? WHERE id = ?')
          .run(quiz_title || ('اختبار: ' + title), toSafeInt(quiz_passing_score) || 70, toSafeInt(quiz_time_limit) || 0, quizId);
        await db.prepare('DELETE FROM quiz_questions WHERE quiz_id = ?').run(quizId);
      } else {
        const quizResult = await db.prepare('INSERT INTO quizzes (lesson_id, title, passing_score, time_limit) VALUES (?, ?, ?, ?)')
          .run(lesson.id, quiz_title || ('اختبار: ' + title), toSafeInt(quiz_passing_score) || 70, toSafeInt(quiz_time_limit) || 0);
        quizId = quizResult.lastInsertRowid;
      }

      for (let index = 0; index < questions.length; index++) {
        const q = questions[index];
        if (q.question_text && q.correct_answer) {
          var opts = q.options || [];
          if (!Array.isArray(opts)) opts = [opts];
          await db.prepare(`
            INSERT INTO quiz_questions (quiz_id, question_text, question_type, options, correct_answer, points, order_index)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(quizId, q.question_text, q.question_type || 'multiple_choice', JSON.stringify(opts), q.correct_answer, toSafeInt(q.points) || 1, index + 1);
        }
      }
    } else if (existingQuiz) {
      await db.prepare('DELETE FROM quizzes WHERE id = ?').run(existingQuiz.id);
    }

    return res.redirect('/lessons/' + lesson.id);
  } catch(err) {
    next(err);
  }
});

router.post('/:id/delete', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const lesson = await db.prepare(`
      SELECT l.*, c.slug as course_slug, c.instructor_id
      FROM lessons l
      JOIN courses c ON l.course_id = c.id
      WHERE l.id = ?
    `).get(toSafeInt(req.params.id));

    if (lesson && lesson.instructor_id === req.session.userId) {
      if (lesson.video_url && lesson.video_url.startsWith('/uploads/videos/')) {
        const fs = require('fs');
        const filePath = require('path').join(__dirname, '..', 'public', lesson.video_url);
        try { fs.unlinkSync(filePath); } catch (e) { console.error('تعذر حذف ملف الفيديو:', e.message); }
      }
      await db.prepare('DELETE FROM lessons WHERE id = ?').run(lesson.id);
      await db.prepare(`UPDATE courses SET total_lessons = (SELECT COUNT(*) FROM lessons WHERE course_id = ?), updated_at = ${sqlNow()} WHERE id = ?`)
        .run(lesson.course_id, lesson.course_id);
      return res.redirect('/courses/' + lesson.course_slug);
    } else {
      return res.redirect('/courses/my-courses');
    }
  } catch(err) {
    next(err);
  }
});

module.exports = router;
