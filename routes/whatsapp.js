const express = require('express');
const { getDb } = require('../config/database');
const { isAdmin } = require('../middleware/auth');
const { getSettings, saveSettings, sendWhatsApp, getWhatsAppLink } = require('../config/whatsapp');

const router = express.Router();

router.get('/settings', isAdmin, async (req, res, next) => {
  try {
    const settings = await getSettings();
    return res.render('whatsapp/settings', { title: 'إعدادات واتساب', settings, error: null, success: null });
  } catch(err) { next(err); }
});

router.post('/settings', isAdmin, async (req, res, next) => {
  try {
    const { provider, api_key, api_url, sender_name, is_active } = req.body;
    await saveSettings({ provider: provider || 'direct', api_key: api_key || '', api_url: api_url || '', sender_name: sender_name || '', is_active: is_active === 'on' || is_active === '1' });
    req.session.flash = { type: 'success', message: 'تم حفظ إعدادات واتساب' };
    return res.redirect('/whatsapp/settings');
  } catch(err) { next(err); }
});

router.post('/test', isAdmin, async (req, res, next) => {
  try {
    const { phone, message } = req.body;
    if (!phone) {
      return res.render('whatsapp/settings', { title: 'إعدادات واتساب', settings: await getSettings(), error: 'رقم الهاتف مطلوب', success: null });
    }
    var sent = await sendWhatsApp(phone, message || 'رسالة اختبارية من أكاديمية طب الأسنان');
    var link = getWhatsAppLink(phone, message || 'رسالة اختبارية من أكاديمية طب الأسنان');
    return res.render('whatsapp/settings', {
      title: 'إعدادات واتساب',
      settings: await getSettings(),
      error: null,
      success: sent ? 'تم إرسال رسالة الاختبار' : 'لم يتم الإرسال (الواتساب غير مفعل). رابط بديل: <a href="' + link + '" target="_blank" class="text-primary hover:underline">اضغط هنا</a>'
    });
  } catch(err) { next(err); }
});

router.get('/users', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const users = await db.prepare("SELECT id, name, email, phone FROM users WHERE phone != '' ORDER BY name").all();
    return res.render('whatsapp/users', { title: 'أرقام المستخدمين', users });
  } catch(err) { next(err); }
});

router.post('/broadcast', isAdmin, async (req, res, next) => {
  try {
    const db = getDb();
    const { user_ids, message } = req.body;
    if (!message) { req.session.flash = { type: 'error', message: 'الرسالة مطلوبة' }; return res.redirect('/whatsapp/users'); }
    var ids = Array.isArray(user_ids) ? user_ids : [user_ids];
    var sent = 0;
    for (var uid of ids) {
      var user = await db.prepare('SELECT id, phone FROM users WHERE id = ? AND phone != ?').get(parseInt(uid), '');
      if (user) {
        var ok = await sendWhatsApp(user.phone, message);
        if (ok) sent++;
      }
    }
    req.session.flash = { type: 'success', message: 'تم إرسال ' + sent + ' رسالة' };
    return res.redirect('/whatsapp/users');
  } catch(err) { next(err); }
});

module.exports = router;
