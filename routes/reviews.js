const express = require('express');
const { getDb, sqlNow } = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');
const { toSafeInt } = require('../config/security');

const router = express.Router();

router.get('/course/:courseId', async (req, res, next) => {
  try {
    const db = getDb();
    const courseId = toSafeInt(req.params.courseId);
    const course = await db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
    if (!course) {
      return res.status(404).render('error', { title: 'غير موجود', message: 'الكورس غير موجود', error: null });
    }
    if (course.status !== 'published' && req.session.role !== 'admin' && (req.session.userId !== course.instructor_id)) {
      return res.redirect('/courses');
    }
    const reviews = await db.prepare(`
      SELECT cr.*, u.name as user_name, u.avatar as user_avatar
      FROM course_reviews cr
      JOIN users u ON cr.user_id = u.id
      WHERE cr.course_id = ?
      ORDER BY cr.created_at DESC
    `).all(courseId);
    const avgRating = await db.prepare(`
      SELECT AVG(rating) as avg_rating, COUNT(*) as total_reviews
      FROM course_reviews
      WHERE course_id = ?
    `).get(courseId);
    return res.render('reviews/list', { title: 'تقييمات الكورس', course, reviews, avgRating });
  } catch(err) { next(err); }
});

router.get('/add/:courseId', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const course = await db.prepare('SELECT * FROM courses WHERE id = ?').get(toSafeInt(req.params.courseId));
    if (!course) {
      return res.status(404).render('error', { title: 'غير موجود', message: 'الكورس غير موجود', error: null });
    }
    if (course.status !== 'published' && req.session.role !== 'admin' && (req.session.userId !== course.instructor_id)) {
      return res.redirect('/courses');
    }
    const enrollment = await db.prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.session.userId, course.id);
    const alreadyReviewed = await db.prepare('SELECT * FROM course_reviews WHERE course_id = ? AND user_id = ?').get(course.id, req.session.userId);
    if (!enrollment && req.session.role !== 'admin' && req.session.userId !== course.instructor_id) {
      return res.redirect('/courses/' + course.slug);
    }
    if (alreadyReviewed) {
      return res.redirect('/reviews/course/' + course.id);
    }
    return res.render('reviews/add', { title: 'تقييم الكورس', course, error: null });
  } catch(err) { next(err); }
});

router.post('/add/:courseId', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const course = await db.prepare('SELECT * FROM courses WHERE id = ?').get(toSafeInt(req.params.courseId));
    if (!course) {
      return res.status(404).render('error', { title: 'غير موجود', message: 'الكورس غير موجود', error: null });
    }
    if (course.status !== 'published' && req.session.role !== 'admin' && (req.session.userId !== course.instructor_id)) {
      return res.redirect('/courses');
    }
    const { rating, review_text } = req.body;
    const enrollment = await db.prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.session.userId, course.id);
    const alreadyReviewed = await db.prepare('SELECT * FROM course_reviews WHERE course_id = ? AND user_id = ?').get(course.id, req.session.userId);
    if (!enrollment && req.session.role !== 'admin' && req.session.userId !== course.instructor_id) {
      return res.redirect('/courses/' + course.slug);
    }
    if (alreadyReviewed) {
      return res.redirect('/reviews/course/' + course.id);
    }
    if (!rating || rating < 1 || rating > 5) {
      return res.render('reviews/add', { title: 'تقييم الكورس', course, error: 'التقييم يجب أن يكون بين 1 و 5' });
    }
    await db.prepare(`
      INSERT INTO course_reviews (course_id, user_id, rating, review, created_at)
      VALUES (?, ?, ?, ?, ${sqlNow()})
    `).run(course.id, req.session.userId, toSafeInt(rating), review_text || '');
    return res.redirect('/reviews/course/' + course.id);
  } catch(err) { next(err); }
});

router.post('/:id/delete', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const review = await db.prepare(`
      SELECT cr.*, c.instructor_id
      FROM course_reviews cr
      JOIN courses c ON cr.course_id = c.id
      WHERE cr.id = ?
    `).get(toSafeInt(req.params.id));
    if (!review) {
      return res.redirect('/courses');
    }
    if (req.session.userId !== review.instructor_id && req.session.role !== 'admin') {
      return res.redirect('/courses');
    }
    await db.prepare('DELETE FROM course_reviews WHERE id = ?').run(review.id);
    return res.redirect('/reviews/course/' + review.course_id);
  } catch(err) { next(err); }
});

module.exports = router;
