const express = require('express');
const { getDb } = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');
const { createNotification } = require('../config/notifications');

const router = express.Router();

router.post('/lesson/:lessonId', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const lesson = await db.prepare('SELECT l.*, c.instructor_id, c.title as course_title FROM lessons l JOIN courses c ON l.course_id = c.id WHERE l.id = ?').get(parseInt(req.params.lessonId));
    if (!lesson) return res.status(404).json({ error: 'الدرس غير موجود' });

    const { content } = req.body;
    var safeContent = String(content || '').trim();
    if (!safeContent) {
      return res.status(400).json({ error: 'نص التعليق مطلوب' });
    }

    await db.prepare('INSERT INTO lesson_comments (lesson_id, user_id, content) VALUES (?, ?, ?)')
      .run(lesson.id, req.session.userId, safeContent);

    if (lesson.instructor_id !== req.session.userId) {
      await createNotification(lesson.instructor_id, 'comment', 'تعليق جديد على درس', req.session.userName + ' علق على درس ' + lesson.title, lesson.id, 'lesson');
    }

    return res.redirect('/lessons/' + lesson.id);
  } catch(err) { next(err); }
});

router.post('/:id/delete', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const comment = await db.prepare('SELECT lc.*, l.course_id, c.instructor_id FROM lesson_comments lc JOIN lessons l ON lc.lesson_id = l.id JOIN courses c ON l.course_id = c.id WHERE lc.id = ?').get(parseInt(req.params.id));
    if (!comment) return res.status(404).json({ error: 'التعليق غير موجود' });

    if (comment.user_id !== req.session.userId && comment.instructor_id !== req.session.userId && req.session.role !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح' });
    }

    await db.prepare('DELETE FROM lesson_comments WHERE id = ?').run(comment.id);
    return res.redirect('/lessons/' + comment.lesson_id);
  } catch(err) { next(err); }
});

module.exports = router;
