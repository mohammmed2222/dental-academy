# أكاديمية طب الأسنان - منصة تعليمية متكاملة

## المنتج (Product)
منصة تعليمية إلكترونية (LMS) متخصصة في طب الأسنان، تدعم اللغة العربية بالكامل، وتعمل على الويب.

## المميزات الحالية (Current Features)

### 1. نظام المستخدمين (Users)
- **الأدوار**: مشرف (Admin) / مدرس (Instructor) / طالب (Student)
- **تسجيل دخول + إنشاء حساب** مع التحقق التلقائي من البريد
- **استعادة كلمة المرور** عبر البريد الإلكتروني (Ethereal dev SMTP)
- **الوضع الليلي** (Dark Mode) متوافق مع النظام (class-based)

### 2. الكورسات (Courses)
- **CRUD** كامل (إنشاء، تعديل، حذف، عرض)
- **أقسام الكورس** (Sections) لتنظيم الدروس
- **حالات**: مسودة (draft) / منشور (published) / مؤرشف
- **مستويات**: مبتدئ / متوسط / متقدم
- **سعر** (مجاني أو مدفوع) مع كوبونات خصم
- **متطلبات أساسية** (Prerequisites) بين الكورسات
- **تقييمات** (Reviews) من 1-5 نجوم

### 3. الدروس (Lessons)
- **أنواع**: نص / فيديو (YouTube MP4) / فيديو مرفوع
- **رفع ملفات فيديو** يدعم MP4
- **الدروس المباشرة** (Live Sessions) عبر Zoom/Google Meet
  - حالة: مجدول / مباشر / منتهي / ملغي
  - إضافة رابط تسجيل بعد الانتهاء
- **اختبارات** (Quizzes) لكل درس (اختيار من متعدد)
- **واجبات** (Assignments) مع رفع ملفات وتصحيح
- **تعليقات** (Comments) على الدروس
- **الإصدار المجدول** (Drip Content / Release Date)
- **تتبع التقدم** (Progress Tracking) لكل طالب

### 4. الاختبارات والامتحانات (Quizzes & Exams)
- **بنك أسئلة** (Question Bank) للمدرسين
- **اختبارات الدرس** (Lesson Quizzes) مع محاولات متعددة
- **امتحانات الكورس** (Course Exams) مع مؤقت زمني
- **نتائج فورية** مع النجاح/الرسوب ونسب مئوية
- **إجابات صحيحة متعددة** (Multiple Correct)

### 5. الدفع والفواتير (Payments)
- **بطاقة ائتمان/مدى** عبر Stripe (يتطلب تفعيل)
- **تحويل بنكي** مع رفع صورة الإيصال
- **دفع نقدي** (تأكيد يدوي من الإدارة)
- **كوبونات خصم** بنسبة مئوية
- **لوحة إدارة المدفوعات** مع تأكيد/رفض

### 6. المجموعات الطلابية (Cohorts)
- إنشاء مجموعات (دفعات) حسب الفصل الدراسي
- إضافة طلاب لكل مجموعة
- ربط كورسات بكل مجموعة
- تواريخ بداية/نهاية

### 7. مسارات التعلم (Learning Paths)
- مسارات تعليمية متعددة الكورسات
- ترتيب زمني للكورسات
- تتبع إكمال المسار

### 8. التواصل والإشعارات (Communication)
- **الرسائل الداخلية** (Inbox/Sent/Compose)
- **الإشعارات داخل التطبيق** (In-App Notifications)
- **الإعلانات** لكل كورس (Course Announcements)
- **التقييمات والمراجعات**

### 9. لوحة التحكم (Dashboard)
- **الطالب**: تقدم، درجات، كورسات مسجل بها، شهادات
- **المدرس**: إحصائيات، كورساته، أداء الطلاب
- **المشرف**: إدارة المستخدمين، الكورسات، التصنيفات، المدفوعات
- **تحليلات متقدمة** (معدل النجاح، متوسط الدرجات، أداء الطلاب)

### 10. الشهادات (Certificates)
- شهادة إكمال لكل كورس
- طباعة PDF (عبر PDFKit)

### 11. استيراد جماعي (Bulk Import)
- استيراد طلاب عبر CSV
- إنشاء حسابات تلقائي

### 12. صفحات ثابتة (Static Pages)
- من نحن / تواصل معنا / الأسئلة الشائعة
- سياسة الخصوصية / الشروط والأحكام

### 13. الأمان (Security)
- **CSRF Protection** (تلقائي في جميع النماذج)
- **Rate Limiting** (تسجيل الدخول: 10/15د، التسجيل: 5/ساعة، استعادة كلمة المرور: 3/ساعة)
- **HXSS** (Helmet + Content Security Policy معطل)
- **التحقق من نوع الملف** (MIME validation) عند الرفع
- **تشفير كلمات المرور** (bcryptjs)

## التقنيات المستخدمة (Tech Stack)

