const { getDb } = require('../config/database');

async function createNotification(userId, type, title, message, relatedId, relatedType) {
  const db = getDb();
  await db.prepare('INSERT INTO notifications (user_id, type, title, message, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, type, title, message || '', relatedId || null, relatedType || null);
  // Send WhatsApp if user has phone
  try {
    var user = await db.prepare('SELECT phone FROM users WHERE id = ? AND phone != ?').get(userId, '');
    if (user) {
      const { sendWhatsApp } = require('./whatsapp');
      var waMsg = '🔔 ' + title;
      if (message) waMsg += '\n' + message;
      sendWhatsApp(user.phone, waMsg);
    }
  } catch(e) {}
}

async function getUnreadCount(userId) {
  const db = getDb();
  const row = await db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').get(userId);
  return row ? row.count : 0;
}

async function getNotifications(userId, limit) {
  const db = getDb();
  return await db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit || 20);
}

module.exports = { createNotification, getUnreadCount, getNotifications };
