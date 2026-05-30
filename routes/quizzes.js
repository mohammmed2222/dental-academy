const express = require('express');
const { getDb } = require('../config/database');
const { isAuthenticated, isInstructor } = require('../middleware/auth');
const { toSafeInt } = require('../config/security');

const router = express.Router();

router.get('/create/:lessonId', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const lesson = await db.prepare(`
      SELECT l.*, c.instructor_id, c.title as course_title
      FROM lessons l
      JOIN courses c ON l.course_id = c.id
      WHERE l.id = ?
    `).get(toSafeInt(req.params.lessonId));

    if (!lesson || lesson.instructor_id !== req.session.userId) {
      return res.redirect('/courses/my-courses');
    }

    return res.render('quizzes/create', { title: 'إنشاء اختبار', lesson, error: null });
  } catch(err) {
    next(err);
  }
});

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

    const { title, passing_score, time_limit, max_attempts, questions } = req.body;

    if (!title) {
      return res.render('quizzes/create', { title: 'إنشاء اختبار', lesson, error: 'عنوان الاختبار مطلوب' });
    }

    const quizResult = await db.prepare('INSERT INTO quizzes (lesson_id, title, passing_score, time_limit, max_attempts) VALUES (?, ?, ?, ?, ?)')
      .run(lesson.id, title, toSafeInt(passing_score) || 70, toSafeInt(time_limit) || 0, toSafeInt(max_attempts) || 0);

    if (questions && Array.isArray(questions)) {
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

    return res.redirect('/lessons/' + lesson.id);
  } catch(err) {
    next(err);
  }
});

