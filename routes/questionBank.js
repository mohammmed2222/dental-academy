const express = require('express');
const { getDb } = require('../config/database');
const { isInstructor } = require('../middleware/auth');

const router = express.Router();

router.get('/', isInstructor, (req, res) => {
  const db = getDb();
  const { search, category } = req.query;
  let query = 'SELECT * FROM question_bank WHERE instructor_id = ?';
  const params = [req.session.userId];

  if (category && category.trim()) {
    query += ' AND category LIKE ?';
    params.push('%' + category.trim() + '%');
  }

  if (search && search.trim()) {
    query += ' AND question_text LIKE ?';
    params.push('%' + search.trim() + '%');
  }

  query += ' ORDER BY created_at DESC';

  const questions = db.prepare(query).all(params);

  const categories = db.prepare(
    'SELECT DISTINCT category FROM question_bank WHERE instructor_id = ? AND category != "" ORDER BY category'
  ).all(req.session.userId);

  res.render('questionBank/list', { title: 'بنك الأسئلة', questions, categories, search, category });
});

router.get('/create', isInstructor, (req, res) => {
  res.render('questionBank/create', { title: 'إضافة سؤال', question: null, error: null });
});

router.post('/create', isInstructor, (req, res) => {
  const db = getDb();
  const { question_text, question_type, options, correct_answer, points, category } = req.body;

  if (!question_text || !correct_answer) {
    return res.render('questionBank/create', { title: 'إضافة سؤال', question: null, error: 'نص السؤال والإجابة الصحيحة مطلوبان' });
  }

  var opts = [];
  if (question_type === 'multiple_choice' || question_type === 'multiple_correct') {
    opts = Array.isArray(options) ? options.filter(Boolean) : [options].filter(Boolean);
  }

  db.prepare(`
    INSERT INTO question_bank (instructor_id, question_text, question_type, options, correct_answer, points, category)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.session.userId,
    question_text,
    question_type || 'multiple_choice',
    JSON.stringify(opts),
    correct_answer,
    parseInt(points) || 1,
    category || ''
  );

  req.session.flash = { type: 'success', message: 'تم إضافة السؤال إلى بنك الأسئلة' };
  res.redirect('/question-bank');
});

router.get('/:id/edit', isInstructor, (req, res) => {
  const db = getDb();
  const question = db.prepare('SELECT * FROM question_bank WHERE id = ? AND instructor_id = ?')
    .get(parseInt(req.params.id), req.session.userId);

  if (!question) {
    req.session.flash = { type: 'error', message: 'السؤال غير موجود' };
    return res.redirect('/question-bank');
  }

  res.render('questionBank/create', { title: 'تعديل السؤال', question, error: null });
});

router.post('/:id/edit', isInstructor, (req, res) => {
  const db = getDb();
  const question = db.prepare('SELECT * FROM question_bank WHERE id = ? AND instructor_id = ?')
    .get(parseInt(req.params.id), req.session.userId);

  if (!question) {
    req.session.flash = { type: 'error', message: 'السؤال غير موجود' };
    return res.redirect('/question-bank');
  }

  const { question_text, question_type, options, correct_answer, points, category } = req.body;

  if (!question_text || !correct_answer) {
    return res.render('questionBank/create', { title: 'تعديل السؤال', question, error: 'نص السؤال والإجابة الصحيحة مطلوبان' });
  }

  var opts = [];
  if (question_type === 'multiple_choice' || question_type === 'multiple_correct') {
    opts = Array.isArray(options) ? options.filter(Boolean) : [options].filter(Boolean);
  }

  db.prepare(`
    UPDATE question_bank SET question_text = ?, question_type = ?, options = ?, correct_answer = ?, points = ?, category = ?
    WHERE id = ? AND instructor_id = ?
  `).run(
    question_text,
    question_type || 'multiple_choice',
    JSON.stringify(opts),
    correct_answer,
    parseInt(points) || 1,
    category || '',
    question.id,
    req.session.userId
  );

  req.session.flash = { type: 'success', message: 'تم تحديث السؤال' };
  res.redirect('/question-bank');
});

router.post('/:id/delete', isInstructor, (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM question_bank WHERE id = ? AND instructor_id = ?')
    .run(parseInt(req.params.id), req.session.userId);

  req.session.flash = { type: 'success', message: 'تم حذف السؤال' };
  res.redirect('/question-bank');
});

router.get('/select/:quizId', isInstructor, (req, res) => {
  const db = getDb();
  const questions = db.prepare(
    'SELECT * FROM question_bank WHERE instructor_id = ? ORDER BY created_at DESC'
  ).all(req.session.userId);

  res.json({ questions });
});

module.exports = router;
