const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

let db = null;
let pgPool = null;
let usingPg = false;

// SQLite synchronous wrapper
function sqliteWrap(dbRaw) {
  function prepare(sql) {
    return {
      get(...params) {
        const stmt = dbRaw.prepare(sql);
        if (params.length > 0) stmt.bind(params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
        if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
        stmt.free(); return undefined;
      },
      all(...params) {
        const rows = [];
        const stmt = dbRaw.prepare(sql);
        if (params.length > 0) stmt.bind(params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free(); return rows;
      },
      run(...params) {
        const stmt = dbRaw.prepare(sql);
        if (params.length > 0) stmt.bind(params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
        stmt.step(); stmt.free();
        return { lastInsertRowid: dbRaw.exec("SELECT last_insert_rowid() as id")[0]?.values[0][0], changes: dbRaw.getRowsModified() };
      }
    };
  }
  return { raw: dbRaw, prepare };
}

// PostgreSQL async wrapper
function pgWrap(pool) {
  function convertSql(sql) {
    let paramCounter = 0;
    return sql.replace(/\?/g, () => `$${++paramCounter}`);
  }
  function prepare(sql) {
    const pgSql = convertSql(sql);
    function clean(arr) { return arr.map(v => (typeof v === 'number' && isNaN(v)) ? null : v); }
    return {
      async get(...params) {
        const flat = clean(params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
        const res = await pool.query(pgSql, flat);
        return res.rows[0] || undefined;
      },
      async all(...params) {
        const flat = clean(params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
        const res = await pool.query(pgSql, flat);
        return res.rows;
      },
      async run(...params) {
        const flat = clean(params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
        const isInsert = /^\s*INSERT/i.test(pgSql);
        const query = isInsert ? pgSql.replace(/;\s*$/, '') + ' RETURNING id' : pgSql;
        const res = await pool.query(query, flat);
        return {
          lastInsertRowid: isInsert && res.rows[0] ? res.rows[0].id : undefined,
          changes: res.rowCount || 0
        };
      }
    };
  }
  return { prepare, _pool: pool };
}

const createTablesSql = `
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT DEFAULT 'student', avatar TEXT DEFAULT '/images/default-avatar.png', bio TEXT DEFAULT '', phone TEXT DEFAULT '', email_verified INTEGER DEFAULT 0, verification_token TEXT, dark_mode INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS courses (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT DEFAULT '', short_description TEXT DEFAULT '', instructor_id INTEGER NOT NULL, category_id INTEGER, image TEXT DEFAULT '/images/default-course.png', level TEXT DEFAULT 'beginner', price REAL DEFAULT 0, total_lessons INTEGER DEFAULT 0, total_duration INTEGER DEFAULT 0, sections_order TEXT DEFAULT '[]', status TEXT DEFAULT 'draft', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS course_sections (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, title TEXT NOT NULL, order_index INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS lessons (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, section_id INTEGER REFERENCES course_sections(id) ON DELETE SET NULL, title TEXT NOT NULL, content TEXT DEFAULT '', video_url TEXT DEFAULT '', duration INTEGER DEFAULT 0, order_index INTEGER DEFAULT 0, type TEXT DEFAULT 'text', release_date DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS quizzes (id INTEGER PRIMARY KEY AUTOINCREMENT, lesson_id INTEGER NOT NULL, title TEXT NOT NULL, passing_score INTEGER DEFAULT 70, time_limit INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS quiz_questions (id INTEGER PRIMARY KEY AUTOINCREMENT, quiz_id INTEGER NOT NULL, question_text TEXT NOT NULL, question_type TEXT DEFAULT 'multiple_choice', options TEXT DEFAULT '[]', correct_answer TEXT NOT NULL, points INTEGER DEFAULT 1, order_index INTEGER DEFAULT 0, FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS quiz_answers (id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id INTEGER NOT NULL, question_id INTEGER NOT NULL, answer TEXT, is_correct INTEGER DEFAULT 0, FOREIGN KEY (attempt_id) REFERENCES quiz_attempts(id) ON DELETE CASCADE, FOREIGN KEY (question_id) REFERENCES quiz_questions(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS quiz_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, quiz_id INTEGER NOT NULL, score INTEGER DEFAULT 0, total_questions INTEGER DEFAULT 0, passed INTEGER DEFAULT 0, started_at DATETIME, attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS course_exams (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT DEFAULT '', passing_score INTEGER DEFAULT 70, time_limit INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS exam_questions (id INTEGER PRIMARY KEY AUTOINCREMENT, exam_id INTEGER NOT NULL, question_text TEXT NOT NULL, question_type TEXT DEFAULT 'multiple_choice', options TEXT DEFAULT '[]', correct_answer TEXT NOT NULL, points INTEGER DEFAULT 1, order_index INTEGER DEFAULT 0, FOREIGN KEY (exam_id) REFERENCES course_exams(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS exam_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, exam_id INTEGER NOT NULL, score INTEGER DEFAULT 0, total_questions INTEGER DEFAULT 0, passed INTEGER DEFAULT 0, started_at DATETIME, attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (exam_id) REFERENCES course_exams(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS exam_answers (id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id INTEGER NOT NULL, question_id INTEGER NOT NULL, answer TEXT, is_correct INTEGER DEFAULT 0, FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE, FOREIGN KEY (question_id) REFERENCES exam_questions(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS lesson_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, lesson_id INTEGER NOT NULL, user_id INTEGER NOT NULL, content TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL DEFAULT 'info', title TEXT NOT NULL, message TEXT DEFAULT '', related_id INTEGER, related_type TEXT, is_read INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, course_id INTEGER NOT NULL, amount REAL NOT NULL DEFAULT 0, method TEXT DEFAULT 'cash', status TEXT DEFAULT 'pending', paid_at DATETIME, notes TEXT DEFAULT '', coupon_id INTEGER REFERENCES coupons(id) ON DELETE SET NULL, discount_amount REAL DEFAULT 0, stripe_session_id TEXT, receipt_image TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS enrollments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, course_id INTEGER NOT NULL, completed_at DATETIME, enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, course_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS lesson_progress (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, lesson_id INTEGER NOT NULL, completed INTEGER DEFAULT 0, completed_at DATETIME, UNIQUE(user_id, lesson_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS course_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, course_id INTEGER NOT NULL, rating INTEGER NOT NULL, review TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, course_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, lesson_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT DEFAULT '', due_date DATETIME, max_points INTEGER DEFAULT 100, file_allowed INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS assignment_submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, assignment_id INTEGER NOT NULL, user_id INTEGER NOT NULL, file_url TEXT DEFAULT '', notes TEXT DEFAULT '', grade INTEGER, feedback TEXT DEFAULT '', submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP, graded_at DATETIME, UNIQUE(assignment_id, user_id), FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS course_prerequisites (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, prerequisite_course_id INTEGER NOT NULL, UNIQUE(course_id, prerequisite_course_id), FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE, FOREIGN KEY (prerequisite_course_id) REFERENCES courses(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS contact_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, subject TEXT NOT NULL, message TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS password_reset_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token TEXT NOT NULL, used INTEGER DEFAULT 0, expires_at DATETIME NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS course_announcements (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, instructor_id INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE, FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER NOT NULL, receiver_id INTEGER NOT NULL, subject TEXT NOT NULL, content TEXT NOT NULL, is_read INTEGER DEFAULT 0, parent_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS question_bank (id INTEGER PRIMARY KEY AUTOINCREMENT, instructor_id INTEGER NOT NULL, question_text TEXT NOT NULL, question_type TEXT DEFAULT 'multiple_choice', options TEXT DEFAULT '[]', correct_answer TEXT NOT NULL, points INTEGER DEFAULT 1, category TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS learning_paths (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT DEFAULT '', image TEXT DEFAULT '/images/default-course.png', instructor_id INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS learning_path_courses (id INTEGER PRIMARY KEY AUTOINCREMENT, path_id INTEGER NOT NULL, course_id INTEGER NOT NULL, order_index INTEGER DEFAULT 0, FOREIGN KEY (path_id) REFERENCES learning_paths(id) ON DELETE CASCADE, FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE, UNIQUE(path_id, course_id));
CREATE TABLE IF NOT EXISTS coupons (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, discount_percent INTEGER NOT NULL DEFAULT 10, max_uses INTEGER DEFAULT 0, used_count INTEGER DEFAULT 0, expires_at DATETIME, course_id INTEGER, created_by INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL, FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS learning_path_enrollments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, path_id INTEGER NOT NULL, completed_courses TEXT DEFAULT '[]', started_at DATETIME DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (path_id) REFERENCES learning_paths(id) ON DELETE CASCADE, UNIQUE(user_id, path_id));
CREATE TABLE IF NOT EXISTS live_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, instructor_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT DEFAULT '', meeting_url TEXT NOT NULL, meeting_id TEXT DEFAULT '', meeting_password TEXT DEFAULT '', scheduled_at DATETIME NOT NULL, duration INTEGER DEFAULT 60, recording_url TEXT DEFAULT '', status TEXT DEFAULT 'scheduled', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE, FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS cohorts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT '', start_date DATE, end_date DATE, created_by INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS cohort_students (id INTEGER PRIMARY KEY AUTOINCREMENT, cohort_id INTEGER NOT NULL, user_id INTEGER NOT NULL, enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (cohort_id) REFERENCES cohorts(id) ON DELETE CASCADE, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, UNIQUE(cohort_id, user_id));
CREATE TABLE IF NOT EXISTS cohort_courses (id INTEGER PRIMARY KEY AUTOINCREMENT, cohort_id INTEGER NOT NULL, course_id INTEGER NOT NULL, FOREIGN KEY (cohort_id) REFERENCES cohorts(id) ON DELETE CASCADE, FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE, UNIQUE(cohort_id, course_id));
CREATE TABLE IF NOT EXISTS whatsapp_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT DEFAULT 'direct', api_key TEXT DEFAULT '', api_url TEXT DEFAULT '', sender_name TEXT DEFAULT '', is_active INTEGER DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS ai_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT DEFAULT 'gemini', ai_model TEXT DEFAULT 'gemini-2.0-flash', gemini_api_key TEXT DEFAULT '', openai_api_key TEXT DEFAULT '', openai_base_url TEXT DEFAULT '', system_prompt TEXT DEFAULT '', is_active INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS ai_chat_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_courses_instructor_id ON courses(instructor_id);
CREATE INDEX IF NOT EXISTS idx_courses_status ON courses(status);
CREATE INDEX IF NOT EXISTS idx_courses_slug ON courses(slug);
CREATE INDEX IF NOT EXISTS idx_lessons_course_id ON lessons(course_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_lesson_id ON quizzes(lesson_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_id ON quiz_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz_id ON quiz_attempts(quiz_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_user_id ON exam_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_exam_id ON exam_attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_user_id ON lesson_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_lesson_id ON lesson_progress(lesson_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_user_id ON enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course_id ON enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_course_id ON payments(course_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_id ON messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_assignment_id ON assignment_submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_user_id ON assignment_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_lesson_comments_lesson_id ON lesson_comments(lesson_id);
CREATE INDEX IF NOT EXISTS idx_course_reviews_course_id ON course_reviews(course_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_course_announcements_course_id ON course_announcements(course_id);
CREATE INDEX IF NOT EXISTS idx_live_sessions_course_id ON live_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_instructor_id ON question_bank(instructor_id);
CREATE INDEX IF NOT EXISTS idx_learning_paths_instructor_id ON learning_paths(instructor_id);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_quiz_answers_attempt_id ON quiz_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_exam_answers_attempt_id ON exam_answers(attempt_id);
`;

const pgCreateTablesSql = `
CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT DEFAULT 'student', avatar TEXT DEFAULT '/images/default-avatar.png', bio TEXT DEFAULT '', phone TEXT DEFAULT '', email_verified INTEGER DEFAULT 0, verification_token TEXT, dark_mode INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS categories (id SERIAL PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT DEFAULT '', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS courses (id SERIAL PRIMARY KEY, title TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT DEFAULT '', short_description TEXT DEFAULT '', instructor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, image TEXT DEFAULT '/images/default-course.png', level TEXT DEFAULT 'beginner', price REAL DEFAULT 0, total_lessons INTEGER DEFAULT 0, total_duration INTEGER DEFAULT 0, sections_order TEXT DEFAULT '[]', status TEXT DEFAULT 'draft', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS course_sections (id SERIAL PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, title TEXT NOT NULL, order_index INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS lessons (id SERIAL PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, section_id INTEGER REFERENCES course_sections(id) ON DELETE SET NULL, title TEXT NOT NULL, content TEXT DEFAULT '', video_url TEXT DEFAULT '', duration INTEGER DEFAULT 0, order_index INTEGER DEFAULT 0, type TEXT DEFAULT 'text', release_date TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS quizzes (id SERIAL PRIMARY KEY, lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE, title TEXT NOT NULL, passing_score INTEGER DEFAULT 70, time_limit INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS quiz_questions (id SERIAL PRIMARY KEY, quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE, question_text TEXT NOT NULL, question_type TEXT DEFAULT 'multiple_choice', options TEXT DEFAULT '[]', correct_answer TEXT NOT NULL, points INTEGER DEFAULT 1, order_index INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS quiz_answers (id SERIAL PRIMARY KEY, attempt_id INTEGER NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE, question_id INTEGER NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE, answer TEXT, is_correct INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS quiz_attempts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE, score INTEGER DEFAULT 0, total_questions INTEGER DEFAULT 0, passed INTEGER DEFAULT 0, started_at TIMESTAMP, attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS course_exams (id SERIAL PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT DEFAULT '', passing_score INTEGER DEFAULT 70, time_limit INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS exam_questions (id SERIAL PRIMARY KEY, exam_id INTEGER NOT NULL REFERENCES course_exams(id) ON DELETE CASCADE, question_text TEXT NOT NULL, question_type TEXT DEFAULT 'multiple_choice', options TEXT DEFAULT '[]', correct_answer TEXT NOT NULL, points INTEGER DEFAULT 1, order_index INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS exam_attempts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, exam_id INTEGER NOT NULL REFERENCES course_exams(id) ON DELETE CASCADE, score INTEGER DEFAULT 0, total_questions INTEGER DEFAULT 0, passed INTEGER DEFAULT 0, started_at TIMESTAMP, attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS exam_answers (id SERIAL PRIMARY KEY, attempt_id INTEGER NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE, question_id INTEGER NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE, answer TEXT, is_correct INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS lesson_comments (id SERIAL PRIMARY KEY, lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, content TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL DEFAULT 'info', title TEXT NOT NULL, message TEXT DEFAULT '', related_id INTEGER, related_type TEXT, is_read INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS coupons (id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, discount_percent INTEGER NOT NULL DEFAULT 10, max_uses INTEGER DEFAULT 0, used_count INTEGER DEFAULT 0, expires_at TIMESTAMP, course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL, created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS payments (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, amount REAL NOT NULL DEFAULT 0, method TEXT DEFAULT 'cash', status TEXT DEFAULT 'pending', paid_at TIMESTAMP, notes TEXT DEFAULT '', coupon_id INTEGER REFERENCES coupons(id) ON DELETE SET NULL, discount_amount REAL DEFAULT 0, stripe_session_id TEXT, receipt_image TEXT DEFAULT '', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS enrollments (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, completed_at TIMESTAMP, enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, course_id));
CREATE TABLE IF NOT EXISTS lesson_progress (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE, completed INTEGER DEFAULT 0, completed_at TIMESTAMP, UNIQUE(user_id, lesson_id));
CREATE TABLE IF NOT EXISTS course_reviews (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, rating INTEGER NOT NULL, review TEXT DEFAULT '', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, course_id));
CREATE TABLE IF NOT EXISTS assignments (id SERIAL PRIMARY KEY, lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT DEFAULT '', due_date TIMESTAMP, max_points INTEGER DEFAULT 100, file_allowed INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS assignment_submissions (id SERIAL PRIMARY KEY, assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, file_url TEXT DEFAULT '', notes TEXT DEFAULT '', grade INTEGER, feedback TEXT DEFAULT '', submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, graded_at TIMESTAMP, UNIQUE(assignment_id, user_id));
CREATE TABLE IF NOT EXISTS course_prerequisites (id SERIAL PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, prerequisite_course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, UNIQUE(course_id, prerequisite_course_id));
CREATE TABLE IF NOT EXISTS contact_messages (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, subject TEXT NOT NULL, message TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS password_reset_tokens (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, token TEXT NOT NULL, used INTEGER DEFAULT 0, expires_at TIMESTAMP NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS course_announcements (id SERIAL PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, instructor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, subject TEXT NOT NULL, content TEXT NOT NULL, is_read INTEGER DEFAULT 0, parent_id INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS question_bank (id SERIAL PRIMARY KEY, instructor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, question_text TEXT NOT NULL, question_type TEXT DEFAULT 'multiple_choice', options TEXT DEFAULT '[]', correct_answer TEXT NOT NULL, points INTEGER DEFAULT 1, category TEXT DEFAULT '', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS learning_paths (id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '', image TEXT DEFAULT '/images/default-course.png', instructor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS learning_path_courses (id SERIAL PRIMARY KEY, path_id INTEGER NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, order_index INTEGER DEFAULT 0, UNIQUE(path_id, course_id));
CREATE TABLE IF NOT EXISTS learning_path_enrollments (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, path_id INTEGER NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE, completed_courses TEXT DEFAULT '[]', started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMP, UNIQUE(user_id, path_id));
CREATE TABLE IF NOT EXISTS live_sessions (id SERIAL PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, instructor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT DEFAULT '', meeting_url TEXT NOT NULL, meeting_id TEXT DEFAULT '', meeting_password TEXT DEFAULT '', scheduled_at TIMESTAMP NOT NULL, duration INTEGER DEFAULT 60, recording_url TEXT DEFAULT '', status TEXT DEFAULT 'scheduled', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS cohorts (id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', start_date DATE, end_date DATE, created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS cohort_students (id SERIAL PRIMARY KEY, cohort_id INTEGER NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(cohort_id, user_id));
CREATE TABLE IF NOT EXISTS cohort_courses (id SERIAL PRIMARY KEY, cohort_id INTEGER NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, UNIQUE(cohort_id, course_id));
CREATE TABLE IF NOT EXISTS whatsapp_settings (id SERIAL PRIMARY KEY, provider TEXT DEFAULT 'direct', api_key TEXT DEFAULT '', api_url TEXT DEFAULT '', sender_name TEXT DEFAULT '', is_active INTEGER DEFAULT 0, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS ai_settings (id SERIAL PRIMARY KEY, provider TEXT DEFAULT 'gemini', ai_model TEXT DEFAULT 'gemini-2.0-flash', gemini_api_key TEXT DEFAULT '', openai_api_key TEXT DEFAULT '', openai_base_url TEXT DEFAULT '', system_prompt TEXT DEFAULT '', is_active INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS ai_chat_history (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_courses_instructor_id ON courses(instructor_id);
CREATE INDEX IF NOT EXISTS idx_courses_status ON courses(status);
CREATE INDEX IF NOT EXISTS idx_courses_slug ON courses(slug);
CREATE INDEX IF NOT EXISTS idx_lessons_course_id ON lessons(course_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_lesson_id ON quizzes(lesson_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_id ON quiz_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz_id ON quiz_attempts(quiz_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_user_id ON exam_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_exam_id ON exam_attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_user_id ON lesson_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_lesson_id ON lesson_progress(lesson_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_user_id ON enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course_id ON enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_course_id ON payments(course_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_id ON messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_assignment_id ON assignment_submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_user_id ON assignment_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_lesson_comments_lesson_id ON lesson_comments(lesson_id);
CREATE INDEX IF NOT EXISTS idx_course_reviews_course_id ON course_reviews(course_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_course_announcements_course_id ON course_announcements(course_id);
CREATE INDEX IF NOT EXISTS idx_live_sessions_course_id ON live_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_instructor_id ON question_bank(instructor_id);
CREATE INDEX IF NOT EXISTS idx_learning_paths_instructor_id ON learning_paths(instructor_id);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_quiz_answers_attempt_id ON quiz_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_exam_answers_attempt_id ON exam_answers(attempt_id);
`;

async function initializeDatabase() {
  const dbUrl = process.env.DATABASE_URL;

  if (dbUrl) {
    // PostgreSQL mode
    const { Pool } = require('pg');
    pgPool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
    db = pgWrap(pgPool);
    usingPg = true;
    console.log('Connecting to PostgreSQL...');
    const tableStatements = pgCreateTablesSql.split(';').filter(s => s.trim());
    for (const stmt of tableStatements) {
      try { await pgPool.query(stmt); } catch(e) { console.error('Table creation error:', e.message); }
    }
    const pgAlterStmts = [
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT ''",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS dark_mode INTEGER DEFAULT 0",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified INTEGER DEFAULT 0",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token TEXT",
      "ALTER TABLE payments ADD COLUMN IF NOT EXISTS coupon_id INTEGER REFERENCES coupons(id) ON DELETE SET NULL",
      "ALTER TABLE payments ADD COLUMN IF NOT EXISTS discount_amount REAL DEFAULT 0",
      "ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_session_id TEXT",
      "ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_image TEXT DEFAULT ''",
      "ALTER TABLE lessons ADD COLUMN IF NOT EXISTS section_id INTEGER REFERENCES course_sections(id) ON DELETE SET NULL",
      "ALTER TABLE lessons ADD COLUMN IF NOT EXISTS release_date TIMESTAMP",
      "ALTER TABLE courses ADD COLUMN IF NOT EXISTS sections_order TEXT DEFAULT '[]'",
      "ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 0",
      "ALTER TABLE course_exams ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 0",
      "ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS started_at TIMESTAMP",
      "ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS started_at TIMESTAMP",
      "ALTER TABLE assignments ADD COLUMN IF NOT EXISTS max_points INTEGER DEFAULT 100",
      "ALTER TABLE assignments ADD COLUMN IF NOT EXISTS file_allowed INTEGER DEFAULT 1",
      "ALTER TABLE assignments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
    ];
    for (const stmt of pgAlterStmts) { try { await pgPool.query(stmt); } catch(e) { console.log('PG migration note:', e.message); } }
    await seedDataPg();
    console.log('✓ PostgreSQL ready');
    return;
  }

  // SQLite mode
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const dbDir = process.env.DB_PATH || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..');
  try { fs.mkdirSync(dbDir, { recursive: true }); } catch(e) {}
  const dbPath = path.join(dbDir, 'database.sqlite');
  let dbBuffer;
  try { dbBuffer = fs.readFileSync(dbPath); } catch (e) { dbBuffer = null; }
  const dbRaw = new SQL.Database(dbBuffer);
  dbRaw.run("PRAGMA foreign_keys = ON");
  const stmts = createTablesSql.split(';').filter(s => s.trim());
  for (const stmt of stmts) { try { dbRaw.run(stmt); } catch(e) {} }
  const alterStmts = [
    "ALTER TABLE lessons ADD COLUMN section_id INTEGER REFERENCES course_sections(id) ON DELETE SET NULL",
    "ALTER TABLE courses ADD COLUMN sections_order TEXT DEFAULT '[]'",
    "ALTER TABLE quizzes ADD COLUMN max_attempts INTEGER DEFAULT 0",
    "ALTER TABLE course_exams ADD COLUMN max_attempts INTEGER DEFAULT 0",
    "ALTER TABLE quiz_attempts ADD COLUMN started_at DATETIME",
    "ALTER TABLE exam_attempts ADD COLUMN started_at DATETIME",
    "ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN verification_token TEXT",
    "ALTER TABLE users ADD COLUMN dark_mode INTEGER DEFAULT 0",
    "ALTER TABLE payments ADD COLUMN coupon_id INTEGER REFERENCES coupons(id) ON DELETE SET NULL",
    "ALTER TABLE payments ADD COLUMN discount_amount REAL DEFAULT 0",
    "ALTER TABLE payments ADD COLUMN stripe_session_id TEXT",
    "ALTER TABLE payments ADD COLUMN receipt_image TEXT DEFAULT ''",
    "ALTER TABLE lessons ADD COLUMN release_date DATETIME",
    "ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''",
    "ALTER TABLE assignments ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP"
  ];
  for (const stmt of alterStmts) { try { dbRaw.run(stmt); } catch(e) {} }
  db = sqliteWrap(dbRaw);
  await seedDataSqlite();
  saveDatabase();
  console.log('✓ SQLite ready');
}

async function seedDataSqlite() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@manassa.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const adminName = process.env.ADMIN_NAME || 'المشرف العام';
  if (!db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail)) {
    db.prepare('INSERT INTO users (name, email, password, role, email_verified) VALUES (?, ?, ?, ?, 1)').run(adminName, adminEmail, bcrypt.hashSync(adminPassword, 10), 'admin');
  }
  db.prepare('DELETE FROM categories').run();
  var catStmt = db.prepare('INSERT OR IGNORE INTO categories (name, slug, description) VALUES (?, ?, ?)');
  catStmt.run('تشريح الفم', 'anatomy', 'علم تشريح الفم والأسنان والفكين');
  catStmt.run('تقويم الأسنان', 'orthodontics', 'تقويم وتصحيح اصطفاف الأسنان');
  catStmt.run('جراحة الفم', 'oral-surgery', 'العمليات الجراحية في الفم والفكين');
  catStmt.run('تركيبات الأسنان', 'prosthodontics', 'التعويضات السنية والتركيبات الثابتة والمتحركة');
  catStmt.run('طب أسنان الأطفال', 'pediatric', 'رعاية صحة أسنان الأطفال');
  catStmt.run('أمراض اللثة', 'periodontics', 'تشخيص وعلاج أمراض اللثة');
  catStmt.run('التشخيص الإشعاعي', 'radiology', 'الأشعة السينية والتصوير الطبي للأسنان');
  catStmt.run('طب الأسنان التحفظي', 'conservative', 'علاج التسوس وحشو الأسنان');
  // حسابات تجريبية للتطوير فقط — لا تُنشأ في الإنتاج
  if (process.env.NODE_ENV !== 'production') {
    if (db.prepare('SELECT COUNT(*) as count FROM courses').get().count === 0) {
      if (!db.prepare('SELECT id FROM users WHERE email = ?').get('instructor@manassa.com')) {
        db.prepare('INSERT INTO users (name, email, password, role, email_verified) VALUES (?, ?, ?, ?, 1)').run('مدرب تجريبي', 'instructor@manassa.com', bcrypt.hashSync('123456', 10), 'instructor');
      }
      if (!db.prepare('SELECT id FROM users WHERE email = ?').get('student@manassa.com')) {
        db.prepare('INSERT INTO users (name, email, password, role, email_verified) VALUES (?, ?, ?, ?, 1)').run('طالب تجريبي', 'student@manassa.com', bcrypt.hashSync('123456', 10), 'student');
      }
    }
  }
}

async function seedDataPg() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@manassa.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const adminName = process.env.ADMIN_NAME || 'المشرف العام';
  if (!(await db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail))) {
    const hash = bcrypt.hashSync(adminPassword, 10);
    await db.prepare('INSERT INTO users (name, email, password, role, email_verified) VALUES (?, ?, ?, ?, 1)').run(adminName, adminEmail, hash, 'admin');
  }
  await db.prepare('DELETE FROM categories').run();
  var pgCatStmt = await db.prepare('INSERT INTO categories (name, slug, description) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING');
  await pgCatStmt.run('تشريح الفم', 'anatomy', 'علم تشريح الفم والأسنان والفكين');
  await pgCatStmt.run('تقويم الأسنان', 'orthodontics', 'تقويم وتصحيح اصطفاف الأسنان');
  await pgCatStmt.run('جراحة الفم', 'oral-surgery', 'العمليات الجراحية في الفم والفكين');
  await pgCatStmt.run('تركيبات الأسنان', 'prosthodontics', 'التعويضات السنية والتركيبات الثابتة والمتحركة');
  await pgCatStmt.run('طب أسنان الأطفال', 'pediatric', 'رعاية صحة أسنان الأطفال');
  await pgCatStmt.run('أمراض اللثة', 'periodontics', 'تشخيص وعلاج أمراض اللثة');
  await pgCatStmt.run('التشخيص الإشعاعي', 'radiology', 'الأشعة السينية والتصوير الطبي للأسنان');
  await pgCatStmt.run('طب الأسنان التحفظي', 'conservative', 'علاج التسوس وحشو الأسنان');
  // حسابات تجريبية للتطوير فقط — لا تُنشأ في الإنتاج
  if (process.env.NODE_ENV !== 'production') {
    if (Number((await db.prepare('SELECT COUNT(*) as count FROM courses').get()).count) === 0) {
      if (!(await db.prepare('SELECT id FROM users WHERE email = ?').get('instructor@manassa.com'))) {
        await db.prepare('INSERT INTO users (name, email, password, role, email_verified) VALUES (?, ?, ?, ?, 1)').run('مدرب تجريبي', 'instructor@manassa.com', bcrypt.hashSync('123456', 10), 'instructor');
      }
      if (!(await db.prepare('SELECT id FROM users WHERE email = ?').get('student@manassa.com'))) {
        await db.prepare('INSERT INTO users (name, email, password, role, email_verified) VALUES (?, ?, ?, ?, 1)').run('طالب تجريبي', 'student@manassa.com', bcrypt.hashSync('123456', 10), 'student');
      }
    }
  }
}

function saveDatabase() {
  if (usingPg) return;
  if (db && db.raw) {
    const data = db.raw.export();
    const buffer = Buffer.from(data);
    var dbDir = process.env.DB_PATH || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..');
    try { fs.mkdirSync(dbDir, { recursive: true }); } catch(e) {}
    var dbPath = path.join(dbDir, 'database.sqlite');
    var tmpPath = dbPath + '.tmp';
    try { fs.writeFileSync(tmpPath, buffer); fs.renameSync(tmpPath, dbPath); } catch(e) { fs.writeFileSync(dbPath, buffer); }
  }
}

function getDb() { return db; }

function sqlNow(offset) {
  var allowed = { '-7 days': 1, '-30 days': 1, '-1 days': 1, 'start of month': 1, 'start of day': 1 };
  if (offset && !allowed[offset]) offset = null;
  if (usingPg) {
    if (offset === 'start of day') return "date_trunc('day', NOW())";
    if (offset) return `NOW() - INTERVAL '${offset}'`;
    return 'NOW()';
  }
  if (offset) return `datetime('now', '${offset}')`;
  return "datetime('now')";
}

module.exports = { getDb, initializeDatabase, saveDatabase, sqlNow, isUsingPg: () => usingPg };
