const express = require('express');
const { getDb } = require('../config/database');
const { isAuthenticated, isInstructor } = require('../middleware/auth');
const { createNotification } = require('../config/notifications');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const paths = await db.prepare(`
      SELECT lp.*, u.name as instructor_name,
        (SELECT COUNT(*) FROM learning_path_courses WHERE path_id = lp.id) as course_count,
        (SELECT COUNT(*) FROM learning_path_enrollments WHERE path_id = lp.id) as student_count
      FROM learning_paths lp
      JOIN users u ON lp.instructor_id = u.id
      ORDER BY lp.created_at DESC
    `).all();

    return res.render('learning-paths/list', { title: 'المسارات التعليمية', paths });
  } catch (err) {
    next(err);
  }
});

router.get('/create', isInstructor, async (req, res, next) => {
  try {
    return res.render('learning-paths/create', { title: 'إنشاء مسار تعليمي', error: null });
  } catch (err) {
    next(err);
  }
});

router.post('/create', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const { title, description } = req.body;

    if (!title) {
      return res.render('learning-paths/create', { title: 'إنشاء مسار تعليمي', error: 'عنوان المسار مطلوب' });
    }

    await db.prepare(`
      INSERT INTO learning_paths (title, description, instructor_id)
      VALUES (?, ?, ?)
    `).run(title, description || '', req.session.userId);

    return res.redirect('/learning-paths');
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const pathId = parseInt(req.params.id);

    const path = await db.prepare(`
      SELECT lp.*, u.name as instructor_name
      FROM learning_paths lp
      JOIN users u ON lp.instructor_id = u.id
      WHERE lp.id = ?
    `).get(pathId);

    if (!path) {
      return res.status(404).render('error', { title: 'غير موجود', message: 'المسار التعليمي غير موجود', error: null });
    }

    const courses = await db.prepare(`
      SELECT lpc.*, c.id as course_id, c.title, c.slug, c.description as course_description,
        c.image, c.level, c.price,
        (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as lesson_count,
        (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as student_count,
        (SELECT COALESCE(AVG(rating), 0) FROM course_reviews WHERE course_id = c.id) as avg_rating
      FROM learning_path_courses lpc
      JOIN courses c ON lpc.course_id = c.id
      WHERE lpc.path_id = ?
      ORDER BY lpc.order_index ASC
    `).all(pathId);

    const isOwner = req.session.userId === path.instructor_id;

    let enrollment = null;
    let completedCourses = [];
    let progress = 0;
    if (req.session.userId) {
      enrollment = await db.prepare(
        'SELECT * FROM learning_path_enrollments WHERE user_id = ? AND path_id = ?'
      ).get(req.session.userId, pathId);

      if (enrollment && enrollment.completed_courses) {
        try {
          completedCourses = JSON.parse(enrollment.completed_courses);
        } catch (e) {
          completedCourses = [];
        }
      }
      if (courses.length > 0) {
        progress = Math.round((completedCourses.length / courses.length) * 100);
      }
    }

    const availableCourses = isOwner ? await db.prepare(`
      SELECT c.id, c.title, c.slug
      FROM courses c
      WHERE c.status = 'published' AND c.id NOT IN (
        SELECT course_id FROM learning_path_courses WHERE path_id = ?
      )
      ORDER BY c.title
    `).all(pathId) : [];

    return res.render('learning-paths/view', {
      title: path.title,
      path, courses, isOwner,
      enrollment, completedCourses, progress,
      availableCourses
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/edit', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const pathId = parseInt(req.params.id);

    const path = await db.prepare('SELECT * FROM learning_paths WHERE id = ? AND instructor_id = ?')
      .get(pathId, req.session.userId);

    if (!path) {
      return res.redirect('/learning-paths');
    }

    return res.render('learning-paths/edit', { title: 'تعديل المسار التعليمي', path, error: null });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/edit', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const pathId = parseInt(req.params.id);

    const path = await db.prepare('SELECT * FROM learning_paths WHERE id = ? AND instructor_id = ?')
      .get(pathId, req.session.userId);

    if (!path) {
      return res.redirect('/learning-paths');
    }

    const { title, description } = req.body;

    if (!title) {
      return res.render('learning-paths/edit', { title: 'تعديل المسار التعليمي', path, error: 'عنوان المسار مطلوب' });
    }

    await db.prepare(`
      UPDATE learning_paths SET title = ?, description = ? WHERE id = ?
    `).run(title, description || '', pathId);

    return res.redirect('/learning-paths/' + pathId);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/delete', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const pathId = parseInt(req.params.id);

    const path = await db.prepare('SELECT * FROM learning_paths WHERE id = ? AND instructor_id = ?')
      .get(pathId, req.session.userId);

    if (path) {
      await db.prepare('DELETE FROM learning_paths WHERE id = ?').run(pathId);
    }

    return res.redirect('/learning-paths');
  } catch (err) {
    next(err);
  }
});

router.post('/:id/enroll', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const pathId = parseInt(req.params.id);

    const path = await db.prepare('SELECT * FROM learning_paths WHERE id = ?').get(pathId);
    if (!path) {
      return res.redirect('/learning-paths');
    }

    const existing = await db.prepare(
      'SELECT id FROM learning_path_enrollments WHERE user_id = ? AND path_id = ?'
    ).get(req.session.userId, pathId);

    if (!existing) {
      await db.prepare(`
        INSERT INTO learning_path_enrollments (user_id, path_id)
        VALUES (?, ?)
      `).run(req.session.userId, pathId);

      await createNotification(req.session.userId, 'learning', 'تم التسجيل في مسار تعليمي',
        'لقد تم تسجيلك في مسار ' + path.title, pathId, 'learning_path');
    }

    return res.redirect('/learning-paths/' + pathId);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/add-course', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const pathId = parseInt(req.params.id);

    const path = await db.prepare('SELECT * FROM learning_paths WHERE id = ? AND instructor_id = ?')
      .get(pathId, req.session.userId);

    if (!path) {
      return res.redirect('/learning-paths');
    }

    const { course_id } = req.body;
    if (!course_id) {
      return res.redirect('/learning-paths/' + pathId);
    }

    const existing = await db.prepare(
      'SELECT id FROM learning_path_courses WHERE path_id = ? AND course_id = ?'
    ).get(pathId, parseInt(course_id));

    if (!existing) {
      const maxOrder = await db.prepare(
        'SELECT COALESCE(MAX(order_index), -1) + 1 as next FROM learning_path_courses WHERE path_id = ?'
      ).get(pathId);
      const orderIndex = typeof maxOrder !== 'undefined' && maxOrder !== null ? maxOrder.next : 0;

      await db.prepare(`
        INSERT INTO learning_path_courses (path_id, course_id, order_index)
        VALUES (?, ?, ?)
      `).run(pathId, parseInt(course_id), orderIndex);
    }

    return res.redirect('/learning-paths/' + pathId);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/remove-course/:courseId', isInstructor, async (req, res, next) => {
  try {
    const db = getDb();
    const pathId = parseInt(req.params.id);
    const courseId = parseInt(req.params.courseId);

    const path = await db.prepare('SELECT * FROM learning_paths WHERE id = ? AND instructor_id = ?')
      .get(pathId, req.session.userId);

    if (path) {
      await db.prepare(
        'DELETE FROM learning_path_courses WHERE path_id = ? AND course_id = ?'
      ).run(pathId, courseId);
    }

    return res.redirect('/learning-paths/' + pathId);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
