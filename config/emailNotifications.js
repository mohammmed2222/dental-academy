const { getDb } = require('./database');
const { sendMail } = require('./mail');

var APP_NAME = 'أكاديمية طب الأسنان';
var APP_URL = (process.env.APP_URL || 'https://dental-academy-production.up.railway.app').replace(/\/+$/, '');
var APP_LOGO = APP_URL + '/favicon.png';

var NOTIFICATION_TYPES = {
  message:      { label: 'رسائل خاصة',  default: true },
  comment:      { label: 'تعليقات على الدروس', default: true },
  grade:        { label: 'تصحيح الواجبات والاختبارات', default: true },
  payment:      { label: 'تأكيد المدفوعات', default: true },
  enrollment:   { label: 'التسجيل في الدورات', default: true },
  course:       { label: 'دورات جديدة وتحديثات', default: true },
  announcement: { label: 'إعلانات المدربين', default: true },
  learning:     { label: 'المسارات التعليمية', default: true },
  welcome:      { label: 'رسائل الترحيب', default: true }
};

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
  });
}

function emailLayout({ title, body, ctaUrl, ctaText, footerNote }) {
  var safeTitle = escapeHtml(title);
  var safeCtaText = ctaText ? escapeHtml(ctaText) : '';
  var safeFooter = escapeHtml(footerNote || 'هذا بريد تلقائي، لا ترد عليه.');
  return '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + safeTitle + '</title></head>' +
    '<body style="margin:0;padding:0;background:#f5f3ee;font-family:IBM Plex Sans Arabic,Segoe UI,Tahoma,sans-serif;color:#1b1c19">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5f3ee;padding:24px 0"><tr><td align="center">' +
    '<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06)">' +
    '<tr><td style="background:#a30019;padding:24px;text-align:center"><img src="' + APP_LOGO + '" alt="' + APP_NAME + '" width="48" height="48" style="display:inline-block;vertical-align:middle;background:#fff;border-radius:8px;padding:4px"/>' +
    '<h1 style="margin:8px 0 0;color:#ffffff;font-size:20px;font-weight:600">' + APP_NAME + '</h1></td></tr>' +
    '<tr><td style="padding:32px 28px">' +
    '<h2 style="margin:0 0 16px;color:#1b1c19;font-size:22px;font-weight:600;line-height:1.4">' + safeTitle + '</h2>' +
    '<div style="font-size:16px;line-height:1.7;color:#3a3c3e">' + body + '</div>' +
    (ctaUrl ? '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px auto 0"><tr><td style="border-radius:8px;background:#a30019"><a href="' + escapeHtml(ctaUrl) + '" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">' + safeCtaText + '</a></td></tr></table>' : '') +
    '</td></tr>' +
    '<tr><td style="padding:20px 28px;background:#fbf9f4;border-top:1px solid #e4e2dd;font-size:13px;color:#777;text-align:center">' +
    '<p style="margin:0 0 8px">' + safeFooter + '</p>' +
    '<p style="margin:0"><a href="' + APP_URL + '/dashboard/notification-settings" style="color:#a30019;text-decoration:none">إدارة تفضيلات الإشعارات</a></p>' +
    '<p style="margin:8px 0 0;color:#999;font-size:12px">&copy; ' + new Date().getFullYear() + ' ' + APP_NAME + '</p>' +
    '</td></tr></table></td></tr></table></body></html>';
}

