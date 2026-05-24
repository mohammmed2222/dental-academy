const express = require('express');
const slugify = require('slugify');
const { getDb } = require('../config/database');
const { isAuthenticated, isInstructor } = require('../middleware/auth');
const { createNotification } = require('../config/notifications');

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDb();
  const { category, level, search, price_min, price_max, min_rating, sort, instructor } = req.query;
  const currentSort = sort || 'newest';
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 9;
  const offset = (page - 1) * limit;

  let where = ' WHERE c.status = \'published\'';
  const countParams = [];
  const params = [];

  if (category) {
    where += ' AND cat.slug = ?';
    countParams.push(category);
    params.push(category);
  }
  if (level) {
    where += ' AND c.level = ?';
    countParams.push(level);
    params.push(level);
  }
  if (search) {
    var searchStr = String(search).replace(/[%_]/g, '\\$&');
    where += " AND (c.title LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM lessons WHERE course_id = c.id AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')))";
    countParams.push('%' + searchStr + '%', '%' + searchStr + '%', '%' + searchStr + '%', '%' + searchStr + '%', '%' + searchStr + '%');
    params.push('%' + searchStr + '%', '%' + searchStr + '%', '%' + searchStr + '%', '%' + searchStr + '%', '%' + searchStr + '%');
  }
  if (price_min) {
    where += ' AND c.price >= ?';
    countParams.push(parseFloat(price_min));
    params.push(parseFloat(price_min));
  }
  if (price_max) {
    where += ' AND c.price <= ?';
    countParams.push(parseFloat(price_max));
    params.push(parseFloat(price_max));
  }
  if (min_rating) {
    where += ' AND (SELECT COALESCE(AVG(rating), 0) FROM course_reviews WHERE course_id = c.id) >= ?';
    countParams.push(parseFloat(min_rating));
    params.push(parseFloat(min_rating));
  }
  if (instructor) {
    var instrStr = String(instructor).replace(/[%_]/g, '\\$&');
    where += " AND u.name LIKE ? ESCAPE '\\'";
    countParams.push('%' + instrStr + '%');
    params.push('%' + instrStr + '%');
  }

  const totalResult = db.prepare('SELECT COUNT(*) as total FROM courses c LEFT JOIN categories cat ON c.category_id = cat.id JOIN users u ON c.instructor_id = u.id' + where).get(...countParams);
  const total = totalResult.total;
  const totalPages = Math.ceil(total / limit);

  let orderBy;
  switch (currentSort) {
    case 'popular':
      orderBy = 'student_count DESC';
      break;
    case 'rated':
      orderBy = 'avg_rating DESC';
      break;
    case 'price_asc':
      orderBy = 'c.price ASC';
      break;
    case 'price_desc':
      orderBy = 'c.price DESC';
      break;
    default:
      orderBy = 'c.created_at DESC';
  }

  const courses = db.prepare(`
    SELECT c.*, u.name as instructor_name, cat.name as category_name,
      (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as student_count,
      (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as total_lessons,
      (SELECT COALESCE(AVG(rating), 0) FROM course_reviews WHERE course_id = c.id) as avg_rating,
      (SELECT COUNT(*) FROM course_reviews WHERE course_id = c.id) as total_reviews
    FROM courses c
    JOIN users u ON c.instructor_id = u.id
    LEFT JOIN categories cat ON c.category_id = cat.id
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();

  res.render('courses/list', { 
    title: 'الكورسات', 
    courses, categories,
    page, totalPages, limit,
    currentCategory: category || '',
    currentLevel: level || '',
    search: search || '',
    price_min: price_min || '',
    price_max: price_max || '',
    min_rating: min_rating || '',
    sort: currentSort,
    instructor: instructor || ''
  });
});

router.get('/create', isInstructor, (req, res) => {
  const db = getDb();
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('courses/create', { title: 'إنشاء كورس جديد', categories, error: null });
});

router.post('/create', isInstructor, (req, res) => {
  const db = getDb();
  const { title, description, short_description, category_id, level, price } = req.body;

  if (!title) {
    const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
    return res.render('courses/create', { title: 'إنشاء كورس جديد', categories, error: 'عنوان الكورس مطلوب' });
  }

  let slug = slugify(title, { lower: true, replacement: '-' }) || 'course-' + Date.now();
  const existing = db.prepare('SELECT id FROM courses WHERE slug = ?').get(slug);
  if (existing) {
    slug = slug + '-' + Date.now();
  }

  db.prepare(`
    INSERT INTO courses (title, slug, description, short_description, instructor_id, category_id, level, price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, slug, description || '', short_description || '', req.session.userId, category_id || null, level || 'beginner', parseFloat(price) || 0);

  req.session.flash = { type: 'success', message: 'تم إنشاء الدورة بنجاح! لا تنسَ نشرها من صفحة التعديل لتكون متاحة للطلاب.' };
  res.redirect('/courses/' + slug);
});

