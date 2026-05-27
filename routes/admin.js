const express = require('express');
const bcrypt = require('bcryptjs');
const slugify = require('slugify');
const { getDb } = require('../config/database');
const { sqlNow } = require('../config/database');
const { isAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const stats = {
      users: Number((await db.prepare('SELECT COUNT(*) as count FROM users').get()).count),
      students: Number((await db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student'").get()).count),
      instructors: Number((await db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'instructor'").get()).count),
      courses: Number((await db.prepare('SELECT COUNT(*) as count FROM courses').get()).count),
      published: Number((await db.prepare("SELECT COUNT(*) as count FROM courses WHERE status = 'published'").get()).count),
      enrollments: Number((await db.prepare('SELECT COUNT(*) as count FROM enrollments').get()).count),
      lessons: Number((await db.prepare('SELECT COUNT(*) as count FROM lessons').get()).count),
    };

    const recentUsers = await db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 5').all();
    const recentCourses = await db.prepare(`
      SELECT c.*, u.name as instructor_name FROM courses c
      JOIN users u ON c.instructor_id = u.id
      ORDER BY c.created_at DESC LIMIT 5
    `).all();

    return res.render('admin/index', { title: 'لوحة المشرف', stats, recentUsers, recentCourses });
  } catch(err) {
    next(err);
  }
});

router.get('/users', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    let total, users;
    if (search) {
      var s = '%' + search + '%';
      total = Number((await db.prepare('SELECT COUNT(*) as count FROM users WHERE name LIKE ? OR email LIKE ?').get(s, s)).count);
      users = await db.prepare('SELECT * FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(s, s, limit, offset);
    } else {
      total = Number((await db.prepare('SELECT COUNT(*) as count FROM users').get()).count);
      users = await db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
    }
    const totalPages = Math.ceil(total / limit);
    return res.render('admin/users', { title: 'إدارة المستخدمين', users, page, totalPages, search });
  } catch(err) {
    next(err);
  }
});

router.post('/users/create', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.redirect('/admin/users');
    }

    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.redirect('/admin/users');

    const hashedPassword = bcrypt.hashSync(password, 10);
    await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(name, email, hashedPassword, role || 'student');

    return res.redirect('/admin/users');
  } catch(err) {
    next(err);
  }
});

router.post('/users/:id/delete', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(parseInt(req.params.id));
    if (user && user.role !== 'admin' && user.id !== req.session.userId) {
      await db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    }
    return res.redirect('/admin/users');
  } catch(err) {
    next(err);
  }
});

router.post('/users/:id/role', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(parseInt(req.params.id));
    if (user && user.role !== 'admin') {
      var allowedRoles = ['student', 'instructor', 'admin'];
      var newRole = allowedRoles.indexOf(req.body.role) !== -1 ? req.body.role : user.role;
      await db.prepare(`UPDATE users SET role = ?, updated_at = ${sqlNow()} WHERE id = ?`)
        .run(newRole, user.id);
    }
    return res.redirect('/admin/users');
  } catch(err) {
    next(err);
  }
});

