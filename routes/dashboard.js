const express = require('express');
const path = require('path');
const multer = require('multer');
const { getDb } = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');

const router = express.Router();

const avatarStorage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, path.join(__dirname, '..', 'public', 'uploads', 'avatars')); },
  filename: function (req, file, cb) { cb(null, 'avatar-' + req.session.userId + '-' + Date.now() + path.extname(file.originalname)); }
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('يُسمح فقط بملفات الصور'), false);
    cb(null, true);
  }
});

router.get('/', isAuthenticated, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const role = req.session.role;

  if (role === 'admin') return res.redirect('/admin');

  if (role === 'instructor') {
    const courses = db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as student_count,
        (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as lesson_count,
        cat.name as category_name
      FROM courses c
      LEFT JOIN categories cat ON c.category_id = cat.id
      WHERE c.instructor_id = ?
      ORDER BY c.updated_at DESC
    `).all(userId);

    const totalStudents = db.prepare(`
      SELECT COUNT(*) as count FROM enrollments e
      JOIN courses c ON e.course_id = c.id
      WHERE c.instructor_id = ?
    `).get(userId).count;

    const totalCourses = courses.length;
    const publishedCourses = courses.filter(function(c) { return c.status === 'published'; }).length;

    const recentEnrollments = db.prepare(`
      SELECT e.*, u.name as student_name, c.title as course_title
      FROM enrollments e
      JOIN users u ON e.user_id = u.id
      JOIN courses c ON e.course_id = c.id
      WHERE c.instructor_id = ?
      ORDER BY e.enrolled_at DESC
      LIMIT 10
    `).all(userId);

    res.render('dashboard/instructor', {
      title: 'لوحة التحكم',
      courses,
      totalStudents,
      totalCourses,
      publishedCourses,
      recentEnrollments
    });
  } else {
    const enrollments = db.prepare(`
      SELECT e.*, c.title, c.slug, c.image, c.level, c.total_lessons,
        u.name as instructor_name,
        (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as lesson_count,
        (SELECT COUNT(*) FROM lesson_progress lp
          JOIN lessons l ON lp.lesson_id = l.id
          WHERE l.course_id = c.id AND lp.user_id = ? AND lp.completed = 1) as completed_lessons
      FROM enrollments e
      JOIN courses c ON e.course_id = c.id
      JOIN users u ON c.instructor_id = u.id
      WHERE e.user_id = ?
      ORDER BY e.enrolled_at DESC
    `).all(userId, userId);

    const completedCourses = enrollments.filter(function(e) { return e.completed_at; }).length;
    const inProgressCourses = enrollments.filter(function(e) { return !e.completed_at; }).length;

    const recentActivity = db.prepare(`
      SELECT lp.*, l.title as lesson_title, c.title as course_title, c.slug as course_slug
      FROM lesson_progress lp
      JOIN lessons l ON lp.lesson_id = l.id
      JOIN courses c ON l.course_id = c.id
      WHERE lp.user_id = ?
      ORDER BY lp.completed_at DESC
      LIMIT 10
    `).all(userId);

    res.render('dashboard/student', {
      title: 'لوحة التحكم',
      enrollments,
      completedCourses,
      inProgressCourses,
      recentActivity
    });
  }
});

router.get('/profile', isAuthenticated, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  res.render('dashboard/profile', { title: 'الملف الشخصي', user, error: null, success: null });
});

router.post('/profile', isAuthenticated, function(req, res) {
  uploadAvatar.single('avatar')(req, res, function(err) {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

    if (err) {
      return res.render('dashboard/profile', { title: 'الملف الشخصي', user, error: err.message, success: null });
    }

    const { name, bio, password } = req.body;

    if (!name) {
      return res.render('dashboard/profile', { title: 'الملف الشخصي', user, error: 'الاسم مطلوب', success: null });
    }

    var avatarPath = user.avatar;
    if (req.file) {
      avatarPath = '/uploads/avatars/' + req.file.filename;
    }

    if (password && password.length >= 6) {
      const bcrypt = require('bcryptjs');
      const hashedPassword = bcrypt.hashSync(password, 10);
      db.prepare('UPDATE users SET name = ?, bio = ?, avatar = ?, password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(name, bio || '', avatarPath, hashedPassword, req.session.userId);
    } else {
      db.prepare('UPDATE users SET name = ?, bio = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(name, bio || '', avatarPath, req.session.userId);
    }

    req.session.userName = name;
    req.session.userAvatar = avatarPath;
    res.render('dashboard/profile', { title: 'الملف الشخصي', user: { ...user, name: name, bio: bio, avatar: avatarPath }, error: null, success: 'تم تحديث الملف الشخصي بنجاح' });
  });
});

router.get('/certificate/:courseId', isAuthenticated, (req, res) => {
  const db = getDb();
  const enrollment = db.prepare(`
    SELECT e.*, c.title as course_title, c.slug as course_slug,
      u.name as instructor_name
    FROM enrollments e
    JOIN courses c ON e.course_id = c.id
    JOIN users u ON c.instructor_id = u.id
    WHERE e.user_id = ? AND e.course_id = ? AND e.completed_at IS NOT NULL
  `).get(req.session.userId, parseInt(req.params.courseId));

  if (!enrollment) return res.redirect('/dashboard');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  const isPdf = req.query.format === 'pdf';

  if (isPdf) {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ layout: 'landscape', size: 'A4', margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="certificate-' + enrollment.course_slug + '.pdf"');
    doc.pipe(res);

    // Border
    doc.rect(30, 20, doc.page.width - 60, doc.page.height - 40).stroke('#a30019');
    doc.rect(35, 25, doc.page.width - 70, doc.page.height - 50).stroke('#a30019');

    doc.font('Helvetica-Bold');
    doc.fontSize(36).fillColor('#a30019').text('أكاديمية طب الأسنان', { align: 'center', features: ['rtla'] });
    doc.moveDown(2);
    doc.font('Helvetica').fontSize(18).fillColor('#333').text('شهادة إتمام', { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text('تشهد هذه الشهادة بأن', { align: 'center' });
    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#a30019').text(user.name, { align: 'center' });
    doc.moveDown();
    doc.font('Helvetica').fontSize(14).fillColor('#333').text('قد أتم بنجاح دورة', { align: 'center' });
    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#a30019').text(enrollment.course_title, { align: 'center' });
    doc.moveDown(2);
    doc.font('Helvetica').fontSize(12).fillColor('#666')
      .text('تاريخ الإتمام: ' + new Date(enrollment.completed_at).toLocaleDateString('ar-EG'), { align: 'center' })
      .text('بتاريخ: ' + new Date().toLocaleDateString('ar-EG'), { align: 'center' });
    doc.moveDown(3);
    doc.fontSize(12).fillColor('#333').text('_________________________', { align: 'center' });
    doc.font('Helvetica-Bold').text(enrollment.instructor_name, { align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor('#666').text('مدرب الدورة', { align: 'center' });

    doc.end();
    return;
  }

  res.render('dashboard/certificate', {
    title: 'شهادة إتمام',
    enrollment,
    user
  });
});

module.exports = router;