router.get('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const quiz = await db.prepare(`
      SELECT q.*, l.course_id, l.title as lesson_title, c.slug as course_slug, c.instructor_id
      FROM quizzes q
      JOIN lessons l ON q.lesson_id = l.id
      JOIN courses c ON l.course_id = c.id
      WHERE q.id = ?
    `).get(toSafeInt(req.params.id));

    if (!quiz) return res.status(404).render('error', { title: 'غير موجود', message: 'الاختبار غير موجود', error: null });

    if (req.session.role !== 'admin' && req.session.userId !== quiz.instructor_id) {
      var enrollment = await db.prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.session.userId, quiz.course_id);
      if (!enrollment) return res.redirect('/courses/' + quiz.course_slug);
    }

    const questions = await db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY order_index ASC').all(quiz.id);

    const pastAttempts = await db.prepare(`
      SELECT * FROM quiz_attempts WHERE user_id = ? AND quiz_id = ? ORDER BY attempted_at DESC
    `).all(req.session.userId, quiz.id);

    const lastAttempt = pastAttempts.length > 0 ? pastAttempts[0] : null;

    // Store quiz start time in session for timer enforcement
    req.session['quizStart_' + quiz.id] = Date.now();

    // Check if max attempts reached
    var maxAttempts = quiz.max_attempts || 0;
    var attemptsExhausted = maxAttempts > 0 && pastAttempts.length >= maxAttempts;

    return res.render('quizzes/take', { 
      title: quiz.title, 
      quiz, questions, 
      lastAttempt, 
      pastAttempts,
      attemptsExhausted
    });
  } catch(err) {
    next(err);
  }
});

router.post('/:id/submit', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const quiz = await db.prepare(`
      SELECT q.*, l.course_id, c.instructor_id
      FROM quizzes q
      JOIN lessons l ON q.lesson_id = l.id
      JOIN courses c ON l.course_id = c.id
      WHERE q.id = ?
    `).get(toSafeInt(req.params.id));
    if (!quiz) return res.status(404).json({ error: 'الاختبار غير موجود' });

    if (req.session.role !== 'admin' && req.session.userId !== quiz.instructor_id) {
      var submitEnroll = await db.prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.session.userId, quiz.course_id);
      if (!submitEnroll) return res.status(403).json({ error: 'غير مصرح' });
    }

    // Check max attempts
    var maxAttempts = quiz.max_attempts || 0;
    if (maxAttempts > 0) {
      var pastCount = await db.prepare('SELECT COUNT(*) as count FROM quiz_attempts WHERE user_id = ? AND quiz_id = ?')
        .get(req.session.userId, quiz.id).count;
      if (pastCount >= maxAttempts) {
        req.session.flash = { type: 'error', message: 'لقد استنفذت جميع المحاولات المتاحة لهذا الاختبار' };
        return res.redirect('/quizzes/' + quiz.id);
      }
    }

    // Check timer
    if (quiz.time_limit > 0) {
      var startTime = req.session['quizStart_' + quiz.id];
      if (!startTime) {
        req.session.flash = { type: 'error', message: 'يرجى بدء الاختبار من صفحة الاختبار' };
        return res.redirect('/quizzes/' + quiz.id);
      }
      var elapsed = Math.floor((Date.now() - startTime) / 1000 / 60);
      if (elapsed > quiz.time_limit) {
        req.session.flash = { type: 'error', message: 'انتهى الوقت المخصص للاختبار' };
        return res.redirect('/quizzes/' + quiz.id);
      }
    }

    const questions = await db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY order_index ASC').all(quiz.id);
    const answers = req.body.answers || {};

    let score = 0;
    const totalQuestions = questions.length;

    const attemptResult = await db.prepare('INSERT INTO quiz_attempts (user_id, quiz_id, total_questions) VALUES (?, ?, ?)')
      .run(req.session.userId, quiz.id, totalQuestions);

    const attemptId = attemptResult.lastInsertRowid;

    for (const q of questions) {
      var userAnswerRaw = answers['q' + q.id];
      var isCorrect = false;
      var storedAnswer = '';
      var qPoints = toSafeInt(q.points) || 1;

      var correctAnswer = q.correct_answer;

      var optMatch = String(q.correct_answer).match(/^option_(\d+)$/);
      var optsList = [];
      if (q.options) {
        try { optsList = JSON.parse(q.options); } catch (e) { optsList = []; }
      }

      if (optMatch && optsList.length > 0) {
        var optIdx = toSafeInt(optMatch[1]);
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
        var tfMapping = { 'true': 'صح', 'false': 'خطأ', 'صح': 'صح', 'خطأ': 'خطأ' };
        isCorrect = (tfMapping[userBool] || userBool) === (tfMapping[correctBool] || correctBool);
      } else {
        storedAnswer = String(userAnswerRaw || '');
        isCorrect = storedAnswer.trim().toLowerCase() === String(correctAnswer).trim().toLowerCase();
      }

      if (isCorrect) score += qPoints;

      await db.prepare('INSERT INTO quiz_answers (attempt_id, question_id, answer, is_correct) VALUES (?, ?, ?, ?)')
        .run(attemptId, q.id, storedAnswer, isCorrect ? 1 : 0);
    }

    var totalPoints = questions.reduce(function(sum, q) { return sum + (toSafeInt(q.points) || 1); }, 0);
    var percentage = totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0;
    var passed = percentage >= quiz.passing_score ? 1 : 0;

    await db.prepare('UPDATE quiz_attempts SET score = ?, passed = ? WHERE id = ?')
      .run(percentage, passed, attemptId);

    delete req.session['quizStart_' + quiz.id];
    return res.redirect('/quizzes/result/' + attemptId);
  } catch(err) {
    next(err);
  }
});

router.get('/result/:attemptId', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const attempt = await db.prepare(`
      SELECT qa.*, q.title as quiz_title, q.passing_score, q.lesson_id
      FROM quiz_attempts qa
      JOIN quizzes q ON qa.quiz_id = q.id
      WHERE qa.id = ? AND qa.user_id = ?
    `).get(toSafeInt(req.params.attemptId), req.session.userId);

    if (!attempt) return res.redirect('/dashboard');

    const questions = await db.prepare(`
      SELECT qq.*, qa2.answer as user_answer, qa2.is_correct
      FROM quiz_questions qq
      LEFT JOIN quiz_answers qa2 ON qq.id = qa2.question_id AND qa2.attempt_id = ?
      WHERE qq.quiz_id = ?
      ORDER BY qq.order_index ASC
    `).all(attempt.id, attempt.quiz_id);

    const lesson = await db.prepare('SELECT l.*, c.slug as course_slug FROM lessons l JOIN courses c ON l.course_id = c.id WHERE l.id = ?')
      .get(attempt.lesson_id);

    return res.render('quizzes/result', { 
      title: 'نتيجة الاختبار', 
      attempt, questions, lesson 
    });
  } catch(err) {
    next(err);
  }
});

router.get('/:id/edit', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const quiz = await db.prepare(`
      SELECT q.*, l.id as lesson_id, c.instructor_id, c.slug as course_slug
      FROM quizzes q
      JOIN lessons l ON q.lesson_id = l.id
      JOIN courses c ON l.course_id = c.id
      WHERE q.id = ?
    `).get(toSafeInt(req.params.id));

    if (!quiz || quiz.instructor_id !== req.session.userId) {
      return res.redirect('/courses/my-courses');
    }

    const questions = await db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY order_index ASC').all(quiz.id);

    return res.render('quizzes/edit', { title: 'تعديل الاختبار', quiz, questions, error: null });
  } catch(err) {
    next(err);
  }
});

router.post('/:id/edit', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const quiz = await db.prepare(`
      SELECT q.*, l.id as lesson_id, c.instructor_id
      FROM quizzes q
      JOIN lessons l ON q.lesson_id = l.id
      JOIN courses c ON l.course_id = c.id
      WHERE q.id = ?
    `).get(toSafeInt(req.params.id));

    if (!quiz || quiz.instructor_id !== req.session.userId) {
      return res.redirect('/courses/my-courses');
    }

    const { title, passing_score, time_limit, max_attempts, questions } = req.body;

    await db.prepare('UPDATE quizzes SET title = ?, passing_score = ?, time_limit = ?, max_attempts = ? WHERE id = ?')
      .run(title, toSafeInt(passing_score) || 70, toSafeInt(time_limit) || 0, toSafeInt(max_attempts) || 0, quiz.id);

    await db.prepare('DELETE FROM quiz_questions WHERE quiz_id = ?').run(quiz.id);

    if (questions && Array.isArray(questions)) {
      for (let index = 0; index < questions.length; index++) {
        const q = questions[index];
        if (q.question_text && q.correct_answer) {
          var opts = q.options || [];
          if (!Array.isArray(opts)) opts = [opts];
          await db.prepare(`
            INSERT INTO quiz_questions (quiz_id, question_text, question_type, options, correct_answer, points, order_index)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            quiz.id,
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

    return res.redirect('/lessons/' + quiz.lesson_id);
  } catch(err) {
    next(err);
  }
});

router.post('/:id/delete', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const quiz = await db.prepare(`
      SELECT q.*, l.id as lesson_id, c.instructor_id
      FROM quizzes q
      JOIN lessons l ON q.lesson_id = l.id
      JOIN courses c ON l.course_id = c.id
      WHERE q.id = ?
    `).get(toSafeInt(req.params.id));

    if (quiz && quiz.instructor_id === req.session.userId) {
      await db.prepare('DELETE FROM quizzes WHERE id = ?').run(quiz.id);
      return res.redirect('/lessons/' + quiz.lesson_id);
    } else {
      return res.redirect('/courses/my-courses');
    }
  } catch(err) {
    next(err);
  }
});

module.exports = router;
