const express = require('express');
const session = require('express-session');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { initializeDatabase, saveDatabase, sqlNow } = require('./config/database');
const { initializeMail } = require('./config/mail');
const { startScheduler } = require('./config/scheduler');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { csrfProtection, generateCsrfToken, escapeHtml, toSafeInt } = require('./config/security');
const authRoutes = require('./routes/auth');
const courseRoutes = require('./routes/courses');
const lessonRoutes = require('./routes/lessons');
const quizRoutes = require('./routes/quizzes');
const dashboardRoutes = require('./routes/dashboard');
const adminRoutes = require('./routes/admin');
const announcementRoutes = require('./routes/announcements');
const assignmentRoutes = require('./routes/assignments');
const reviewRoutes = require('./routes/reviews');
const prerequisiteRoutes = require('./routes/prerequisites');
const examRoutes = require('./routes/exams');
const commentRoutes = require('./routes/comments');
const notificationRoutes = require('./routes/notifications');
const paymentRoutes = require('./routes/payments');
const sectionRoutes = require('./routes/sections');
const messageRoutes = require('./routes/messages');
const questionBankRoutes = require('./routes/questionBank');
const couponRoutes = require('./routes/coupons');
const bulkImportRoutes = require('./routes/bulkImport');
const learningPathRoutes = require('./routes/learningPaths');
const { setUser, noCache } = require('./middleware/auth');
const { getUnreadCount } = require('./config/notifications');

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err.message || err);
});

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(compression());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

if (!process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET environment variable is not set!');
  process.exit(1);
}

if (!process.env.ADMIN_PASSWORD) {
  console.warn('WARNING: ADMIN_PASSWORD not set. Admin login will not work until you set it (min 12 chars) and re-seed the database.');
} else if (process.env.ADMIN_PASSWORD.length < 12) {
  console.warn('WARNING: ADMIN_PASSWORD is less than 12 characters. For security, set it to at least 12 characters.');
}

app.use(session({
  secret: process.env.SESSION_SECRET,
  name: 'dental_sid',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.SESSION_SECURE === 'true' || process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  }
}));

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'"],
      frameSrc: ["'self'", "https://www.youtube-nocookie.com", "https://www.youtube.com"],
      objectSrc: ["'none'"]
    }
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));

var generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'طلبات كثيرة جداً، حاول بعد 15 دقيقة' }
});
app.use(generalLimiter);
app.use(noCache);
app.use(setUser);

app.use(async (req, res, next) => {
  res.locals.currentPath = req.path;
  try { res.locals.unreadNotifications = req.session.userId ? await getUnreadCount(req.session.userId) : 0; } catch (e) { res.locals.unreadNotifications = 0; }
  res.locals.csrfToken = generateCsrfToken(req.session);
  res.locals.escapeHtml = escapeHtml;
  next();
});

app.use(csrfProtection);

app.use((req, res, next) => {
  res.on('finish', () => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && res.statusCode < 400) {
      saveDatabase();
    }
  });
  next();
});

app.get('/', async (req, res, next) => {
  try {
    const { getDb } = require('./config/database');
    const db = getDb();
    const courses = await db.prepare(`
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
      courses: (await db.prepare("SELECT COUNT(*) as count FROM courses WHERE status = 'published'").get()).count,
      students: (await db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student'").get()).count,
      instructors: (await db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'instructor'").get()).count,
      lessons: (await db.prepare('SELECT COUNT(*) as count FROM lessons').get()).count
    };

    const categories = await db.prepare('SELECT * FROM categories ORDER BY name').all();

    return res.render('index', { courses, stats, categories, title: 'الرئيسية' });
  } catch(err) { next(err); }
});

app.use('/auth', authRoutes);
app.use('/courses', courseRoutes);
app.use('/courses', examRoutes);
app.use('/lessons', lessonRoutes);
app.use('/quizzes', quizRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/admin', adminRoutes);
app.use('/announcements', announcementRoutes);
app.use('/assignments', assignmentRoutes);
app.use('/reviews', reviewRoutes);
app.use('/prerequisites', prerequisiteRoutes);
app.use('/comments', commentRoutes);
app.use('/notifications', notificationRoutes);
app.use('/payments', paymentRoutes);
app.use('/sections', sectionRoutes);
app.use('/messages', messageRoutes);
app.use('/question-bank', questionBankRoutes);
app.use('/coupons', couponRoutes);
app.use('/admin', bulkImportRoutes);
app.use('/learning-paths', learningPathRoutes);
app.use('/live', require('./routes/live'));
app.use('/cohorts', require('./routes/cohorts'));
app.use('/whatsapp', require('./routes/whatsapp'));

app.get('/instructor/:id', async (req, res, next) => {
  try {
    const { getDb } = require('./config/database');
    const db = getDb();
    const instructor = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'instructor'").get(toSafeInt(req.params.id));
    if (!instructor) {
      return res.status(404).render('error', { title: 'غير موجود', message: 'المدرس غير موجود', error: null });
    }
    const courses = await db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as student_count,
        (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as lesson_count,
        (SELECT COALESCE(AVG(rating), 0) FROM course_reviews WHERE course_id = c.id) as avg_rating,
        (SELECT COUNT(*) FROM course_reviews WHERE course_id = c.id) as total_reviews
      FROM courses c WHERE c.instructor_id = ? AND c.status = 'published'
      ORDER BY c.created_at DESC
    `).all(instructor.id);
    const totalStudents = (await db.prepare(`
      SELECT COUNT(*) as count FROM enrollments e JOIN courses c ON e.course_id = c.id WHERE c.instructor_id = ?
    `).get(instructor.id)).count;
    return res.render('instructor/profile', { title: instructor.name, instructor, courses, totalStudents });
  } catch(err) { next(err); }
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

var contactLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, handler: function(req, res) { res.render('pages/contact', { title: 'تواصل معنا', error: 'طلبات كثيرة جداً، حاول بعد 15 دقيقة', success: null, currentPath: '/contact' }); } });

