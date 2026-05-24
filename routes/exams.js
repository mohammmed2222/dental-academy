const express = require('express');
const { getDb, saveDatabase } = require('../config/database');
const { isAuthenticated, isInstructor } = require('../middleware/auth');

const router = express.Router();

router.get('/:slug/exams/create', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const course = await db.prepare('SELECT * FROM courses WHERE slug = ? AND instructor_id = ?')
      .get(req.params.slug, req.session.userId);

    if (!course) return res.redirect('/courses/my-courses');

    return res.render('exams/create', { title: 'إنشاء اختبار نهائي', course, error: null });
  } catch(err) {
    next(err);
  }
});

router.post('/:slug/exams/create', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const course = await db.prepare('SELECT * FROM courses WHERE slug = ? AND instructor_id = ?')
      .get(req.params.slug, req.session.userId);

    if (!course) return res.redirect('/courses/my-courses');

    const { title, passing_score, time_limit, max_attempts, questions } = req.body;

    if (!title) {
      return res.render('exams/create', { title: 'إنشاء اختبار نهائي', course, error: 'عنوان الاختبار مطلوب' });
    }

    const examResult = await db.prepare('INSERT INTO course_exams (course_id, title, passing_score, time_limit, max_attempts) VALUES (?, ?, ?, ?, ?)')
      .run(course.id, title, parseInt(passing_score) || 70, parseInt(time_limit) || 0, parseInt(max_attempts) || 0);

    if (questions && Array.isArray(questions)) {
      for (let index = 0; index < questions.length; index++) {
        const q = questions[index];
        if (q.question_text && q.correct_answer) {
          var opts = q.options || [];
          if (!Array.isArray(opts)) opts = [opts];
          await db.prepare(`
            INSERT INTO exam_questions (exam_id, question_text, question_type, options, correct_answer, points, order_index)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            examResult.lastInsertRowid,
            q.question_text,
            q.question_type || 'multiple_choice',
            JSON.stringify(opts),
            q.correct_answer,
            parseInt(q.points) || 1,
            index + 1
          );
        }
      }
    }

    return res.redirect('/courses/' + course.slug);
  } catch(err) {
    next(err);
  }
});

router.get('/:slug/exams/:id/edit', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const exam = await db.prepare(`
      SELECT e.*, c.instructor_id, c.slug as course_slug
      FROM course_exams e
      JOIN courses c ON e.course_id = c.id
      WHERE e.id = ? AND c.slug = ?
    `).get(parseInt(req.params.id), req.params.slug);

    if (!exam || exam.instructor_id !== req.session.userId) {
      return res.redirect('/courses/my-courses');
    }

    const questions = await db.prepare('SELECT * FROM exam_questions WHERE exam_id = ? ORDER BY order_index ASC').all(exam.id);

    return res.render('exams/edit', { title: 'تعديل الاختبار النهائي', exam, questions, error: null });
  } catch(err) {
    next(err);
  }
});

router.post('/:slug/exams/:id/edit', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const exam = await db.prepare(`
      SELECT e.*, c.instructor_id
      FROM course_exams e
      JOIN courses c ON e.course_id = c.id
      WHERE e.id = ? AND c.slug = ?
    `).get(parseInt(req.params.id), req.params.slug);

    if (!exam || exam.instructor_id !== req.session.userId) {
      return res.redirect('/courses/my-courses');
    }

    const { title, passing_score, time_limit, max_attempts, questions } = req.body;

    await db.prepare('UPDATE course_exams SET title = ?, passing_score = ?, time_limit = ?, max_attempts = ? WHERE id = ?')
      .run(title, parseInt(passing_score) || 70, parseInt(time_limit) || 0, parseInt(max_attempts) || 0, exam.id);

    await db.prepare('DELETE FROM exam_questions WHERE exam_id = ?').run(exam.id);

    if (questions && Array.isArray(questions)) {
      for (let index = 0; index < questions.length; index++) {
        const q = questions[index];
        if (q.question_text && q.correct_answer) {
          var opts = q.options || [];
          if (!Array.isArray(opts)) opts = [opts];
          await db.prepare(`
            INSERT INTO exam_questions (exam_id, question_text, question_type, options, correct_answer, points, order_index)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            exam.id,
            q.question_text,
            q.question_type || 'multiple_choice',
            JSON.stringify(opts),
            q.correct_answer,
            parseInt(q.points) || 1,
            index + 1
          );
        }
      }
    }

    return res.redirect('/courses/' + req.params.slug);
  } catch(err) {
    next(err);
  }
});