### Backend
- **Node.js** (Express.js)
- **قاعدة البيانات**: SQLite (sql.js للتطوير المحلي) / PostgreSQL (pg للإنتاج)
- **محرك القوالب**: EJS مع express-ejs-layouts
- **الجلسات**: express-session
- **الأمان**: helmet, express-rate-limit, bcryptjs
- **البريد**: Nodemailer (Ethereal dev / SMTP)
- **المهام المجدولة**: node-cron
- **الدفع**: Stripe SDK
- **الشهادات**: PDFKit
- **رفع الملفات**: Multer

### Frontend
- **Tailwind CSS** (CDN)
- **Material Symbols** (أيقونات)
- **HTMX** (تفاعل بدون JavaScript ثقيل)
- **خط IBM Plex Sans Arabic**

### البنية التحتية (Infrastructure)
- **الاستضافة**: Railway (Nixpacks builder)
- **قاعدة بيانات الإنتاج**: Supabase PostgreSQL
- **نظام التشغيل**: Windows (dev) / Linux (production)

## هيكل قاعدة البيانات (Database Schema)
22 جدول رئيسي:
- users, categories, courses, course_sections, lessons
- quizzes, quiz_questions, quiz_attempts
- course_exams, exam_questions, exam_attempts, exam_answers
- lesson_comments, notifications, payments
- enrollments, lesson_progress, course_reviews
- assignments, assignment_submissions
- course_prerequisites, contact_messages
- password_reset_tokens, course_announcements
- messages, question_bank
- learning_paths, learning_path_courses, learning_path_enrollments
- coupons, coupons, live_sessions
- cohorts, cohort_students, cohort_courses

## حسابات تجريبية (Demo Accounts)

| الدور | البريد الإلكتروني | كلمة المرور |
|-------|------------------|-------------|
| مشرف | admin@manassa.com | admin123 |
| مدرس | instructor@manassa.com | 123456 |
| طالب | student@manassa.com | 123456 |

## هيكل الملفات (Project Structure)
```
├── server.js              # نقطة الدخول الرئيسية
├── config/
│   ├── database.js         # قاعدة البيانات (SQLite + PostgreSQL)
│   ├── security.js         # CSRF + XSS
│   ├── mail.js             # البريد الإلكتروني
│   ├── notifications.js    # الإشعارات
│   └── scheduler.js        # المهام المجدولة
├── middleware/
│   └── auth.js             # مصادقة + صلاحيات
├── routes/                 # 20 مسار + 2 جديد
│   ├── auth.js             # تسجيل الدخول/الخروج
│   ├── courses.js          # الكورسات
│   ├── lessons.js          # الدروس
│   ├── dashboard.js        # لوحة التحكم
│   ├── admin.js            # إدارة المشرف
│   ├── payments.js         # المدفوعات + Stripe
│   ├── live.js             # الدروس المباشرة
│   ├── cohorts.js          # المجموعات
│   ├── quizzes.js          # الاختبارات
│   ├── exams.js            # الامتحانات
│   ├── assignments.js      # الواجبات
│   ├── messages.js         # الرسائل
│   ├── notifications.js    # الإشعارات
│   ├── announcements.js    # الإعلانات
│   ├── coupons.js          # الكوبونات
│   ├── questionBank.js     # بنك الأسئلة
│   ├── learningPaths.js    # مسارات التعلم
│   ├── bulkImport.js       # استيراد CSV
│   ├── reviews.js          # التقييمات
│   ├── sections.js         # أقسام الكورس
│   ├── comments.js         # التعليقات
│   └── prerequisites.js    # المتطلبات الأساسية
├── views/                  # 70+ قالب EJS
└── public/                 # ملفات ثابتة
```

## متغيرات البيئة (Environment Variables)

### مطلوبة (Required)
```
DATABASE_URL=postgresql://...  # Supabase PostgreSQL (للإنتاج فقط)
SESSION_SECRET=...             # مفتاح الجلسات
```

### اختيارية (Optional)
```
PORT=3000                      # منفذ الخادم
DB_PATH=/data                  # مسار قاعدة البيانات (SQLite)
ADMIN_EMAIL=admin@manassa.com
ADMIN_PASSWORD=admin123
ADMIN_NAME=المشرف العام
SMTP_HOST=smtp.example.com     # SMTP للبريد الحقيقي
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
STRIPE_SECRET_KEY=sk_live_...  # مفتاح Stripe
STRIPE_CURRENCY=sar            # عملة Stripe (sar, usd...)
NODE_ENV=development           # وضع التطوير
```

## التطوير القادم (Roadmap)
1. [ ] تفعيل Stripe (إضافة مفاتيح API)
2. [ ] دفع Tabby / تمارا (BNPL)
3. [ ] دعم اللغة الإنجليزية (ثنائي اللغة)
4. [ ] تطبيق ويب تقدمي (PWA)
5. [ ] إشعارات بريد إلكتروني حقيقية (SMTP)
6. [ ] تكامل Zoom API (إنشاء الاجتماعات تلقائياً)
7. [ ] ساعات CME (التعليم الطبي المستمر)
8. [ ] حجز مواعيد التدريب السريري