app.post('/contact', contactLimiter, async (req, res, next) => {
  try {
    const { getDb } = require('./config/database');
    const db = getDb();
    const { name, email, phone, subject, message } = req.body;
    var contactEmail = String(email || '').trim();
    if (!name || !contactEmail || !subject || !message) {
      return res.render('pages/contact', { title: 'تواصل معنا', error: 'يرجى ملء جميع الحقول المطلوبة', success: null, currentPath: '/contact' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      return res.render('pages/contact', { title: 'تواصل معنا', error: 'البريد الإلكتروني غير صالح', success: null, currentPath: '/contact' });
    }
    try {
      await db.prepare('INSERT INTO contact_messages (name, email, phone, subject, message) VALUES (?, ?, ?, ?, ?)').run(name, contactEmail, phone || '', subject, message);
    } catch (e) {
      console.error('Failed to save contact message:', e);
    }
    return res.render('pages/contact', { title: 'تواصل معنا', success: 'تم إرسال رسالتك بنجاح، سنتواصل معك قريباً', error: null, currentPath: '/contact' });
  } catch(err) { next(err); }
});

app.get('/sitemap.xml', async (req, res, next) => {
  try {
    const { getDb } = require('./config/database');
    const db = getDb();
    const courses = await db.prepare("SELECT slug, updated_at FROM courses WHERE status = 'published' ORDER BY updated_at DESC").all();
    var urls = ['<url><loc>' + (process.env.APP_URL || 'https://dental-academy-production.up.railway.app') + '</loc><priority>1.0</priority></url>'];
    urls.push('<url><loc>' + (process.env.APP_URL || 'https://dental-academy-production.up.railway.app') + '/courses</loc><priority>0.9</priority></url>');
    urls.push('<url><loc>' + (process.env.APP_URL || 'https://dental-academy-production.up.railway.app') + '/learning-paths</loc><priority>0.8</priority></url>');
    urls.push('<url><loc>' + (process.env.APP_URL || 'https://dental-academy-production.up.railway.app') + '/about</loc><priority>0.5</priority></url>');
    urls.push('<url><loc>' + (process.env.APP_URL || 'https://dental-academy-production.up.railway.app') + '/faq</loc><priority>0.5</priority></url>');
    urls.push('<url><loc>' + (process.env.APP_URL || 'https://dental-academy-production.up.railway.app') + '/contact</loc><priority>0.5</priority></url>');
    courses.forEach(function(c) {
      urls.push('<url><loc>' + (process.env.APP_URL || 'https://dental-academy-production.up.railway.app') + '/courses/' + c.slug + '</loc><lastmod>' + (c.updated_at || '').substring(0, 10) + '</lastmod><priority>0.7</priority></url>');
    });
    res.header('Content-Type', 'application/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls.join('') + '</urlset>');
  } catch(e) { next(e); }
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
['uploads', 'uploads/videos', 'uploads/avatars', 'uploads/assignments', 'uploads/payments'].forEach(function(dir) {
  var fullPath = path.join(__dirname, 'public', dir);
  try { fs.mkdirSync(fullPath, { recursive: true }); } catch (e) { console.error('خطأ في إنشاء مجلد ' + dir + ':', e.message); }
});

Promise.all([initializeDatabase(), initializeMail()]).then(async () => {
  console.log('✓ قاعدة البيانات جاهزة');
  console.log('✓ البريد الإلكتروني جاهز');
  startScheduler();
  app.listen(PORT, () => {
    console.log('🚀 المنصة التعليمية تعمل على: http://localhost:' + PORT);
  });
}).catch(err => {
  console.error('خطأ في تشغيل المنصة:', err);
  process.exit(1);
});