router.post('/:slug/exams/:id/delete', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const exam = await db.prepare(`
      SELECT e.*, c.instructor_id
      FROM course_exams e
      JOIN courses c ON e.course_id = c.id
      WHERE e.id = ? AND c.slug = ?
    `).get(parseInt(req.params.id), req.params.slug);

    if (exam && exam.instructor_id === req.session.userId) {
      await db.prepare('DELETE FROM course_exams WHERE id = ?').run(exam.id);
    }

    return res.redirect('/courses/' + req.params.slug);
  } catch(err) {
    next(err);
  }
});

router.get('/:slug/exams/:id', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const exam = await db.prepare(`
      SELECT e.*, c.title as course_title, c.slug as course_slug, c.instructor_id
      FROM course_exams e
      JOIN courses c ON e.course_id = c.id
      WHERE e.id = ? AND c.slug = ?
    `).get(parseInt(req.params.id), req.params.slug);

    if (!exam) return res.status(404).render('error', { title: 'غير موجود', message: 'الاختبار غير موجود', error: null });

    const enrollment = await db.prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?')
      .get(req.session.userId, exam.course_id);

    if (!enrollment && exam.instructor_id !== req.session.userId && req.session.role !== 'admin') {
      return res.redirect('/courses/' + exam.course_slug);
    }

    const questions = await db.prepare('SELECT * FROM exam_questions WHERE exam_id = ? ORDER BY order_index ASC').all(exam.id);

    const pastAttempts = await db.prepare('SELECT * FROM exam_attempts WHERE user_id = ? AND exam_id = ? ORDER BY attempted_at DESC')
      .all(req.session.userId, exam.id);

    const lastAttempt = pastAttempts.length > 0 ? pastAttempts[0] : null;

    req.session['examStart_' + exam.id] = Date.now();

    var maxAttempts = exam.max_attempts || 0;
    var attemptsExhausted = maxAttempts > 0 && pastAttempts.length >= maxAttempts;

    return res.render('exams/take', {
      title: exam.title,
      exam, questions,
      lastAttempt, pastAttempts,
      attemptsExhausted
    });
  } catch(err) {
    next(err);
  }
});

