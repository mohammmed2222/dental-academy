const { getDb } = require('./database');

var providers = {};

function escapePrompt(text) {
  return (text || '').toString().trim();
}

// =========== Google Gemini Provider ===========
providers.gemini = {
  name: 'Google Gemini',
  defaultModel: 'gemini-2.0-flash',
  async init() {
    var settings = await getSettings();
    var key = settings.gemini_api_key || process.env.GEMINI_API_KEY || '';
    if (!key) return false;
    return { apiKey: key, model: settings.ai_model || this.defaultModel };
  },
  async generate(prompt, opts) {
    var ctx = await this.init();
    if (!ctx) return { error: 'مفتاح Gemini API غير مضبوط' };
    var model = opts.model || ctx.model;
    var data = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: opts.temperature || 0.7, maxOutputTokens: opts.maxTokens || 2048 } };
    if (opts.systemPrompt) data.systemInstruction = { parts: [{ text: opts.systemPrompt }] };
    var res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + ctx.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) return { error: 'خطأ في Gemini: ' + (await res.text()).slice(0, 200) };
    var json = await res.json();
    var text = '';
    try { text = json.candidates[0].content.parts[0].text; } catch (e) { text = 'تعذر الحصول على رد'; }
    return { text: text };
  },
  async chat(messages, opts) {
    var ctx = await this.init();
    if (!ctx) return { error: 'مفتاح Gemini API غير مضبوط' };
    var model = opts.model || ctx.model;
    var contents = messages.map(function(m) { return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }; });
    var data = { contents: contents, generationConfig: { temperature: opts.temperature || 0.7, maxOutputTokens: opts.maxTokens || 4096 } };
    if (opts.systemPrompt) data.systemInstruction = { parts: [{ text: opts.systemPrompt }] };
    var res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + ctx.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) return { error: 'خطأ في Gemini: ' + (await res.text()).slice(0, 200) };
    var json = await res.json();
    var text = '';
    try { text = json.candidates[0].content.parts[0].text; } catch (e) { text = 'تعذر الحصول على رد'; }
    return { text: text };
  }
};

// =========== OpenAI-compatible Provider ===========
providers.openai = {
  name: 'OpenAI',
  defaultModel: 'gpt-4o-mini',
  async init() {
    var settings = await getSettings();
    var key = settings.openai_api_key || process.env.OPENAI_API_KEY || '';
    if (!key) return false;
    return { apiKey: key, model: settings.ai_model || this.defaultModel, baseUrl: settings.openai_base_url || 'https://api.openai.com/v1' };
  },
  async generate(prompt, opts) {
    var ctx = await this.init();
    if (!ctx) return { error: 'مفتاح OpenAI API غير مضبوط' };
    var model = opts.model || ctx.model;
    var messages = [];
    if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
    messages.push({ role: 'user', content: prompt });
    var res = await fetch(ctx.baseUrl + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ctx.apiKey }, body: JSON.stringify({ model: model, messages: messages, temperature: opts.temperature || 0.7, max_tokens: opts.maxTokens || 2048 }) });
    if (!res.ok) { var errText = await res.text(); return { error: 'خطأ OpenAI: ' + errText.slice(0, 200) }; }
    var json = await res.json();
    var text = json.choices && json.choices[0] && json.choices[0].message ? json.choices[0].message.content : 'تعذر الحصول على رد';
    return { text: text };
  },
  async chat(messages, opts) {
    var ctx = await this.init();
    if (!ctx) return { error: 'مفتاح OpenAI API غير مضبوط' };
    var model = opts.model || ctx.model;
    var msgs = [];
    if (opts.systemPrompt) msgs.push({ role: 'system', content: opts.systemPrompt });
    for (var m of messages) msgs.push({ role: m.role, content: m.content });
    var res = await fetch(ctx.baseUrl + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ctx.apiKey }, body: JSON.stringify({ model: model, messages: msgs, temperature: opts.temperature || 0.7, max_tokens: opts.maxTokens || 4096 }) });
    if (!res.ok) { var errText = await res.text(); return { error: 'خطأ OpenAI: ' + errText.slice(0, 200) }; }
    var json = await res.json();
    var text = json.choices && json.choices[0] && json.choices[0].message ? json.choices[0].message.content : 'تعذر الحصول على رد';
    return { text: text };
  }
};

// =========== System ===========

async function getSettings() {
  var db = getDb();
  var row = db && db.prepare ? db.prepare('SELECT * FROM ai_settings ORDER BY id DESC LIMIT 1').get() : null;
  if (!row) return { provider: 'gemini', ai_model: 'gemini-2.0-flash', gemini_api_key: '', openai_api_key: '', openai_base_url: '', system_prompt: '', is_active: 0 };
  return row;
}

async function saveSettings(s) {
  var db = getDb();
  await db.prepare('DELETE FROM ai_settings').run();
  await db.prepare('INSERT INTO ai_settings (provider, ai_model, gemini_api_key, openai_api_key, openai_base_url, system_prompt, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)').run(s.provider || 'gemini', s.ai_model || 'gemini-2.0-flash', s.gemini_api_key || '', s.openai_api_key || '', s.openai_base_url || '', s.system_prompt || '', s.is_active ? 1 : 0);
}

async function getProvider() {
  var settings = await getSettings();
  var p = providers[settings.provider];
  if (!p) return providers.gemini;
  return p;
}

async function generate(prompt, opts) {
  var p = await getProvider();
  return p.generate(prompt, opts || {});
}

async function chat(messages, opts) {
  var p = await getProvider();
  return p.chat(messages, opts || {});
}

