const express = require('express');
const { getDb, sqlNow, isUsingPg } = require('../config/database');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const cohorts = await db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM cohort_students WHERE cohort_id = c.id) as student_count,
        (SELECT COUNT(*) FROM cohort_courses WHERE cohort_id = c.id) as course_count,
        u.name as creator_name
      FROM cohorts c
      JOIN users u ON c.created_by = u.id
      ORDER BY c.created_at DESC
    `).all();
    return res.render('cohorts/list', { title: 'المجموعات', cohorts });
  } catch(err) { next(err); }
});

router.get('/create', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const students = await db.prepare("SELECT id, name, email FROM users WHERE role = 'student' ORDER BY name").all();
    const courses = await db.prepare("SELECT id, title FROM courses ORDER BY title").all();
    return res.render('cohorts/create', { title: 'إضافة مجموعة', cohort: null, students, courses, selectedStudents: [], selectedCourses: [], error: null });
  } catch(err) { next(err); }
});

router.post('/create', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const { name, description, start_date, end_date, student_ids, course_ids } = req.body;
    if (!name) {
      const students = await db.prepare("SELECT id, name, email FROM users WHERE role = 'student' ORDER BY name").all();
      const courses = await db.prepare("SELECT id, title FROM courses ORDER BY title").all();
      return res.render('cohorts/create', { title: 'إضافة مجموعة', cohort: null, students, courses, selectedStudents: [], selectedCourses: [], error: 'اسم المجموعة مطلوب' });
    }
    const result = await db.prepare('INSERT INTO cohorts (name, description, start_date, end_date, created_by) VALUES (?, ?, ?, ?, ?)').run(name, description || '', start_date || null, end_date || null, req.session.userId);
    const cohortId = result.lastInsertRowid;
    var insertStudent = isUsingPg() ? 'INSERT INTO cohort_students (cohort_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING' : 'INSERT OR IGNORE INTO cohort_students (cohort_id, user_id) VALUES (?, ?)';
    var insertCourse = isUsingPg() ? 'INSERT INTO cohort_courses (cohort_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING' : 'INSERT OR IGNORE INTO cohort_courses (cohort_id, course_id) VALUES (?, ?)';
    if (student_ids) {
      const ids = Array.isArray(student_ids) ? student_ids : [student_ids];
      for (const sid of ids) {
        await db.prepare(insertStudent).run(cohortId, parseInt(sid));
      }
    }
    if (course_ids) {
      const ids = Array.isArray(course_ids) ? course_ids : [course_ids];
      for (const cid of ids) {
        await db.prepare(insertCourse).run(cohortId, parseInt(cid));
      }
    }
    req.session.flash = { type: 'success', message: 'تم إنشاء المجموعة' };
    return res.redirect('/cohorts');
  } catch(err) { next(err); }
});

router.get('/:id/edit', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const cohort = await db.prepare('SELECT * FROM cohorts WHERE id = ?').get(parseInt(req.params.id));
    if (!cohort) return res.redirect('/cohorts');
    const students = await db.prepare("SELECT id, name, email FROM users WHERE role = 'student' ORDER BY name").all();
    const courses = await db.prepare("SELECT id, title FROM courses ORDER BY title").all();
    const selectedStudents = (await db.prepare('SELECT user_id FROM cohort_students WHERE cohort_id = ?').all(cohort.id)).map(r => r.user_id);
    const selectedCourses = (await db.prepare('SELECT course_id FROM cohort_courses WHERE cohort_id = ?').all(cohort.id)).map(r => r.course_id);
    return res.render('cohorts/create', { title: 'تعديل المجموعة', cohort, students, courses, selectedStudents, selectedCourses, error: null });
  } catch(err) { next(err); }
});

router.post('/:id/edit', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const { name, description, start_date, end_date, student_ids, course_ids } = req.body;
    const cohort = await db.prepare('SELECT * FROM cohorts WHERE id = ?').get(parseInt(req.params.id));
    if (!cohort) return res.redirect('/cohorts');
    if (!name) {
      const students = await db.prepare("SELECT id, name, email FROM users WHERE role = 'student' ORDER BY name").all();
      const courses = await db.prepare("SELECT id, title FROM courses ORDER BY title").all();
      const selectedStudents = (await db.prepare('SELECT user_id FROM cohort_students WHERE cohort_id = ?').all(cohort.id)).map(r => r.user_id);
      const selectedCourses = (await db.prepare('SELECT course_id FROM cohort_courses WHERE cohort_id = ?').all(cohort.id)).map(r => r.course_id);
      return res.render('cohorts/create', { title: 'تعديل المجموعة', cohort, students, courses, selectedStudents, selectedCourses, error: 'اسم المجموعة مطلوب' });
    }
    await db.prepare(`UPDATE cohorts SET name = ?, description = ?, start_date = ?, end_date = ? WHERE id = ?`).run(name, description || '', start_date || null, end_date || null, cohort.id);
    await db.prepare('DELETE FROM cohort_students WHERE cohort_id = ?').run(cohort.id);
    await db.prepare('DELETE FROM cohort_courses WHERE cohort_id = ?').run(cohort.id);
    if (student_ids) {
      const ids = Array.isArray(student_ids) ? student_ids : [student_ids];
      for (const sid of ids) {
        await db.prepare('INSERT INTO cohort_students (cohort_id, user_id) VALUES (?, ?)').run(cohort.id, parseInt(sid));
      }
    }
    if (course_ids) {
      const ids = Array.isArray(course_ids) ? course_ids : [course_ids];
      for (const cid of ids) {
        await db.prepare('INSERT INTO cohort_courses (cohort_id, course_id) VALUES (?, ?)').run(cohort.id, parseInt(cid));
      }
    }
    req.session.flash = { type: 'success', message: 'تم تحديث المجموعة' };
    return res.redirect('/cohorts');
  } catch(err) { next(err); }
});

router.post('/:id/delete', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare('DELETE FROM cohorts WHERE id = ?').run(parseInt(req.params.id));
    req.session.flash = { type: 'success', message: 'تم حذف المجموعة' };
    return res.redirect('/cohorts');
  } catch(err) { next(err); }
});

router.get('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const cohort = await db.prepare(`
      SELECT c.*, u.name as creator_name,
        (SELECT COUNT(*) FROM cohort_students WHERE cohort_id = c.id) as student_count
      FROM cohorts c
      JOIN users u ON c.created_by = u.id
      WHERE c.id = ?
    `).get(parseInt(req.params.id));
    if (!cohort) return res.redirect('/cohorts');
    const students = await db.prepare(`
      SELECT u.id, u.name, u.email, u.avatar, cs.enrolled_at
      FROM cohort_students cs
      JOIN users u ON cs.user_id = u.id
      WHERE cs.cohort_id = ?
      ORDER BY u.name
    `).all(cohort.id);
    const courses = await db.prepare(`
      SELECT co.*, cc.id as link_id,
        (SELECT COUNT(*) FROM enrollments WHERE course_id = co.id AND user_id IN (SELECT user_id FROM cohort_students WHERE cohort_id = ?)) as enrolled_count
      FROM cohort_courses cc
      JOIN courses co ON cc.course_id = co.id
      WHERE cc.cohort_id = ?
    `).all(cohort.id, cohort.id);
    return res.render('cohorts/view', { title: cohort.name, cohort, students, courses });
  } catch(err) { next(err); }
});

module.exports = router;
