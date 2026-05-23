const express = require('express');
const { getDb } = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');

const router = express.Router();

// List reviews for a course
router.get('/course/:courseId', (req, res) => {
  const db = getDb();
  const courseId = parseInt(req.params.courseId);
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
  if (!course) {
    return res.status(404).render('error', { title: 'غير موجود', message: 'الكورس غير موجود', error: null });
  }
  if (course.status !== 'published' && req.session.role !== 'admin' && (req.session.userId !== course.instructor_id)) {
    return res.redirect('/courses');
  }
  const reviews = db.prepare(`
    SELECT cr.*, u.name as user_name, u.avatar as user_avatar
    FROM course_reviews cr
    JOIN users u ON cr.user_id = u.id
    WHERE cr.course_id = ?
    ORDER BY cr.created_at DESC
  `).all(courseId);
  const avgRating = db.prepare(`
    SELECT AVG(rating) as avg_rating, COUNT(*) as total_reviews
    FROM course_reviews
    WHERE course_id = ?
  `).get(courseId);
  res.render('reviews/list', { title: 'تقييمات الكورس', course, reviews, avgRating });
});

// Add review form
router.get('/add/:courseId', isAuthenticated, (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(parseInt(req.params.courseId));
  if (!course) {
    return res.status(404).render('error', { title: 'غير موجود', message: 'الكورس غير موجود', error: null });
  }
  if (course.status !== 'published' && req.session.role !== 'admin' && (req.session.userId !== course.instructor_id)) {
    return res.redirect('/courses');
  }
  // Check if user is enrolled
  const enrollment = db.prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.session.userId, course.id);
  const alreadyReviewed = db.prepare('SELECT * FROM course_reviews WHERE course_id = ? AND user_id = ?').get(course.id, req.session.userId);
  if (!enrollment && req.session.role !== 'admin' && req.session.userId !== course.instructor_id) {
    return res.redirect('/courses/' + course.slug);
  }
  if (alreadyReviewed) {
    return res.redirect('/reviews/course/' + course.id);
  }
  res.render('reviews/add', { title: 'تقييم الكورس', course, error: null });
});

// Add review
router.post('/add/:courseId', isAuthenticated, (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(parseInt(req.params.courseId));
  if (!course) {
    return res.status(404).render('error', { title: 'غير موجود', message: 'الكورس غير موجود', error: null });
  }
  if (course.status !== 'published' && req.session.role !== 'admin' && (req.session.userId !== course.instructor_id)) {
    return res.redirect('/courses');
  }
  const { rating, review_text } = req.body;
  const enrollment = db.prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.session.userId, course.id);
  const alreadyReviewed = db.prepare('SELECT * FROM course_reviews WHERE course_id = ? AND user_id = ?').get(course.id, req.session.userId);
  if (!enrollment && req.session.role !== 'admin' && req.session.userId !== course.instructor_id) {
    return res.redirect('/courses/' + course.slug);
  }
  if (alreadyReviewed) {
    return res.redirect('/reviews/course/' + course.id);
  }
  if (!rating || rating < 1 || rating > 5) {
    return res.render('reviews/add', { title: 'تقييم الكورس', course, error: 'التقييم يجب أن يكون بين 1 و 5' });
  }
  db.prepare(`
    INSERT INTO course_reviews (course_id, user_id, rating, review_text, created_at, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(course.id, req.session.userId, parseInt(rating), review_text || '');
  res.redirect('/reviews/course/' + course.id);
});

// Delete review (instructor or admin only)
router.post('/:id/delete', isAuthenticated, (req, res) => {
  const db = getDb();
  const review = db.prepare(`
    SELECT cr.*, c.instructor_id
    FROM course_reviews cr
    JOIN courses c ON cr.course_id = c.id
    WHERE cr.id = ?
  `).get(parseInt(req.params.id));
  if (!review) {
    return res.redirect('/courses');
  }
  if (req.session.userId !== review.instructor_id && req.session.role !== 'admin') {
    return res.redirect('/courses');
  }
  db.prepare('DELETE FROM course_reviews WHERE id = ?').run(review.id);
  res.redirect('/reviews/course/' + review.course_id);
});

module.exports = router;