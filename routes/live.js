const express = require('express');
const { getDb, sqlNow } = require('../config/database');
const { isAuthenticated, isInstructor } = require('../middleware/auth');

const router = express.Router();

router.get('/course/:courseId', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const course = await db.prepare('SELECT * FROM courses WHERE id = ?').get(parseInt(req.params.courseId));
    if (!course) return res.redirect('/courses');
    const sessions = await db.prepare(`
      SELECT ls.*, u.name as instructor_name
      FROM live_sessions ls
      JOIN users u ON ls.instructor_id = u.id
      WHERE ls.course_id = ?
      ORDER BY ls.scheduled_at DESC
    `).all(course.id);
    return res.render('live/list', { title: 'الدروس المباشرة - ' + course.title, course, sessions });
  } catch(err) { next(err); }
});

router.get('/create/:courseId', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const course = await db.prepare('SELECT * FROM courses WHERE id = ? AND instructor_id = ?').get(parseInt(req.params.courseId), req.session.userId);
    if (!course) return res.redirect('/courses/my-courses');
    return res.render('live/create', { title: 'إضافة درس مباشر', course, session: null, error: null });
  } catch(err) { next(err); }
});

router.post('/create/:courseId', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const course = await db.prepare('SELECT * FROM courses WHERE id = ? AND instructor_id = ?').get(parseInt(req.params.courseId), req.session.userId);
    if (!course) return res.redirect('/courses/my-courses');
    const { title, description, meeting_url, meeting_id, meeting_password, scheduled_at, duration } = req.body;
    if (!title || !meeting_url || !scheduled_at) {
      return res.render('live/create', { title: 'إضافة درس مباشر', course, session: null, error: 'العنوان ورابط الاجتماع والتاريخ مطلوبون' });
    }
    await db.prepare(`
      INSERT INTO live_sessions (course_id, instructor_id, title, description, meeting_url, meeting_id, meeting_password, scheduled_at, duration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(course.id, req.session.userId, title, description || '', meeting_url, meeting_id || '', meeting_password || '', scheduled_at, parseInt(duration) || 60);
    req.session.flash = { type: 'success', message: 'تم إضافة الدرس المباشر' };
    return res.redirect('/live/course/' + course.id);
  } catch(err) { next(err); }
});

router.get('/:id/edit', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const session = await db.prepare('SELECT * FROM live_sessions WHERE id = ? AND instructor_id = ?').get(parseInt(req.params.id), req.session.userId);
    if (!session) return res.redirect('/courses/my-courses');
    const course = await db.prepare('SELECT * FROM courses WHERE id = ?').get(session.course_id);
    return res.render('live/create', { title: 'تعديل الدرس المباشر', course, session, error: null });
  } catch(err) { next(err); }
});

router.post('/:id/edit', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const session = await db.prepare('SELECT * FROM live_sessions WHERE id = ? AND instructor_id = ?').get(parseInt(req.params.id), req.session.userId);
    if (!session) return res.redirect('/courses/my-courses');
    const { title, description, meeting_url, meeting_id, meeting_password, scheduled_at, duration, recording_url, status } = req.body;
    await db.prepare(`
      UPDATE live_sessions SET title = ?, description = ?, meeting_url = ?, meeting_id = ?, meeting_password = ?,
        scheduled_at = ?, duration = ?, recording_url = ?, status = ?
      WHERE id = ?
    `).run(title || session.title, description ?? session.description, meeting_url || session.meeting_url,
      meeting_id ?? session.meeting_id, meeting_password ?? session.meeting_password,
      scheduled_at || session.scheduled_at, parseInt(duration) || session.duration,
      recording_url ?? session.recording_url, status || session.status, session.id);
    req.session.flash = { type: 'success', message: 'تم تحديث الدرس المباشر' };
    return res.redirect('/live/course/' + session.course_id);
  } catch(err) { next(err); }
});

router.post('/:id/delete', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const session = await db.prepare('SELECT * FROM live_sessions WHERE id = ? AND instructor_id = ?').get(parseInt(req.params.id), req.session.userId);
    if (!session) return res.redirect('/courses/my-courses');
    await db.prepare('DELETE FROM live_sessions WHERE id = ?').run(session.id);
    req.session.flash = { type: 'success', message: 'تم حذف الدرس المباشر' };
    return res.redirect('/live/course/' + session.course_id);
  } catch(err) { next(err); }
});

router.get('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const session = await db.prepare(`
      SELECT ls.*, u.name as instructor_name, c.title as course_title
      FROM live_sessions ls
      JOIN users u ON ls.instructor_id = u.id
      JOIN courses c ON ls.course_id = c.id
      WHERE ls.id = ?
    `).get(parseInt(req.params.id));
    if (!session) return res.redirect('/courses');
    return res.render('live/view', { title: session.title, session });
  } catch(err) { next(err); }
});

module.exports = router;