router.post('/:slug/exams/:id/submit', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const exam = await db.prepare('SELECT * FROM course_exams WHERE id = ?').get(parseInt(req.params.id));
    if (!exam) return res.status(404).json({ error: 'الاختبار غير موجود' });

    // Check max attempts
    var maxAttempts = exam.max_attempts || 0;
    if (maxAttempts > 0) {
      var pastCount = await db.prepare('SELECT COUNT(*) as count FROM exam_attempts WHERE user_id = ? AND exam_id = ?')
        .get(req.session.userId, exam.id).count;
      if (pastCount >= maxAttempts) {
        req.session.flash = { type: 'error', message: 'لقد استنفذت جميع المحاولات المتاحة لهذا الاختبار' };
        return res.redirect('/courses/' + req.params.slug + '/exams/' + exam.id);
      }
    }

    // Check timer
    if (exam.time_limit > 0) {
      var startTime = req.session['examStart_' + exam.id];
      if (!startTime) {
        req.session.flash = { type: 'error', message: 'يرجى بدء الاختبار من صفحة الاختبار' };
        return res.redirect('/courses/' + req.params.slug + '/exams/' + exam.id);
      }
      var elapsed = Math.floor((Date.now() - startTime) / 1000 / 60);
      if (elapsed > exam.time_limit) {
        req.session.flash = { type: 'error', message: 'انتهى الوقت المخصص للاختبار' };
        return res.redirect('/courses/' + req.params.slug + '/exams/' + exam.id);
      }
    }

    const questions = await db.prepare('SELECT * FROM exam_questions WHERE exam_id = ? ORDER BY order_index ASC').all(exam.id);
    const answers = req.body.answers || {};

    let score = 0;
    const totalQuestions = questions.length;

    const attemptResult = await db.prepare('INSERT INTO exam_attempts (user_id, exam_id, total_questions) VALUES (?, ?, ?)')
      .run(req.session.userId, exam.id, totalQuestions);

    const attemptId = attemptResult.lastInsertRowid;

    for (const q of questions) {
      var userAnswerRaw = answers['q' + q.id];
      var isCorrect = false;
      var storedAnswer = '';
      var qPoints = parseInt(q.points, 10) || 1;

      var correctAnswer = q.correct_answer;

      var optMatch = String(q.correct_answer).match(/^option_(\d+)$/);
      var optsList = [];
      if (q.options) {
        try { optsList = JSON.parse(q.options); } catch (e) { optsList = []; }
      }

      if (optMatch && optsList.length > 0) {
        var optIdx = parseInt(optMatch[1], 10);
        if (optsList[optIdx] !== undefined) correctAnswer = String(optsList[optIdx]);
      }

      if (q.question_type === 'multiple_correct' && Array.isArray(userAnswerRaw)) {
        var correctAnswers = correctAnswer.split(',').map(function(s) { return s.trim().toLowerCase(); });
        var userAnswers = userAnswerRaw.map(function(s) { return String(s).trim().toLowerCase(); });
        storedAnswer = JSON.stringify(userAnswerRaw);
        if (correctAnswers.length === userAnswers.length) {
          var sortedCorrect = correctAnswers.slice().sort();
          var sortedUser = userAnswers.sort();
          isCorrect = sortedCorrect.every(function(val, idx) { return val === sortedUser[idx]; });
        }
      } else if (q.question_type === 'true_false') {
        storedAnswer = String(userAnswerRaw || '');
        var userBool = storedAnswer.trim().toLowerCase();
        var correctBool = String(correctAnswer).trim().toLowerCase();
        if (correctBool === 'true') correctAnswer = 'صح';
        if (correctBool === 'false') correctAnswer = 'خطأ';
        isCorrect = userBool === String(correctAnswer).trim().toLowerCase();
      } else {
        storedAnswer = String(userAnswerRaw || '');
        isCorrect = storedAnswer.trim().toLowerCase() === String(correctAnswer).trim().toLowerCase();
      }

      if (isCorrect) score += qPoints;

      await db.prepare('INSERT INTO exam_answers (attempt_id, question_id, answer, is_correct) VALUES (?, ?, ?, ?)')
        .run(attemptId, q.id, storedAnswer, isCorrect ? 1 : 0);
    }

    var totalPoints = questions.reduce(function(sum, q) { return sum + (parseInt(q.points, 10) || 1); }, 0);
    var percentage = totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0;
    var passed = percentage >= exam.passing_score ? 1 : 0;

    await db.prepare('UPDATE exam_attempts SET score = ?, passed = ? WHERE id = ?')
      .run(percentage, passed, attemptId);

    delete req.session['examStart_' + exam.id];
    return res.redirect('/courses/' + req.params.slug + '/exams/result/' + attemptId);
  } catch(err) {
    next(err);
  }
});

router.get('/:slug/exams/result/:attemptId', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const attempt = await db.prepare(`
      SELECT ea.*, e.title as exam_title, e.passing_score, e.course_id
      FROM exam_attempts ea
      JOIN course_exams e ON ea.exam_id = e.id
      WHERE ea.id = ? AND ea.user_id = ?
    `).get(parseInt(req.params.attemptId), req.session.userId);

    if (!attempt) return res.redirect('/dashboard');

    const questions = await db.prepare(`
      SELECT eq.*, ea2.answer as user_answer, ea2.is_correct
      FROM exam_questions eq
      LEFT JOIN exam_answers ea2 ON eq.id = ea2.question_id AND ea2.attempt_id = ?
      WHERE eq.exam_id = ?
      ORDER BY eq.order_index ASC
    `).all(attempt.id, attempt.exam_id);

    const course = await db.prepare('SELECT * FROM courses WHERE id = ?').get(attempt.course_id);

    return res.render('exams/result', {
      title: 'نتيجة الاختبار النهائي',
      attempt, questions, course
    });
  } catch(err) {
    next(err);
  }
});

module.exports = router;
