const express = require('express');
const { getDb } = require('../config/database');
const { isAuthenticated, isInstructor } = require('../middleware/auth');

const router = express.Router();

router.get('/create/:lessonId', isInstructor, (req, res) => {
  const db = getDb();
  const lesson = db.prepare(`
    SELECT l.*, c.instructor_id, c.title as course_title
    FROM lessons l
    JOIN courses c ON l.course_id = c.id
    WHERE l.id = ?
  `).get(parseInt(req.params.lessonId));

  if (!lesson || lesson.instructor_id !== req.session.userId) {
    return res.redirect('/courses/my-courses');
  }

  res.render('quizzes/create', { title: 'إنشاء اختبار', lesson, error: null });
});

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

  const { title, passing_score, time_limit, questions } = req.body;

  if (!title) {
    return res.render('quizzes/create', { title: 'إنشاء اختبار', lesson, error: 'عنوان الاختبار مطلوب' });
  }

  const quizResult = db.prepare('INSERT INTO quizzes (lesson_id, title, passing_score, time_limit) VALUES (?, ?, ?, ?)')
    .run(lesson.id, title, parseInt(passing_score) || 70, parseInt(time_limit) || 0);

  if (questions && Array.isArray(questions)) {
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

  res.redirect('/lessons/' + lesson.id);
});

router.get('/:id', isAuthenticated, (req, res) => {
  const db = getDb();
  const quiz = db.prepare(`
    SELECT q.*, l.course_id, l.title as lesson_title, c.slug as course_slug, c.instructor_id
    FROM quizzes q
    JOIN lessons l ON q.lesson_id = l.id
    JOIN courses c ON l.course_id = c.id
    WHERE q.id = ?
  `).get(parseInt(req.params.id));

  if (!quiz) return res.status(404).render('error', { title: 'غير موجود', message: 'الاختبار غير موجود', error: null });

  const questions = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY order_index ASC').all(quiz.id);

  const pastAttempts = db.prepare(`
    SELECT * FROM quiz_attempts WHERE user_id = ? AND quiz_id = ? ORDER BY attempted_at DESC
  `).all(req.session.userId, quiz.id);

  const lastAttempt = pastAttempts.length > 0 ? pastAttempts[0] : null;

  res.render('quizzes/take', { 
    title: quiz.title, 
    quiz, questions, 
    lastAttempt, 
    pastAttempts 
  });
});

router.post('/:id/submit', isAuthenticated, (req, res) => {
  const db = getDb();
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(parseInt(req.params.id));
  if (!quiz) return res.status(404).json({ error: 'الاختبار غير موجود' });

  const questions = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY order_index ASC').all(quiz.id);
  const answers = req.body.answers || {};

  let score = 0;
  const totalQuestions = questions.length;

  const attemptResult = db.prepare('INSERT INTO quiz_attempts (user_id, quiz_id, total_questions) VALUES (?, ?, ?)')
    .run(req.session.userId, quiz.id, totalQuestions);

  const attemptId = attemptResult.lastInsertRowid;

  questions.forEach(function(q) {
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

    db.prepare('INSERT INTO quiz_answers (attempt_id, question_id, answer, is_correct) VALUES (?, ?, ?, ?)')
      .run(attemptId, q.id, storedAnswer, isCorrect ? 1 : 0);
  });

  var totalPoints = questions.reduce(function(sum, q) { return sum + (parseInt(q.points, 10) || 1); }, 0);
  var percentage = totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0;
  var passed = percentage >= quiz.passing_score ? 1 : 0;

  db.prepare('UPDATE quiz_attempts SET score = ?, passed = ? WHERE id = ?')
    .run(percentage, passed, attemptId);

  res.redirect('/quizzes/result/' + attemptId);
});