var TEMPLATES = {
  message: function(ctx) {
    return {
      subject: 'رسالة جديدة من ' + ctx.senderName,
      html: emailLayout({
        title: 'لديك رسالة جديدة',
        body: '<p>مرحباً <strong>' + escapeHtml(ctx.recipientName) + '</strong>،</p>' +
              '<p>أرسل لك <strong>' + escapeHtml(ctx.senderName) + '</strong> رسالة جديدة في ' + APP_NAME + ':</p>' +
              '<blockquote style="margin:16px 0;padding:12px 16px;border-right:4px solid #a30019;background:#fbf9f4;border-radius:6px">' +
              '<p style="margin:0 0 4px;font-weight:600">الموضوع: ' + escapeHtml(ctx.subject) + '</p>' +
              '<p style="margin:0;color:#5c3f3d">' + escapeHtml(ctx.preview) + '</p></blockquote>',
        ctaUrl: APP_URL + '/messages/conversation/' + ctx.senderId,
        ctaText: 'فتح المحادثة'
      })
    };
  },

  comment: function(ctx) {
    return {
      subject: 'تعليق جديد على درسك: ' + ctx.lessonTitle,
      html: emailLayout({
        title: 'تعليق جديد على درسك',
        body: '<p>عَلَّق <strong>' + escapeHtml(ctx.commenterName) + '</strong> على درسك في دورة <strong>' + escapeHtml(ctx.courseTitle) + '</strong>:</p>' +
              '<blockquote style="margin:16px 0;padding:12px 16px;border-right:4px solid #a30019;background:#fbf9f4;border-radius:6px">' +
              '<p style="margin:0 0 4px;font-weight:600">' + escapeHtml(ctx.lessonTitle) + '</p>' +
              '<p style="margin:0;color:#5c3f3d">' + escapeHtml(ctx.commentPreview) + '</p></blockquote>',
        ctaUrl: APP_URL + '/lessons/' + ctx.lessonId,
        ctaText: 'عرض التعليق'
      })
    };
  },

  grade: function(ctx) {
    return {
      subject: 'تم تصحيح ' + ctx.itemType + ': ' + ctx.itemTitle,
      html: emailLayout({
        title: 'تم تصحيح ' + ctx.itemType,
        body: '<p>مرحباً <strong>' + escapeHtml(ctx.studentName) + '</strong>،</p>' +
              '<p>تم تصحيح <strong>' + ctx.itemType + '</strong> في دورة <strong>' + escapeHtml(ctx.courseTitle) + '</strong>:</p>' +
              '<div style="margin:20px 0;padding:20px;background:#fbf9f4;border-radius:8px;text-align:center">' +
              '<p style="margin:0 0 4px;font-size:14px;color:#777">' + escapeHtml(ctx.itemTitle) + '</p>' +
              '<p style="margin:0;font-size:32px;font-weight:700;color:#a30019">' + escapeHtml(ctx.score) + ' / ' + escapeHtml(ctx.maxScore) + '</p></div>' +
              (ctx.feedback ? '<p style="margin-top:16px"><strong>ملاحظات المدرب:</strong><br/>' + escapeHtml(ctx.feedback) + '</p>' : ''),
        ctaUrl: APP_URL + '/lessons/' + (ctx.lessonId || ''),
        ctaText: 'عرض التفاصيل'
      })
    };
  },

  payment: function(ctx) {
    return {
      subject: ctx.status === 'confirmed' ? 'تم تأكيد الدفع' : (ctx.status === 'rejected' ? 'تم رفض الدفع' : 'تحديث حالة الدفع'),
      html: emailLayout({
        title: ctx.status === 'confirmed' ? 'تم تأكيد الدفع بنجاح' : (ctx.status === 'rejected' ? 'تم رفض الدفع' : 'تحديث الدفع'),
        body: '<p>مرحباً <strong>' + escapeHtml(ctx.studentName) + '</strong>،</p>' +
              '<p>الحالة: <strong style="color:' + (ctx.status === 'confirmed' ? '#0d7a3d' : '#a30019') + '">' + (ctx.status === 'confirmed' ? 'مؤكدة' : 'مرفوضة') + '</strong></p>' +
              '<p>الدورة: <strong>' + escapeHtml(ctx.courseTitle) + '</strong></p>' +
              '<p>المبلغ: <strong>' + escapeHtml(ctx.amount) + '</strong></p>' +
              (ctx.reason ? '<p>السبب: ' + escapeHtml(ctx.reason) + '</p>' : ''),
        ctaUrl: APP_URL + '/dashboard',
        ctaText: 'الذهاب للوحة التحكم'
      })
    };
  },

  enrollment: function(ctx) {
    return {
      subject: 'تم تسجيلك في دورة: ' + ctx.courseTitle,
      html: emailLayout({
        title: 'مرحباً بك في الدورة!',
        body: '<p>مرحباً <strong>' + escapeHtml(ctx.studentName) + '</strong>،</p>' +
              '<p>تم تسجيلك بنجاح في دورة <strong>' + escapeHtml(ctx.courseTitle) + '</strong>.</p>' +
              '<p>المدرب: ' + escapeHtml(ctx.instructorName) + '</p>' +
              '<p>ابدأ رحلتك التعليمية الآن واستفد من جميع الدروس والاختبارات.</p>',
        ctaUrl: APP_URL + '/courses/' + ctx.courseSlug,
        ctaText: 'بدء الدورة'
      })
    };
  },

  course: function(ctx) {
    return {
      subject: 'دورة جديدة متاحة: ' + ctx.courseTitle,
      html: emailLayout({
        title: 'دورة جديدة بانتظارك',
        body: '<p>نُشرت دورة جديدة قد تهمك:</p>' +
              '<h3 style="margin:16px 0 4px;color:#a30019">' + escapeHtml(ctx.courseTitle) + '</h3>' +
              '<p style="margin:0 0 8px">المدرب: ' + escapeHtml(ctx.instructorName) + '</p>' +
              (ctx.description ? '<p>' + escapeHtml(ctx.description) + '</p>' : ''),
        ctaUrl: APP_URL + '/courses/' + ctx.courseSlug,
        ctaText: 'عرض الدورة'
      })
    };
  },

  announcement: function(ctx) {
    return {
      subject: 'إعلان جديد في ' + ctx.courseTitle,
      html: emailLayout({
        title: escapeHtml(ctx.announcementTitle),
        body: '<p>أضاف المدرب <strong>' + escapeHtml(ctx.instructorName) + '</strong> إعلاناً جديداً في دورة <strong>' + escapeHtml(ctx.courseTitle) + '</strong>:</p>' +
              '<blockquote style="margin:16px 0;padding:12px 16px;border-right:4px solid #a30019;background:#fbf9f4;border-radius:6px">' +
              '<p style="margin:0">' + escapeHtml(ctx.announcementContent) + '</p></blockquote>',
        ctaUrl: APP_URL + '/courses/' + ctx.courseSlug,
        ctaText: 'عرض الإعلان'
      })
    };
  },

  learning: function(ctx) {
    return {
      subject: 'تم تسجيلك في المسار: ' + ctx.pathTitle,
      html: emailLayout({
        title: 'رحلة تعليمية جديدة',
        body: '<p>مرحباً <strong>' + escapeHtml(ctx.studentName) + '</strong>،</p>' +
              '<p>بدأت رحلتك في المسار التعليمي <strong>' + escapeHtml(ctx.pathTitle) + '</strong>.</p>' +
              (ctx.description ? '<p>' + escapeHtml(ctx.description) + '</p>' : '') +
              '<p>سيتم فتح الدورات تباعاً وفقاً لتقدمك.</p>',
        ctaUrl: APP_URL + '/learning-paths/' + ctx.pathId,
        ctaText: 'متابعة المسار'
      })
    };
  },

  welcome: function(ctx) {
    return {
      subject: 'مرحباً بك في ' + APP_NAME,
      html: emailLayout({
        title: 'أهلاً بك ' + escapeHtml(ctx.userName) + '!',
        body: '<p>يسعدنا انضمامك إلى <strong>' + APP_NAME + '</strong>.</p>' +
              '<p>نحن منصة تعليمية متخصصة في طب الأسنان، نقدم دورات متكاملة بإشراف أفضل المدربين.</p>' +
              '<p>ابدأ بتصفح الدورات واختر ما يناسبك:</p>',
        ctaUrl: APP_URL + '/courses',
        ctaText: 'تصفح الدورات',
        footerNote: 'إذا لم تقم بإنشاء هذا الحساب، يرجى تجاهل هذا البريد.'
      })
    };
  }
};

