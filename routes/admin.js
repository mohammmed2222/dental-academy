const express = require('express');
const bcrypt = require('bcryptjs');
const slugify = require('slugify');
const { getDb } = require('../config/database');
const { isAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', isAdmin, (req, res) => {
  const db = getDb();
  const stats = {
    users: db.prepare('SELECT COUNT(*) as count FROM users').get().count,
    students: db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student'").get().count,
    instructors: db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'instructor'").get().count,
    courses: db.prepare('SELECT COUNT(*) as count FROM courses').get().count,
    published: db.prepare("SELECT COUNT(*) as count FROM courses WHERE status = 'published'").get().count,
    enrollments: db.prepare('SELECT COUNT(*) as count FROM enrollments').get().count,
    lessons: db.prepare('SELECT COUNT(*) as count FROM lessons').get().count,
  };

  const recentUsers = db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 5').all();
  const recentCourses = db.prepare(`
    SELECT c.*, u.name as instructor_name FROM courses c
    JOIN users u ON c.instructor_id = u.id
    ORDER BY c.created_at DESC LIMIT 5
  `).all();

  res.render('admin/index', { title: 'لوحة المشرف', stats, recentUsers, recentCourses });
});

router.get('/users', isAdmin, (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  res.render('admin/users', { title: 'إدارة المستخدمين', users });
});

router.post('/users/create', isAdmin, (req, res) => {
  const db = getDb();
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    return res.redirect('/admin/users');
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.redirect('/admin/users');

  const hashedPassword = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run(name, email, hashedPassword, role || 'student');

  res.redirect('/admin/users');
});

router.post('/users/:id/delete', isAdmin, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(parseInt(req.params.id));
  if (user && user.role !== 'admin') {
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  }
  res.redirect('/admin/users');
});

router.post('/users/:id/role', isAdmin, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(parseInt(req.params.id));
  if (user && user.role !== 'admin') {
    db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(req.body.role, user.id);
  }
  res.redirect('/admin/users');
});

router.get('/courses', isAdmin, (req, res) => {
  const db = getDb();
  const courses = db.prepare(`
    SELECT c.*, u.name as instructor_name, cat.name as category_name,
      (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as student_count,
      (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as lesson_count
    FROM courses c
    JOIN users u ON c.instructor_id = u.id
    LEFT JOIN categories cat ON c.category_id = cat.id
    ORDER BY c.created_at DESC
  `).all();

  res.render('admin/courses', { title: 'إدارة الكورسات', courses });
});

router.get('/courses/:id/edit', isAdmin, (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT c.*, u.name as instructor_name FROM courses c JOIN users u ON c.instructor_id = u.id WHERE c.id = ?').get(parseInt(req.params.id));
  if (!course) return res.redirect('/admin/courses');
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/course-edit', { title: 'تعديل الدورة', course, categories, error: null });
});

router.post('/courses/:id/edit', isAdmin, (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(parseInt(req.params.id));
  if (!course) return res.redirect('/admin/courses');

  const { title, description, short_description, category_id, level, price, status } = req.body;
  if (!title) return res.redirect('/admin/courses/' + req.params.id + '/edit');

  db.prepare(`
    UPDATE courses SET title = ?, description = ?, short_description = ?,
      category_id = ?, level = ?, price = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(title, description || '', short_description || '', category_id || null, level || 'beginner', parseFloat(price) || 0, status || 'draft', course.id);

  res.redirect('/admin/courses');
});

router.post('/courses/:id/delete', isAdmin, (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(parseInt(req.params.id));
  if (course) {
    db.prepare('DELETE FROM courses WHERE id = ?').run(course.id);
  }
  res.redirect('/admin/courses');
});

router.post('/courses/:id/toggle-status', isAdmin, (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(parseInt(req.params.id));
  if (course) {
    const newStatus = course.status === 'published' ? 'draft' : 'published';
    db.prepare('UPDATE courses SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newStatus, course.id);
  }
  res.redirect('/admin/courses');
});

router.get('/categories', isAdmin, (req, res) => {
  const db = getDb();
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/categories', { title: 'التصنيفات', categories, error: null });
});

router.post('/categories/create', isAdmin, (req, res) => {
  const db = getDb();
  const { name, description } = req.body;
  if (!name) return res.redirect('/admin/categories');

  const slug = slugify(name, { lower: true, replacement: '-' });
  
  try {
    db.prepare('INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)').run(name, slug, description || '');
  } catch (e) {
    // slug or name might be duplicate
  }
  
  res.redirect('/admin/categories');
});

router.post('/categories/:id/delete', isAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM categories WHERE id = ?').run(parseInt(req.params.id));
  res.redirect('/admin/categories');
});

module.exports = router;