router.get('/result/:attemptId', isAuthenticated, (req, res) => {
  const db = getDb();
  const attempt = db.prepare(`
    SELECT qa.*, q.title as quiz_title, q.passing_score, q.lesson_id
    FROM quiz_attempts qa
    JOIN quizzes q ON qa.quiz_id = q.id
    WHERE qa.id = ? AND qa.user_id = ?
  `).get(parseInt(req.params.attemptId), req.session.userId);

  if (!attempt) return res.redirect('/dashboard');

  const questions = db.prepare(`
    SELECT qq.*, qa2.answer as user_answer, qa2.is_correct
    FROM quiz_questions qq
    LEFT JOIN quiz_answers qa2 ON qq.id = qa2.question_id AND qa2.attempt_id = ?
    WHERE qq.quiz_id = ?
    ORDER BY qq.order_index ASC
  `).all(attempt.id, attempt.quiz_id);

  const lesson = db.prepare('SELECT l.*, c.slug as course_slug FROM lessons l JOIN courses c ON l.course_id = c.id WHERE l.id = ?')
    .get(attempt.lesson_id);

  res.render('quizzes/result', { 
    title: 'نتيجة الاختبار', 
    attempt, questions, lesson 
  });
});

router.get('/:id/edit', isInstructor, (req, res) => {
  const db = getDb();
  const quiz = db.prepare(`
    SELECT q.*, l.id as lesson_id, c.instructor_id, c.slug as course_slug
    FROM quizzes q
    JOIN lessons l ON q.lesson_id = l.id
    JOIN courses c ON l.course_id = c.id
    WHERE q.id = ?
  `).get(parseInt(req.params.id));

  if (!quiz || quiz.instructor_id !== req.session.userId) {
    return res.redirect('/courses/my-courses');
  }

  const questions = db.prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY order_index ASC').all(quiz.id);

  res.render('quizzes/edit', { title: 'تعديل الاختبار', quiz, questions, error: null });
});

router.post('/:id/edit', isInstructor, (req, res) => {
  const db = getDb();
  const quiz = db.prepare(`
    SELECT q.*, l.id as lesson_id, c.instructor_id
    FROM quizzes q
    JOIN lessons l ON q.lesson_id = l.id
    JOIN courses c ON l.course_id = c.id
    WHERE q.id = ?
  `).get(parseInt(req.params.id));

  if (!quiz || quiz.instructor_id !== req.session.userId) {
    return res.redirect('/courses/my-courses');
  }

  const { title, passing_score, time_limit, questions } = req.body;

  db.prepare('UPDATE quizzes SET title = ?, passing_score = ?, time_limit = ? WHERE id = ?')
    .run(title, parseInt(passing_score) || 70, parseInt(time_limit) || 0, quiz.id);

  db.prepare('DELETE FROM quiz_questions WHERE quiz_id = ?').run(quiz.id);

  if (questions && Array.isArray(questions)) {
    questions.forEach(function(q, index) {
      if (q.question_text && q.correct_answer) {
        var opts = q.options || [];
        if (!Array.isArray(opts)) opts = [opts];
        db.prepare(`
          INSERT INTO quiz_questions (quiz_id, question_text, question_type, options, correct_answer, points, order_index)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          quiz.id,
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

  res.redirect('/lessons/' + quiz.lesson_id);
});

router.post('/:id/delete', isInstructor, (req, res) => {
  const db = getDb();
  const quiz = db.prepare(`
    SELECT q.*, l.id as lesson_id, c.instructor_id
    FROM quizzes q
    JOIN lessons l ON q.lesson_id = l.id
    JOIN courses c ON l.course_id = c.id
    WHERE q.id = ?
  `).get(parseInt(req.params.id));

  if (quiz && quiz.instructor_id === req.session.userId) {
    db.prepare('DELETE FROM quizzes WHERE id = ?').run(quiz.id);
    res.redirect('/lessons/' + quiz.lesson_id);
  } else {
    res.redirect('/courses/my-courses');
  }
});

module.exports = router;
