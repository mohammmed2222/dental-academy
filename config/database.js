const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

let db = null;

function wrap(dbRaw) {
  return {
    raw: dbRaw,
    prepare(sql) {
      const self = this;
      return {
        get(...params) {
          const stmt = dbRaw.prepare(sql);
          if (params.length > 0) stmt.bind(params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
          if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
          }
          stmt.free();
          return undefined;
        },
        all(...params) {
          const rows = [];
          const stmt = dbRaw.prepare(sql);
          if (params.length > 0) stmt.bind(params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          stmt.free();
          return rows;
        },
        run(...params) {
          const stmt = dbRaw.prepare(sql);
          if (params.length > 0) stmt.bind(params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
          stmt.step();
          const result = { lastInsertRowid: dbRaw.exec("SELECT last_insert_rowid() as id")[0]?.values[0][0] };
          stmt.free();
          return result;
        },
        iterate() { return [][Symbol.iterator](); }
      };
    },
    exec(sql) {
      return dbRaw.exec(sql);
    }
  };
}

async function initializeDatabase() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  const dbDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..');
  const dbPath = path.join(dbDir, 'database.sqlite');
  
  let dbBuffer;
  try { dbBuffer = fs.readFileSync(dbPath); } catch (e) { dbBuffer = null; }
  
  const dbRaw = new SQL.Database(dbBuffer);
  dbRaw.run("PRAGMA foreign_keys = ON");

  dbRaw.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      bio TEXT DEFAULT '',
      avatar TEXT DEFAULT '/images/default-avatar.png',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      short_description TEXT DEFAULT '',
      instructor_id INTEGER NOT NULL,
      category_id INTEGER,
      image TEXT DEFAULT '/images/default-course.png',
      level TEXT DEFAULT 'beginner',
      status TEXT DEFAULT 'draft',
      price REAL DEFAULT 0,
      total_lessons INTEGER DEFAULT 0,
      total_duration INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      video_url TEXT DEFAULT '',
      order_index INTEGER DEFAULT 0,
      duration INTEGER DEFAULT 0,
      type TEXT DEFAULT 'text',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      passing_score INTEGER DEFAULT 70,
      time_limit INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS quiz_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER NOT NULL,
      question_text TEXT NOT NULL,
      question_type TEXT DEFAULT 'multiple_choice',
      options TEXT DEFAULT '[]',
      correct_answer TEXT NOT NULL,
      points INTEGER DEFAULT 1,
      order_index INTEGER DEFAULT 0,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      course_id INTEGER NOT NULL,
      enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
      UNIQUE(user_id, course_id)
    );

    CREATE TABLE IF NOT EXISTS lesson_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      lesson_id INTEGER NOT NULL,
      completed INTEGER DEFAULT 0,
      completed_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
      UNIQUE(user_id, lesson_id)
    );

    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      quiz_id INTEGER NOT NULL,
      score INTEGER DEFAULT 0,
      total_questions INTEGER DEFAULT 0,
      passed INTEGER DEFAULT 0,
      attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS quiz_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      answer TEXT,
      is_correct INTEGER DEFAULT 0,
      FOREIGN KEY (attempt_id) REFERENCES quiz_attempts(id) ON DELETE CASCADE,
      FOREIGN KEY (question_id) REFERENCES quiz_questions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      due_date DATETIME,
      max_points INTEGER DEFAULT 100,
      file_allowed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assignment_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT DEFAULT '',
      file_path TEXT DEFAULT '',
      score INTEGER DEFAULT 0,
      feedback TEXT DEFAULT '',
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      graded_at DATETIME,
      FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(assignment_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS course_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      rating INTEGER CHECK(rating >= 1 AND rating <= 5),
      review_text TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(course_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS course_prerequisites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      prerequisite_course_id INTEGER NOT NULL,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
      FOREIGN KEY (prerequisite_course_id) REFERENCES courses(id) ON DELETE CASCADE,
      UNIQUE(course_id, prerequisite_course_id)
    );

    CREATE TABLE IF NOT EXISTS course_exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      passing_score INTEGER DEFAULT 70,
      time_limit INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS exam_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL,
      question_text TEXT NOT NULL,
      question_type TEXT DEFAULT 'multiple_choice',
      options TEXT DEFAULT '[]',
      correct_answer TEXT NOT NULL,
      points INTEGER DEFAULT 1,
      order_index INTEGER DEFAULT 0,
      FOREIGN KEY (exam_id) REFERENCES course_exams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS exam_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      exam_id INTEGER NOT NULL,
      score INTEGER DEFAULT 0,
      total_questions INTEGER DEFAULT 0,
      passed INTEGER DEFAULT 0,
      attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (exam_id) REFERENCES course_exams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS exam_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      answer TEXT,
      is_correct INTEGER DEFAULT 0,
      FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE,
      FOREIGN KEY (question_id) REFERENCES exam_questions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lesson_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'info',
      title TEXT NOT NULL,
      message TEXT DEFAULT '',
      related_id INTEGER,
      related_type TEXT,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      course_id INTEGER NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      method TEXT DEFAULT 'cash',
      status TEXT DEFAULT 'pending',
      paid_at DATETIME,
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS course_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      order_index INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    );

  `);

  try { dbRaw.run("ALTER TABLE lessons ADD COLUMN section_id INTEGER REFERENCES course_sections(id) ON DELETE SET NULL"); } catch(e) {}
  try { dbRaw.run("ALTER TABLE courses ADD COLUMN sections_order TEXT DEFAULT '[]'"); } catch(e) {}

  db = wrap(dbRaw);

  const adminExists = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@manassa.com');
  if (!adminExists) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run(
      'المشرف العام', 'admin@manassa.com', hashedPassword, 'admin'
    );
  }

  const categoriesCount = db.prepare('SELECT COUNT(*) as count FROM categories').get();
  if (categoriesCount.count === 0) {
    const categories = [
      ['تطوير الويب', 'web-development', 'كل ما يخص تطوير مواقع الويب وتطبيقاتها'],
      ['علوم الحاسوب', 'computer-science', 'أساسيات علوم الحاسوب والخوارزميات'],
      ['تطوير التطبيقات', 'app-development', 'تطوير تطبيقات الأندرويد و iOS'],
      ['تصميم الجرافيك', 'graphic-design', 'التصميم الجرافيكي والمرئي'],
      ['تسويق إلكتروني', 'digital-marketing', 'التسويق الرقمي وإدارة وسائل التواصل'],
      ['علوم البيانات', 'data-science', 'تحليل البيانات وتعلم الآلة'],
      ['الأمن السيبراني', 'cybersecurity', 'أمن المعلومات وحماية الشبكات'],
      ['لغات البرمجة', 'programming-languages', 'تعلم لغات البرمجة المختلفة'],
    ];
    for (const cat of categories) {
      db.prepare('INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)').run(cat[0], cat[1], cat[2]);
    }
  }

  saveDatabase();
  return db;
}

function saveDatabase() {
  if (db && db.raw) {
    const data = db.raw.export();
    const buffer = Buffer.from(data);
    const dbDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..');
    fs.writeFileSync(path.join(dbDir, 'database.sqlite'), buffer);
  }
}

function getDb() { return db; }

module.exports = { getDb, initializeDatabase, saveDatabase };