async function generateQuiz(topic, count, opts) {
  var db = getDb();
  var settings = await getSettings();
  var sysPrompt = settings.system_prompt || 'أنت مساعد أكاديمي متخصص في طب الأسنان. أجب باللغة العربية الفصحى البسيطة.';
  var prompt = 'قم بتوليد ' + (count || 5) + ' أسئلة اختيار من متعدد عن موضوع: "' + topic + '".\n\nالمطلوب لكل سؤال:\n- question: نص السؤال\n- options: 4 خيارات (array)\n- correctAnswer: index الخيار الصحيح (0-3)\n\nأعد النتيجة كـ JSON array فقط بدون أي نص إضافي.';
  var result = await generate(prompt, { systemPrompt: sysPrompt, temperature: 0.3, maxTokens: 4096 });
  if (result.error) return result;
  try {
    var text = result.text;
    var jsonStart = text.indexOf('[');
    var jsonEnd = text.lastIndexOf(']');
    if (jsonStart === -1 || jsonEnd === -1) return { error: 'لم يتمكن الذكاء الاصطناعي من إنشاء أسئلة صالحة' };
    var questions = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
    return { questions: questions };
  } catch (e) {
    return { error: 'خطأ في تحليل الأسئلة: ' + e.message };
  }
}

async function summarize(content, opts) {
  var settings = await getSettings();
  var sysPrompt = settings.system_prompt || 'أنت مساعد أكاديمي متخصص في تلخيص المحتوى.';
  var prompt = 'لخص المحتوى التالي في نقاط مختصرة ومفيدة باللغة العربية:\n\n' + content;
  return generate(prompt, { systemPrompt: sysPrompt, temperature: 0.3, maxTokens: 2048 });
}

async function gradeAssignment(question, answer, maxPoints) {
  var prompt = 'أنت مصحح أكاديمي. قيم الإجابة التالية على السؤال المطروح.\n\nالسؤال: ' + question + '\n\nإجابة الطالب: ' + answer + '\n\nأعطني:\n1. الدرجة من ' + (maxPoints || 10) + '\n2. تقييم عام\n3. ملاحظات للتحسين\n\nأعد النتيجة كـ JSON: { "grade": number, "feedback": "text", "notes": "text" }';
  var result = await generate(prompt, { systemPrompt: 'أنت مصحح أكاديمي صارم وعادل. أجب بالعربية.', temperature: 0.3 });
  if (result.error) return result;
  try {
    var text = result.text;
    var jsonStart = text.indexOf('{');
    var jsonEnd = text.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) return { error: 'لم يتمكن الذكاء الاصطناعي من التصحيح' };
    return JSON.parse(text.substring(jsonStart, jsonEnd + 1));
  } catch (e) {
    return { error: 'خطأ في تحليل التصحيح: ' + e.message };
  }
}

async function recommend(userId, limit) {
  var db = getDb();
  var courses = db.prepare('SELECT c.id, c.title, c.description, c.level, cat.name as category_name FROM courses c LEFT JOIN categories cat ON c.category_id = cat.id WHERE c.status = ? ORDER BY RANDOM() LIMIT 20').all('published');
  var enrollments = db.prepare('SELECT c.id, c.title, c.level FROM enrollments e JOIN courses c ON e.course_id = c.id WHERE e.user_id = ?').all(userId);
  if (courses.length === 0) return { courses: [] };
  if (enrollments.length === 0) {
    return { courses: courses.slice(0, (limit || 6)) };
  }
  var enrolledIds = enrollments.map(function(e) { return e.id; });
  var userProfile = enrollments.map(function(e) { return e.title + ' (مستوى: ' + e.level + ')'; }).join('، ');
  var courseList = courses.filter(function(c) { return enrolledIds.indexOf(c.id) === -1; }).slice(0, 15).map(function(c) { return c.id + ': ' + c.title + ' - ' + (c.category_name || 'عام') + ' - مستوى: ' + c.level; }).join('\n');
  var prompt = 'طالب مسجل في الدورات التالية:\n' + userProfile + '\n\nالدورات المتاحة:\n' + courseList + '\n\nبناءً على تاريخ الطالب، اختر أفضل ' + (limit || 6) + ' دورات مقترحة له. أعد فقط أرقام المعرفات (id) مفصولة بفواصل.';
  var result = await generate(prompt, { temperature: 0.2, maxTokens: 256 });
  if (result.error) return { courses: courses.slice(0, (limit || 6)) };
  var ids = (result.text.match(/\d+/g) || []).map(Number);
  var recommended = ids.map(function(id) { return courses.find(function(c) { return c.id === id; }); }).filter(Boolean);
  if (recommended.length === 0) recommended = courses.slice(0, (limit || 6));
  return { courses: recommended.slice(0, (limit || 6)) };
}

async function setupAiTable() {
  var db = getDb();
  try {
    db.prepare('CREATE TABLE IF NOT EXISTS ai_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT DEFAULT \'gemini\', ai_model TEXT DEFAULT \'gemini-2.0-flash\', gemini_api_key TEXT DEFAULT \'\', openai_api_key TEXT DEFAULT \'\', openai_base_url TEXT DEFAULT \'\', system_prompt TEXT DEFAULT \'\', is_active INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)').run();
  } catch (e) {}
  try {
    db.prepare('CREATE TABLE IF NOT EXISTS ai_chat_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)').run();
  } catch (e) {}
}

module.exports = { generate, chat, generateQuiz, summarize, gradeAssignment, recommend, getSettings, saveSettings, setupAiTable, providers };