router.get('/courses', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;
    const total = (await db.prepare('SELECT COUNT(*) as count FROM courses').get()).count;
    const totalPages = Math.ceil(total / limit);
    const courses = await db.prepare(`
      SELECT c.*, u.name as instructor_name, cat.name as category_name,
        (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as student_count,
        (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as lesson_count
      FROM courses c
      JOIN users u ON c.instructor_id = u.id
      LEFT JOIN categories cat ON c.category_id = cat.id
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    return res.render('admin/courses', { title: 'إدارة الكورسات', courses, page, totalPages });
  } catch(err) {
    next(err);
  }
});

router.get('/courses/:id/edit', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const course = await db.prepare('SELECT c.*, u.name as instructor_name FROM courses c JOIN users u ON c.instructor_id = u.id WHERE c.id = ?').get(parseInt(req.params.id));
    if (!course) return res.redirect('/admin/courses');
    const categories = await db.prepare('SELECT * FROM categories ORDER BY name').all();
    return res.render('admin/course-edit', { title: 'تعديل الدورة', course, categories, error: null });
  } catch(err) {
    next(err);
  }
});

router.post('/courses/:id/edit', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const course = await db.prepare('SELECT * FROM courses WHERE id = ?').get(parseInt(req.params.id));
    if (!course) return res.redirect('/admin/courses');

    const { title, description, short_description, category_id, level, price, status } = req.body;
    if (!title) return res.redirect('/admin/courses/' + req.params.id + '/edit');

    await db.prepare(`
      UPDATE courses SET title = ?, description = ?, short_description = ?,
        category_id = ?, level = ?, price = ?, status = ?, updated_at = ${sqlNow()}
      WHERE id = ?
    `).run(title, description || '', short_description || '', category_id || null, level || 'beginner', parseFloat(price) || 0, status || 'draft', course.id);

    return res.redirect('/admin/courses');
  } catch(err) {
    next(err);
  }
});

router.post('/courses/:id/delete', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const course = await db.prepare('SELECT * FROM courses WHERE id = ?').get(parseInt(req.params.id));
    if (course) {
      await db.prepare('DELETE FROM courses WHERE id = ?').run(course.id);
    }
    return res.redirect('/admin/courses');
  } catch(err) {
    next(err);
  }
});

router.post('/courses/:id/toggle-status', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const course = await db.prepare('SELECT * FROM courses WHERE id = ?').get(parseInt(req.params.id));
    if (course) {
      const newStatus = course.status === 'published' ? 'draft' : 'published';
      await db.prepare(`UPDATE courses SET status = ?, updated_at = ${sqlNow()} WHERE id = ?`).run(newStatus, course.id);
    }
    return res.redirect('/admin/courses');
  } catch(err) {
    next(err);
  }
});

router.get('/categories', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const categories = await db.prepare('SELECT * FROM categories ORDER BY name').all();
    return res.render('admin/categories', { title: 'التصنيفات', categories, error: null });
  } catch(err) {
    next(err);
  }
});

router.post('/categories/create', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const { name, description } = req.body;
    if (!name) return res.redirect('/admin/categories');

    const slug = slugify(name, { lower: true, replacement: '-' });
    
    const existing = await db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
    if (existing) {
      const categories = await db.prepare('SELECT * FROM categories ORDER BY name').all();
      return res.render('admin/categories', { title: 'التصنيفات', categories, error: 'التصنيف موجود بالفعل' });
    }
    
    try {
      await db.prepare('INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)').run(name, slug, description || '');
    } catch (e) {
      req.session.flash = { type: 'error', message: 'فشل إنشاء التصنيف' };
    }
    
    return res.redirect('/admin/categories');
  } catch(err) {
    next(err);
  }
});

router.post('/categories/:id/delete', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare('DELETE FROM categories WHERE id = ?').run(parseInt(req.params.id));
    return res.redirect('/admin/categories');
  } catch(err) {
    next(err);
  }
});

router.get('/enrollments', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;
    const total = Number((await db.prepare('SELECT COUNT(*) as count FROM enrollments').get()).count);
    const totalPages = Math.ceil(total / limit);
    const enrollments = await db.prepare(`
      SELECT e.*, u.name as user_name, u.email as user_email, c.title as course_title
      FROM enrollments e
      JOIN users u ON e.user_id = u.id
      JOIN courses c ON e.course_id = c.id
      ORDER BY e.enrolled_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
    const students = await db.prepare("SELECT id, name, email FROM users WHERE role = 'student' ORDER BY name").all();
    const courses = await db.prepare("SELECT id, title FROM courses ORDER BY title").all();
    return res.render('admin/enrollments', { title: 'إدارة التسجيلات', enrollments, students, courses, page, totalPages });
  } catch(err) { next(err); }
});

router.post('/enrollments/create', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const { user_id, course_id } = req.body;
    if (!user_id || !course_id) return res.redirect('/admin/enrollments');
    const exists = await db.prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?').get(parseInt(user_id), parseInt(course_id));
    if (!exists) {
      await db.prepare('INSERT INTO enrollments (user_id, course_id) VALUES (?, ?)').run(parseInt(user_id), parseInt(course_id));
    }
    req.session.flash = { type: 'success', message: 'تم تسجيل الطالب' };
    return res.redirect('/admin/enrollments');
  } catch(err) { next(err); }
});

router.post('/enrollments/:id/delete', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare('DELETE FROM enrollments WHERE id = ?').run(parseInt(req.params.id));
    req.session.flash = { type: 'error', message: 'تم إلغاء التسجيل' };
    return res.redirect('/admin/enrollments');
  } catch(err) { next(err); }
});

module.exports = router;
