const express = require('express');
const path = require('path');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { getDb } = require('../config/database');
const { sqlNow } = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');
const { toSafeInt } = require('../config/security');

var profileLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, handler: async function(req, res) { try { var u = await getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId); return res.render('dashboard/profile', { title: 'الملف الشخصي', user: u, error: 'طلبات كثيرة جداً، حاول بعد 15 دقيقة', success: null }); } catch(e) { return res.redirect('/dashboard'); } } });

const router = express.Router();

const avatarStorage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, path.join(__dirname, '..', 'public', 'uploads', 'avatars')); },
  filename: function (req, file, cb) { cb(null, 'avatar-' + req.session.userId + '-' + Date.now() + path.extname(file.originalname)); }
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    var ext = path.extname(file.originalname).toLowerCase();
    var allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    if (!file.mimetype.startsWith('image/') || allowed.indexOf(ext) === -1) {
      return cb(new Error('يُسمح فقط بصور (jpg, png, gif, webp)'), false);
    }
    cb(null, true);
  }
});

router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const userId = req.session.userId;
    const role = req.session.role;

    if (role === 'admin') return res.redirect('/admin');

    if (role === 'instructor') {
      const courses = await db.prepare(`
        SELECT c.*, 
          (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as student_count,
          (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as lesson_count,
          cat.name as category_name
        FROM courses c
        LEFT JOIN categories cat ON c.category_id = cat.id
        WHERE c.instructor_id = ?
        ORDER BY c.updated_at DESC
      `).all(userId);

      const totalStudents = (await db.prepare(`
        SELECT COUNT(*) as count FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        WHERE c.instructor_id = ?
      `).get(userId)).count;

      const totalCourses = courses.length;
      const publishedCourses = courses.filter(function(c) { return c.status === 'published'; }).length;

      const recentEnrollments = await db.prepare(`
        SELECT e.*, u.name as student_name, c.title as course_title
        FROM enrollments e
        JOIN users u ON e.user_id = u.id
        JOIN courses c ON e.course_id = c.id
        WHERE c.instructor_id = ?
        ORDER BY e.enrolled_at DESC
        LIMIT 10
      `).all(userId);

      return res.render('dashboard/instructor', {
        title: 'لوحة التحكم',
        courses,
        totalStudents,
        totalCourses,
        publishedCourses,
        recentEnrollments
      });
    } else {
      const enrollments = await db.prepare(`
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

      const recentActivity = await db.prepare(`
        SELECT lp.*, l.title as lesson_title, c.title as course_title, c.slug as course_slug
        FROM lesson_progress lp
        JOIN lessons l ON lp.lesson_id = l.id
        JOIN courses c ON l.course_id = c.id
        WHERE lp.user_id = ?
        ORDER BY lp.completed_at DESC
        LIMIT 10
      `).all(userId);

      var recentQuizAttempts = await db.prepare(`
        SELECT qa.*, q.title as quiz_title, l.title as lesson_title
        FROM quiz_attempts qa
        JOIN quizzes q ON qa.quiz_id = q.id
        JOIN lessons l ON q.lesson_id = l.id
        WHERE qa.user_id = ?
        ORDER BY qa.attempted_at DESC
        LIMIT 5
      `).all(userId);

      return res.render('dashboard/student', {
        title: 'لوحة التحكم',
        user: { name: req.session.userName },
        enrollments,
        completedCourses,
        inProgressCourses,
        recentActivity,
        recentQuizAttempts
      });
    }
  } catch(err) {
    next(err);
  }
});

router.get('/grades', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    var userId = req.session.userId;

    var quizGrades = await db.prepare(`
      SELECT qa.*, q.title as quiz_title, l.title as lesson_title, c.title as course_title, c.slug as course_slug
      FROM quiz_attempts qa
      JOIN quizzes q ON qa.quiz_id = q.id
      JOIN lessons l ON q.lesson_id = l.id
      JOIN courses c ON l.course_id = c.id
      WHERE qa.user_id = ?
      ORDER BY qa.attempted_at DESC
    `).all(userId);

    var examGrades = await db.prepare(`
      SELECT ea.*, e.title as exam_title, c.title as course_title, c.slug as course_slug
      FROM exam_attempts ea
      JOIN course_exams e ON ea.exam_id = e.id
      JOIN courses c ON e.course_id = c.id
      WHERE ea.user_id = ?
      ORDER BY ea.attempted_at DESC
    `).all(userId);

    var assignmentGrades = await db.prepare(`
      SELECT s.*, a.title as assignment_title, l.title as lesson_title, c.title as course_title, c.slug as course_slug
      FROM assignment_submissions s
      JOIN assignments a ON s.assignment_id = a.id
      JOIN lessons l ON a.lesson_id = l.id
      JOIN courses c ON l.course_id = c.id
      WHERE s.user_id = ? AND s.grade IS NOT NULL
      ORDER BY s.graded_at DESC
    `).all(userId);

    return res.render('dashboard/grades', {
      title: 'الدرجات',
      quizGrades, examGrades, assignmentGrades
    });
  } catch(err) {
    next(err);
  }
});

router.get('/profile', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    return res.render('dashboard/profile', { title: 'الملف الشخصي', user, error: null, success: null });
  } catch(err) {
    next(err);
  }
});

router.post('/profile', isAuthenticated, profileLimiter, async (req, res, next) => {
  try {
    uploadAvatar.single('avatar')(req, res, async function(err) {
      try {
        const db = getDb();
        const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

        if (err) {
          return res.render('dashboard/profile', { title: 'الملف الشخصي', user, error: err.message, success: null });
        }

        const { name, bio, phone, password, current_password } = req.body;

        if (!name) {
          return res.render('dashboard/profile', { title: 'الملف الشخصي', user, error: 'الاسم مطلوب', success: null });
        }

        var avatarPath = user.avatar;
        if (req.file) {
          avatarPath = '/uploads/avatars/' + req.file.filename;
        }

        if (password) {
          if (password.length < 12) {
            return res.render('dashboard/profile', { title: 'الملف الشخصي', user, error: 'كلمة المرور يجب أن تكون 12 حرفاً على الأقل', success: null });
          }
          if (!current_password) {
            return res.render('dashboard/profile', { title: 'الملف الشخصي', user, error: 'يجب إدخال كلمة المرور الحالية لتغيير كلمة المرور', success: null });
          }
          const bcrypt = require('bcryptjs');
          if (!(await bcrypt.compare(current_password, user.password))) {
            return res.render('dashboard/profile', { title: 'الملف الشخصي', user, error: 'كلمة المرور الحالية غير صحيحة', success: null });
          }
          const hashedPassword = await bcrypt.hash(password, 10);
          await db.prepare(`UPDATE users SET name = ?, bio = ?, phone = ?, avatar = ?, password = ?, updated_at = ${sqlNow()} WHERE id = ?`)
            .run(name, bio || '', phone || '', avatarPath, hashedPassword, req.session.userId);
        } else {
          await db.prepare(`UPDATE users SET name = ?, bio = ?, phone = ?, avatar = ?, updated_at = ${sqlNow()} WHERE id = ?`)
            .run(name, bio || '', phone || '', avatarPath, req.session.userId);
        }

        req.session.userName = name;
        req.session.userAvatar = avatarPath;
        return res.render('dashboard/profile', { title: 'الملف الشخصي', user: { ...user, name: name, bio: bio, avatar: avatarPath }, error: null, success: 'تم تحديث الملف الشخصي بنجاح' });
      } catch(err) {
        next(err);
      }
    });
  } catch(err) {
    next(err);
  }
});

router.get('/certificate/:courseId', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const enrollment = await db.prepare(`
      SELECT e.*, c.title as course_title, c.slug as course_slug,
        u.name as instructor_name
      FROM enrollments e
      JOIN courses c ON e.course_id = c.id
      JOIN users u ON c.instructor_id = u.id
      WHERE e.user_id = ? AND e.course_id = ? AND e.completed_at IS NOT NULL
    `).get(req.session.userId, toSafeInt(req.params.courseId));

    if (!enrollment) return res.redirect('/dashboard');

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

    const isPdf = req.query.format === 'pdf';

    if (isPdf) {
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ layout: 'landscape', size: 'A4', margin: 50 });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="certificate-' + enrollment.course_slug + '.pdf"');
      doc.pipe(res);

      var fontPath = path.join(__dirname, '..', 'public', 'fonts');
      doc.registerFont('Arabic', path.join(fontPath, 'Amiri-Regular.ttf'));
      doc.registerFont('Arabic-Bold', path.join(fontPath, 'Amiri-Bold.ttf'));

      doc.rect(30, 20, doc.page.width - 60, doc.page.height - 40).stroke('#a30019');
      doc.rect(35, 25, doc.page.width - 70, doc.page.height - 50).stroke('#a30019');

      doc.font('Arabic-Bold');
      doc.fontSize(36).fillColor('#a30019').text('أكاديمية طب الأسنان', { align: 'center' });
      doc.moveDown(2);
      doc.font('Arabic').fontSize(18).fillColor('#333').text('شهادة إتمام', { align: 'center' });
      doc.moveDown();
      doc.fontSize(14).text('تشهد هذه الشهادة بأن', { align: 'center' });
      doc.moveDown();
      doc.font('Arabic-Bold').fontSize(22).fillColor('#a30019').text(user.name, { align: 'center' });
      doc.moveDown();
      doc.font('Arabic').fontSize(14).fillColor('#333').text('قد أتم بنجاح دورة', { align: 'center' });
      doc.moveDown();
      doc.font('Arabic-Bold').fontSize(20).fillColor('#a30019').text(enrollment.course_title, { align: 'center' });
      doc.moveDown(2);
      doc.font('Arabic').fontSize(12).fillColor('#666')
        .text('تاريخ الإتمام: ' + new Date(enrollment.completed_at).toLocaleDateString('ar-EG'), { align: 'center' })
        .text('بتاريخ: ' + new Date().toLocaleDateString('ar-EG'), { align: 'center' });
      doc.moveDown(3);
      doc.fontSize(12).fillColor('#333').text('_________________________', { align: 'center' });
      doc.font('Arabic-Bold').text(enrollment.instructor_name, { align: 'center' });
      doc.font('Arabic').fontSize(10).fillColor('#666').text('مدرب الدورة', { align: 'center' });

      doc.end();
      return;
    }

    return res.render('dashboard/certificate', {
      title: 'شهادة إتمام',
      enrollment,
      user
    });
  } catch(err) {
    next(err);
  }
});

router.get('/analytics', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const userId = req.session.userId;

    const totalQuizzes = await db.prepare(`
      SELECT COUNT(*) as count, COALESCE(AVG(score), 0) as avg_score,
        SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) as passed_count
      FROM quiz_attempts WHERE user_id = ?
    `).get(userId);

    const examStats = await db.prepare(`
      SELECT COUNT(*) as count, COALESCE(AVG(score), 0) as avg_score,
        SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) as passed_count
      FROM exam_attempts WHERE user_id = ?
    `).get(userId);

    const qCount = Number(totalQuizzes.count), eCount = Number(examStats.count);
    const totalAttempts = qCount + eCount;
    const totalAvgScore = totalAttempts > 0
      ? Math.round(((Number(totalQuizzes.avg_score) * qCount) + (Number(examStats.avg_score) * eCount)) / totalAttempts)
      : 0;
    const qPassed = Number(totalQuizzes.passed_count), ePassed = Number(examStats.passed_count);
    const totalPassed = qPassed + ePassed;
    const passRate = totalAttempts > 0 ? Math.round((totalPassed / totalAttempts) * 100) : 0;

    const coursesCompleted = (await db.prepare(`
      SELECT COUNT(*) as count FROM enrollments WHERE user_id = ? AND completed_at IS NOT NULL
    `).get(userId)).count;

    const scoresOverTime = (await db.prepare(`
      SELECT score, passed, attempted_at, 'quiz' as type, q.title as activity_name
      FROM quiz_attempts qa
      JOIN quizzes q ON qa.quiz_id = q.id
      WHERE qa.user_id = ?
      UNION ALL
      SELECT score, passed, attempted_at, 'exam' as type, e.title as activity_name
      FROM exam_attempts ea
      JOIN course_exams e ON ea.exam_id = e.id
      WHERE ea.user_id = ?
      ORDER BY attempted_at DESC LIMIT 10
    `).all(userId, userId)).reverse();

    const perfByCourse = await db.prepare(`
      SELECT c.title, c.id,
        COUNT(qa.id) as attempts,
        COALESCE(AVG(qa.score), 0) as avg_score
      FROM courses c
      JOIN lessons l ON l.course_id = c.id
      JOIN quizzes q ON q.lesson_id = l.id
      JOIN quiz_attempts qa ON qa.quiz_id = q.id
      WHERE qa.user_id = ?
      GROUP BY c.id
      UNION ALL
      SELECT c.title, c.id,
        COUNT(ea.id) as attempts,
        COALESCE(AVG(ea.score), 0) as avg_score
      FROM courses c
      JOIN course_exams ce ON ce.course_id = c.id
      JOIN exam_attempts ea ON ea.exam_id = ce.id
      WHERE ea.user_id = ?
      GROUP BY c.id
    `).all(userId, userId);

    const mergedPerf = {};
    perfByCourse.forEach(function(row) {
      if (!mergedPerf[row.id]) {
        mergedPerf[row.id] = { title: row.title, attempts: 0, totalScore: 0, count: 0 };
      }
      mergedPerf[row.id].attempts += row.attempts;
      mergedPerf[row.id].totalScore += row.avg_score * row.attempts;
      mergedPerf[row.id].count += row.attempts;
    });
    var coursePerformance = Object.values(mergedPerf).map(function(c) {
      return { title: c.title, avg_score: c.count > 0 ? Math.round(c.totalScore / c.count) : 0, attempts: c.attempts };
    });

    const weakAreas = await db.prepare(`
      SELECT qq.question_text, q.title as quiz_title, COUNT(*) as wrong_count
      FROM quiz_answers qa
      JOIN quiz_attempts qat ON qa.attempt_id = qat.id
      JOIN quiz_questions qq ON qa.question_id = qq.id
      JOIN quizzes q ON qq.quiz_id = q.id
      WHERE qat.user_id = ? AND qa.is_correct = 0
      GROUP BY qq.id
      ORDER BY wrong_count DESC LIMIT 10
    `).all(userId);

    const examWeakAreas = await db.prepare(`
      SELECT eq.question_text, ce.title as quiz_title, COUNT(*) as wrong_count
      FROM exam_answers ea
      JOIN exam_attempts eat ON ea.attempt_id = eat.id
      JOIN exam_questions eq ON ea.question_id = eq.id
      JOIN course_exams ce ON eq.exam_id = ce.id
      WHERE eat.user_id = ? AND ea.is_correct = 0
      GROUP BY eq.id
      ORDER BY wrong_count DESC LIMIT 10
    `).all(userId);

    var allWeak = weakAreas.concat(examWeakAreas);
    allWeak.sort(function(a, b) { return b.wrong_count - a.wrong_count; });
    allWeak = allWeak.slice(0, 10);

    const recentLessons = await db.prepare(`
      SELECT lp.completed_at, l.title as item_title, c.title as parent_title, 'lesson' as type
      FROM lesson_progress lp
      JOIN lessons l ON lp.lesson_id = l.id
      JOIN courses c ON l.course_id = c.id
      WHERE lp.user_id = ? AND lp.completed = 1
      ORDER BY lp.completed_at DESC LIMIT 5
    `).all(userId);

    const recentQuiz = await db.prepare(`
      SELECT qa.attempted_at, q.title as item_title, c.title as parent_title, 'quiz' as type
      FROM quiz_attempts qa
      JOIN quizzes q ON qa.quiz_id = q.id
      JOIN lessons l ON q.lesson_id = l.id
      JOIN courses c ON l.course_id = c.id
      WHERE qa.user_id = ?
      ORDER BY qa.attempted_at DESC LIMIT 5
    `).all(userId);

    const recentAssignments = await db.prepare(`
      SELECT s.submitted_at as completed_at, a.title as item_title, c.title as parent_title, 'assignment' as type
      FROM assignment_submissions s
      JOIN assignments a ON s.assignment_id = a.id
      JOIN lessons l ON a.lesson_id = l.id
      JOIN courses c ON l.course_id = c.id
      WHERE s.user_id = ?
      ORDER BY s.submitted_at DESC LIMIT 5
    `).all(userId);

    var recentActivity = [];
    recentLessons.forEach(function(r) { recentActivity.push(r); });
    recentQuiz.forEach(function(r) { recentActivity.push({ completed_at: r.attempted_at, item_title: r.item_title, parent_title: r.parent_title, type: r.type }); });
    recentAssignments.forEach(function(r) { recentActivity.push(r); });
    recentActivity.sort(function(a, b) { return new Date(b.completed_at) - new Date(a.completed_at); });
    recentActivity = recentActivity.slice(0, 5);

    return res.render('dashboard/analytics', {
      title: 'تحليلات الأداء',
      totalAttempts, totalAvgScore, passRate, coursesCompleted,
      scoresOverTime, coursePerformance, weakAreas: allWeak, recentActivity
    });
  } catch(err) {
    next(err);
  }
});

router.get('/report', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const userId = req.session.userId;
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ layout: 'portrait', size: 'A4', margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="student-report-' + userId + '.pdf"');
    doc.pipe(res);

    var fontPath = path.join(__dirname, '..', 'public', 'fonts');
    doc.registerFont('Arabic', path.join(fontPath, 'Amiri-Regular.ttf'));
    doc.registerFont('Arabic-Bold', path.join(fontPath, 'Amiri-Bold.ttf'));

    doc.font('Arabic-Bold');
    doc.fontSize(26).fillColor('#a30019').text('أكاديمية طب الأسنان', { align: 'center' });
    doc.moveDown(0.5);
    doc.font('Arabic').fontSize(16).fillColor('#333').text('تقرير الطالب', { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(14).fillColor('#333').text('الاسم: ' + user.name, { align: 'right' });
    doc.text('البريد الإلكتروني: ' + user.email, { align: 'right' });
    doc.text('تاريخ التقرير: ' + new Date().toLocaleDateString('ar-EG'), { align: 'right' });
    doc.moveDown(1.5);

    const enrollments = await db.prepare(`
      SELECT e.*, c.title, c.slug,
        (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as lesson_count,
        (SELECT COUNT(*) FROM lesson_progress lp
          JOIN lessons l ON lp.lesson_id = l.id
          WHERE l.course_id = c.id AND lp.user_id = ? AND lp.completed = 1) as completed_lessons
      FROM enrollments e
      JOIN courses c ON e.course_id = c.id
      WHERE e.user_id = ?
      ORDER BY e.enrolled_at DESC
    `).all(userId, userId);

    doc.font('Arabic-Bold').fontSize(14).fillColor('#a30019').text('الدورات المسجلة', { align: 'right' });
    doc.moveDown(0.5);
    doc.font('Arabic').fontSize(11).fillColor('#333');

    if (enrollments.length === 0) {
      doc.text('لا توجد دورات مسجلة', { align: 'right' });
    } else {
      enrollments.forEach(function(enr) {
        var progress = enr.lesson_count > 0 ? Math.round((enr.completed_lessons / enr.lesson_count) * 100) : 0;
        doc.text('• ' + enr.title + ' - ' + progress + '%', { align: 'right' });
      });
    }
    doc.moveDown(1.5);

    doc.font('Arabic-Bold').fontSize(14).fillColor('#a30019').text('ملخص نتائج الاختبارات', { align: 'right' });
    doc.moveDown(0.5);
    doc.font('Arabic').fontSize(11).fillColor('#333');

    const quizResults = await db.prepare(`
      SELECT qa.score, qa.passed, qa.attempted_at, q.title as quiz_title
      FROM quiz_attempts qa
      JOIN quizzes q ON qa.quiz_id = q.id
      WHERE qa.user_id = ?
      ORDER BY qa.attempted_at DESC LIMIT 10
    `).all(userId);

    if (quizResults.length === 0) {
      doc.text('لا توجد نتائج اختبارات', { align: 'right' });
    } else {
      quizResults.forEach(function(qr) {
        doc.text('• ' + qr.quiz_title + ': ' + qr.score + '% - ' + (qr.passed ? 'ناجح' : 'راسب') + ' - ' + new Date(qr.attempted_at).toLocaleDateString('ar-EG'), { align: 'right' });
      });
    }
    doc.moveDown(1.5);

    doc.font('Arabic-Bold').fontSize(14).fillColor('#a30019').text('آخر الأنشطة', { align: 'right' });
    doc.moveDown(0.5);
    doc.font('Arabic').fontSize(11).fillColor('#333');

    const recentLessonsReport = await db.prepare(`
      SELECT lp.completed_at, l.title as lesson_title, c.title as course_title
      FROM lesson_progress lp
      JOIN lessons l ON lp.lesson_id = l.id
      JOIN courses c ON l.course_id = c.id
      WHERE lp.user_id = ? AND lp.completed = 1
      ORDER BY lp.completed_at DESC LIMIT 5
    `).all(userId);

    if (recentLessonsReport.length === 0) {
      doc.text('لا توجد أنشطة حديثة', { align: 'right' });
    } else {
      recentLessonsReport.forEach(function(rl) {
        doc.text('• أكملت درس "' + rl.lesson_title + '" في "' + rl.course_title + '" - ' + new Date(rl.completed_at).toLocaleDateString('ar-EG'), { align: 'right' });
      });
    }

    doc.end();
  } catch(err) {
    next(err);
  }
});

router.post('/toggle-dark-mode', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    var user = await db.prepare('SELECT dark_mode FROM users WHERE id = ?').get(req.session.userId);
    var newVal = user.dark_mode ? 0 : 1;
    await db.prepare('UPDATE users SET dark_mode = ? WHERE id = ?').run(newVal, req.session.userId);
    req.session.darkMode = newVal;
    return res.json({ darkMode: newVal });
  } catch(err) {
    next(err);
  }
});

module.exports = router;