function safeParsePrefs(prefsJson) {
  if (!prefsJson) return {};
  if (typeof prefsJson === 'object') return prefsJson;
  try { return JSON.parse(prefsJson); } catch (e) { return {}; }
}

async function isEmailEnabledFor(userId, type) {
  try {
    var db = getDb();
    var user = await db.prepare('SELECT email_notifications FROM users WHERE id = ?').get(userId);
    if (!user) return false;
    var prefs = safeParsePrefs(user.email_notifications);
    var cfg = NOTIFICATION_TYPES[type];
    if (!cfg) return true;
    return prefs[type] !== false;
  } catch (e) {
    return true;
  }
}

async function sendNotificationEmail(userId, type, context) {
  try {
    if (!userId) return;
    var db = getDb();
    var user = await db.prepare('SELECT id, name, email, email_verified FROM users WHERE id = ?').get(userId);
    if (!user || !user.email) return;

    var enabled = await isEmailEnabledFor(userId, type);
    if (!enabled) return;

    var template = TEMPLATES[type];
    if (!template) return;

    var ctx = Object.assign({ recipientName: user.name }, context || {});
    var mail = template(ctx);

    await sendMail({ to: user.email, subject: mail.subject, html: mail.html });
  } catch (e) {
    console.error('Email notification error (' + type + '):', e.message);
  }
}

module.exports = {
  NOTIFICATION_TYPES,
  sendNotificationEmail,
  isEmailEnabledFor,
  safeParsePrefs
};
