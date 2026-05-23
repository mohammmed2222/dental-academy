const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { initializeDatabase, saveDatabase } = require('./config/database');
const { initializeMail } = require('./config/mail');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { csrfProtection, generateCsrfToken } = require('./config/security');
const authRoutes = require('./routes/auth');
const courseRoutes = require('./routes/courses');
const lessonRoutes = require('./routes/lessons');
const quizRoutes = require('./routes/quizzes');
const dashboardRoutes = require('./routes/dashboard');
const adminRoutes = require('./routes/admin');
const assignmentRoutes = require('./routes/assignments');
const reviewRoutes = require('./routes/reviews');
const prerequisiteRoutes = require('./routes/prerequisites');
const examRoutes = require('./routes/exams');
const commentRoutes = require('./routes/comments');
const notificationRoutes = require('./routes/notifications');
const paymentRoutes = require('./routes/payments');
const sectionRoutes = require('./routes/sections');
const { setUser } = require('./middleware/auth');
const { getUnreadCount } = require('./config/notifications');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'manassa_secret_key_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

var generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'طلبات كثيرة جداً، حاول بعد 15 دقيقة' }
});
app.use('/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'محاولات كثيرة جداً' } }));
app.use('/auth/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: { error: 'محاولات تسجيل كثيرة' } }));
app.use('/auth/forgot-password', rateLimit({ windowMs: 60 * 60 * 1000, max: 3, message: { error: 'طلبات كثيرة' } }));

app.use(generalLimiter);
app.use(setUser);

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.unreadNotifications = req.session.userId ? getUnreadCount(req.session.userId) : 0;
  res.locals.csrfToken = generateCsrfToken(req.session);
  next();
});

app.use(csrfProtection);

app.use((req, res, next) => {
  res.on('finish', () => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      saveDatabase();
    }
  });
  next();
});

app.get('/', (req, res) => {
  const { getDb } = require('./config/database');
  const db = getDb();
  const courses = db.prepare(`
    SELECT c.*, u.name as instructor_name, cat.name as category_name,
      (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as student_count
    FROM courses c
    JOIN users u ON c.instructor_id = u.id
    LEFT JOIN categories cat ON c.category_id = cat.id
    WHERE c.status = 'published'
    ORDER BY c.created_at DESC
    LIMIT 9
  `).all();
  
  const stats = {
    courses: db.prepare("SELECT COUNT(*) as count FROM courses WHERE status = 'published'").get().count,
    students: db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student'").get().count,
    instructors: db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'instructor'").get().count,
    lessons: db.prepare('SELECT COUNT(*) as count FROM lessons').get().count
  };

  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();

  res.render('index', { courses, stats, categories, title: 'الرئيسية' });
});

app.use('/auth', authRoutes);
app.use('/courses', courseRoutes);
app.use('/lessons', lessonRoutes);
app.use('/quizzes', quizRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/admin', adminRoutes);
app.use('/assignments', assignmentRoutes);
app.use('/reviews', reviewRoutes);
app.use('/prerequisites', prerequisiteRoutes);
app.use('/comments', commentRoutes);
app.use('/notifications', notificationRoutes);
app.use('/payments', paymentRoutes);
app.use('/sections', sectionRoutes);
app.use('/courses', examRoutes);

app.get('/instructor/:id', (req, res) => {
  const { getDb } = require('./config/database');
  const db = getDb();
  const instructor = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'instructor'").get(parseInt(req.params.id));
  if (!instructor) {
    return res.status(404).render('error', { title: 'غير موجود', message: 'المدرس غير موجود', error: null });
  }
  const courses = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as student_count,
      (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as lesson_count,
      (SELECT COALESCE(AVG(rating), 0) FROM course_reviews WHERE course_id = c.id) as avg_rating,
      (SELECT COUNT(*) FROM course_reviews WHERE course_id = c.id) as total_reviews
    FROM courses c WHERE c.instructor_id = ? AND c.status = 'published'
    ORDER BY c.created_at DESC
  `).all(instructor.id);
  const totalStudents = db.prepare(`
    SELECT COUNT(*) as count FROM enrollments e JOIN courses c ON e.course_id = c.id WHERE c.instructor_id = ?
  `).get(instructor.id).count;
  res.render('instructor/profile', { title: instructor.name, instructor, courses, totalStudents });
});

app.get('/faq', (req, res) => {
  res.render('pages/faq', { title: 'الأسئلة الشائعة', currentPath: '/faq' });
});

app.get('/about', (req, res) => {
  res.render('pages/about', { title: 'عن المنصة', currentPath: '/about' });
});

app.get('/contact', (req, res) => {
  res.render('pages/contact', { title: 'تواصل معنا', error: null, success: null, currentPath: '/contact' });
});

app.post('/contact', (req, res) => {
  const { name, email, phone, subject, message } = req.body;
  if (!name || !email || !subject || !message) {
    return res.render('pages/contact', { title: 'تواصل معنا', error: 'يرجى ملء جميع الحقول المطلوبة', success: null, currentPath: '/contact' });
  }
  return res.render('pages/contact', { title: 'تواصل معنا', success: 'تم إرسال رسالتك بنجاح، سنتواصل معك قريباً', error: null, currentPath: '/contact' });
});

app.get('/privacy', (req, res) => {
  res.render('pages/privacy', { title: 'سياسة الخصوصية', currentPath: '/privacy' });
});

app.get('/terms', (req, res) => {
  res.render('pages/terms', { title: 'الشروط والأحكام', currentPath: '/terms' });
});

app.use((req, res) => {
  res.status(404).render('error', { 
    title: 'الصفحة غير موجودة',
    message: 'عذراً، الصفحة التي تبحث عنها غير موجودة',
    error: null
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', {
    title: 'خطأ في الخادم',
    message: 'حدث خطأ غير متوقع',
    error: process.env.NODE_ENV === 'development' ? err.message : null
  });
});

// Ensure upload directories exist
['uploads', 'uploads/videos', 'uploads/avatars', 'uploads/assignments'].forEach(function(dir) {
  var fullPath = path.join(__dirname, 'public', dir);
  try { fs.mkdirSync(fullPath, { recursive: true }); } catch (e) {}
});

Promise.all([initializeDatabase(), initializeMail()]).then(() => {
  console.log('✓ قاعدة البيانات جاهزة');
  console.log('✓ البريد الإلكتروني جاهز');
  app.listen(PORT, () => {
    console.log('🚀 المنصة التعليمية تعمل على: http://localhost:' + PORT);
  });
}).catch(err => {
  console.error('خطأ في تشغيل المنصة:', err);
});
