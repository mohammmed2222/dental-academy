const express = require('express');
const { getDb } = require('../config/database');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const { generate, chat, generateQuiz, summarize, gradeAssignment, recommend, getSettings, saveSettings } = require('../config/ai');

var router = express.Router();

// صفحة الذكاء الاصطناعي الرئيسية
router.get('/', isAuthenticated, async function(req, res, next) {
  try {
    var settings = await getSettings();
    var db = getDb();
    var history = await db.prepare('SELECT * FROM ai_chat_history WHERE user_id = ? ORDER BY created_at ASC LIMIT 50').all(req.session.userId);
    return res.render('ai/index', { title: 'الذكاء الاصطناعي', settings, history, error: null, result: null });
  } catch (err) { next(err); }
});

// شات مع الذكاء الاصطناعي
router.post('/chat', isAuthenticated, async function(req, res, next) {
  try {
    var db = getDb();
    var message = (req.body.message || '').trim();
    if (!message) return res.json({ error: 'الرجاء كتابة رسالة' });
    var settings = await getSettings();
    if (!settings.is_active) return res.json({ error: 'الذكاء الاصطناعي غير مفعل. يرجى تفعيله من الإعدادات.' });
    await db.prepare('INSERT INTO ai_chat_history (user_id, role, content) VALUES (?, ?, ?)').run(req.session.userId, 'user', message);
    var history = await db.prepare('SELECT role, content FROM ai_chat_history WHERE user_id = ? ORDER BY created_at ASC LIMIT 20').all(req.session.userId);
    var messages = history.map(function(h) { return { role: h.role, content: h.content }; });
    var sysPrompt = settings.system_prompt || 'أنت مساعد ذكي متخصص في طب الأسنان. أجب باللغة العربية الفصحى البسيطة. اسمك "مساعد الأكاديمية". كن مفيداً ودقيقاً.';
    var result = await chat(messages, { systemPrompt: sysPrompt });
    if (result.error) return res.json({ error: result.error });
    await db.prepare('INSERT INTO ai_chat_history (user_id, role, content) VALUES (?, ?, ?)').run(req.session.userId, 'assistant', result.text);
    return res.json({ text: result.text });
  } catch (err) { next(err); }
});

// توليد أسئلة
router.post('/generate-quiz', isAuthenticated, async function(req, res, next) {
  try {
    var topic = (req.body.topic || '').trim();
    var count = parseInt(req.body.count) || 5;
    if (!topic) return res.json({ error: 'الرجاء إدخال الموضوع' });
    var result = await generateQuiz(topic, count);
    return res.json(result);
  } catch (err) { next(err); }
});

// تلخيص محتوى
router.post('/summarize', isAuthenticated, async function(req, res, next) {
  try {
    var content = (req.body.content || '').trim();
    if (!content) return res.json({ error: 'الرجاء إدخال المحتوى' });
    var result = await summarize(content);
    return res.json(result);
  } catch (err) { next(err); }
});

// تصحيح واجب
router.post('/grade', isInstructorOrAdmin, async function(req, res, next) {
  try {
    var { question, answer, maxPoints } = req.body;
    if (!question || !answer) return res.json({ error: 'السؤال والإجابة مطلوبان' });
    var result = await gradeAssignment(question, answer, parseInt(maxPoints) || 10);
    return res.json(result);
  } catch (err) { next(err); }
});

// توصيات
router.get('/recommendations', isAuthenticated, async function(req, res, next) {
  try {
    var result = await recommend(req.session.userId, parseInt(req.query.limit) || 6);
    return res.json(result);
  } catch (err) { next(err); }
});

// البحث الذكي
router.post('/search', isAuthenticated, async function(req, res, next) {
  try {
    var query = (req.body.query || '').trim();
    if (!query) return res.json({ results: [] });
    var db = getDb();
    var courses = await db.prepare("SELECT id, title, description, slug FROM courses WHERE status = 'published' ORDER BY title LIMIT 30").all();
    var lessons = await db.prepare('SELECT l.id, l.title, l.content, c.title as course_title FROM lessons l JOIN courses c ON l.course_id = c.id WHERE c.status = ? ORDER BY l.title LIMIT 30').all('published');
    var courseContext = courses.map(function(c) { return 'دورة: ' + c.title + ' - ' + (c.description || '').slice(0, 200); }).join('\n');
    var lessonContext = lessons.map(function(l) { return 'درس: ' + l.title + ' (في: ' + l.course_title + ') - ' + (l.content || '').slice(0, 200); }).join('\n');
    var prompt = 'محتوى المنصة:\n' + courseContext + '\n' + lessonContext + '\n\nسؤال المستخدم: ' + query + '\n\nأجب على السؤال بناءً على المحتوى أعلاه فقط. إذا لم تجد إجابة، قل "لم أجد معلومات عن هذا في المنصة". كن دقيقاً ومختصراً.';
    var result = await generate(prompt, { temperature: 0.2, maxTokens: 1024 });
    return res.json(result);
  } catch (err) { next(err); }
});

// مسح تاريخ الشات
router.post('/clear-history', isAuthenticated, async function(req, res, next) {
  try {
    var db = getDb();
    await db.prepare('DELETE FROM ai_chat_history WHERE user_id = ?').run(req.session.userId);
    return res.json({ success: true });
  } catch (err) { next(err); }
});

// إعدادات AI (للمشرف فقط)
router.get('/settings', isAdmin, async function(req, res, next) {
  try {
    var settings = await getSettings();
    return res.render('ai/settings', { title: 'إعدادات الذكاء الاصطناعي', settings, error: null, success: null });
  } catch (err) { next(err); }
});

router.post('/settings', isAdmin, async function(req, res, next) {
  try {
    var { provider, ai_model, gemini_api_key, openai_api_key, openai_base_url, system_prompt, is_active } = req.body;
    await saveSettings({
      provider: provider || 'gemini',
      ai_model: ai_model || 'gemini-2.0-flash',
      gemini_api_key: gemini_api_key || '',
      openai_api_key: openai_api_key || '',
      openai_base_url: openai_base_url || '',
      system_prompt: system_prompt || '',
      is_active: is_active === 'on' || is_active === '1'
    });
    return res.render('ai/settings', { title: 'إعدادات الذكاء الاصطناعي', settings: await getSettings(), error: null, success: 'تم حفظ الإعدادات بنجاح' });
  } catch (err) { next(err); }
});

// مساعد وسيط لـ isInstructorOrAdmin
async function isInstructorOrAdmin(req, res, next) {
  if (req.session && req.session.userId && (req.session.role === 'instructor' || req.session.role === 'admin')) return next();
  return res.status(403).json({ error: 'غير مصرح' });
}

module.exports = router;