router.get('/my-courses', isInstructor, (req, res) => {
  const db = getDb();
  const courses = db.prepare(`
    SELECT c.*, 
      (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as student_count,
      (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as lesson_count,
      cat.name as category_name
    FROM courses c
    LEFT JOIN categories cat ON c.category_id = cat.id
    WHERE c.instructor_id = ?
    ORDER BY c.created_at DESC
  `).all(req.session.userId);

  res.render('courses/my-courses', { title: 'كورساتي', courses });
});

router.get('/:slug', (req, res) => {
  const db = getDb();
  const course = db.prepare(`
    SELECT c.*, u.name as instructor_name, u.bio as instructor_bio, u.avatar as instructor_avatar,
      cat.name as category_name,
      (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as student_count,
      (SELECT COUNT(*) FROM course_reviews WHERE course_id = c.id) as total_reviews
    FROM courses c
    JOIN users u ON c.instructor_id = u.id
    LEFT JOIN categories cat ON c.category_id = cat.id
    WHERE c.slug = ?
  `).get(req.params.slug);

  if (!course) {
    return res.status(404).render('error', { title: 'غير موجود', message: 'الكورس غير موجود', error: null });
  }

  const lessons = db.prepare(`
    SELECT l.*, 
      CASE WHEN lp.completed = 1 THEN 1 ELSE 0 END as is_completed
    FROM lessons l
    LEFT JOIN lesson_progress lp ON l.id = lp.lesson_id AND lp.user_id = ?
    WHERE l.course_id = ?
    ORDER BY l.order_index ASC
  `).all(req.session.userId || 0, course.id);

  const isEnrolled = req.session.userId ? db.prepare(
    'SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?'
  ).get(req.session.userId, course.id) : null;

  const isOwner = req.session.userId === course.instructor_id;

  const totalLessons = lessons.length;
  const completedLessons = lessons.filter(function(l) { return l.is_completed; }).length;

  const exam = db.prepare('SELECT * FROM course_exams WHERE course_id = ?').get(course.id);
  const examAttempt = exam && req.session.userId ? db.prepare(
    "SELECT * FROM exam_attempts WHERE user_id = ? AND exam_id = ? AND passed = 1"
  ).get(req.session.userId, exam.id) : null;

  const prerequisites = db.prepare(`
    SELECT cp.*, c.title as prereq_title, c.slug as prereq_slug
    FROM course_prerequisites cp
    JOIN courses c ON cp.prerequisite_course_id = c.id
    WHERE cp.course_id = ?
  `).all(course.id);

  var sections = db.prepare('SELECT * FROM course_sections WHERE course_id = ? ORDER BY order_index ASC').all(course.id);
  var lessonsBySection = {};
  var unsectionedLessons = [];
  sections.forEach(function(s) { lessonsBySection[s.id] = []; });
  lessons.forEach(function(l) {
    if (l.section_id && lessonsBySection[l.section_id]) {
      lessonsBySection[l.section_id].push(l);
    } else {
      unsectionedLessons.push(l);
    }
  });

  res.render('courses/view', { 
    title: course.title, 
    course, lessons, sections, lessonsBySection, unsectionedLessons,
    isEnrolled, isOwner,
    totalLessons, completedLessons,
    exam, examAttempt,
    prerequisites
  });
});

router.get('/:slug/edit', isInstructor, (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE slug = ? AND instructor_id = ?')
    .get(req.params.slug, req.session.userId);
  
  if (!course) {
    return res.redirect('/courses/my-courses');
  }

  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  var sections = db.prepare('SELECT * FROM course_sections WHERE course_id = ? ORDER BY order_index ASC').all(course.id);
  res.render('courses/edit', { title: 'تعديل الكورس', course, categories, sections, error: null });
});

router.post('/:slug/edit', isInstructor, (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE slug = ? AND instructor_id = ?')
    .get(req.params.slug, req.session.userId);
  
  if (!course) {
    return res.redirect('/courses/my-courses');
  }

  const { title, description, short_description, category_id, level, price, status } = req.body;

  if (!title) {
    const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
    return res.render('courses/edit', { title: 'تعديل الكورس', course, categories, error: 'عنوان الكورس مطلوب' });
  }

  db.prepare(`
    UPDATE courses SET title = ?, description = ?, short_description = ?, 
      category_id = ?, level = ?, price = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(title, description || '', short_description || '', category_id || null, level || 'beginner', parseFloat(price) || 0, status || 'draft', course.id);

  res.redirect('/courses/' + req.params.slug);
});

router.post('/:slug/enroll', isAuthenticated, (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE slug = ?').get(req.params.slug);
  if (!course) return res.redirect('/courses');

  // Check prerequisites
  const prereqs = db.prepare(`
    SELECT cp.*, c.title as prereq_title, c.slug as prereq_slug
    FROM course_prerequisites cp
    JOIN courses c ON cp.prerequisite_course_id = c.id
    WHERE cp.course_id = ?
  `).all(course.id);

  const unmetPrereqs = [];
  for (var i = 0; i < prereqs.length; i++) {
    var p = prereqs[i];
    var completed = db.prepare(
      'SELECT id FROM enrollments WHERE user_id = ? AND course_id = ? AND completed_at IS NOT NULL'
    ).get(req.session.userId, p.prerequisite_course_id);
    if (!completed) {
      unmetPrereqs.push(p.prereq_title);
    }
  }

  if (unmetPrereqs.length > 0) {
    req.session.flash = {
      type: 'error',
      message: 'يجب إكمال المساقات التالية أولاً: ' + unmetPrereqs.join('، ')
    };
    return res.redirect('/courses/' + req.params.slug);
  }

  // Check if course is paid
  if (course.price > 0) {
    const hasPaid = db.prepare("SELECT id FROM payments WHERE user_id = ? AND course_id = ? AND status = 'paid'")
      .get(req.session.userId, course.id);
    const hasPending = db.prepare("SELECT id FROM payments WHERE user_id = ? AND course_id = ? AND status = 'pending'")
      .get(req.session.userId, course.id);
    if (!hasPaid && !hasPending) {
      req.session.flash = { type: 'info', message: 'هذا المساق مدفوع. يرجى اختيار طريقة الدفع.' };
      return res.redirect('/courses/' + req.params.slug + '?payment=required');
    }
    if (hasPending) {
      req.session.flash = { type: 'info', message: 'لديك طلب دفع قيد المراجعة. انتظر حتى يتم التأكيد.' };
      return res.redirect('/courses/' + req.params.slug);
    }
  }

  const existing = db.prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?')
    .get(req.session.userId, course.id);
  
  if (!existing) {
    db.prepare('INSERT INTO enrollments (user_id, course_id) VALUES (?, ?)')
      .run(req.session.userId, course.id);
    createNotification(req.session.userId, 'course', 'تم التسجيل في الدورة', 'لقد تم تسجيلك في دورة ' + course.title, course.id, 'course');
  }

  res.redirect('/courses/' + req.params.slug);
});

router.post('/:slug/delete', isInstructor, (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE slug = ? AND instructor_id = ?')
    .get(req.params.slug, req.session.userId);
  
  if (course) {
    db.prepare('DELETE FROM courses WHERE id = ?').run(course.id);
  }

  res.redirect('/courses/my-courses');
});

module.exports = router;
