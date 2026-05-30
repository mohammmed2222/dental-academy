const express = require('express');
const rateLimit = require('express-rate-limit');
const { getDb } = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');
const { toSafeInt } = require('../config/security');
const { createNotification } = require('../config/notifications');

var sendLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, handler: function(req, res) { req.session.flash = { type: 'error', message: 'لقد أرسلت رسائل كثيرة، حاول بعد 15 دقيقة' }; return res.redirect('/messages/compose'); } });

const router = express.Router();

router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const userId = req.session.userId;

    const conversations = await db.prepare(`
      WITH conv AS (
        SELECT DISTINCT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS other_user_id
        FROM messages WHERE sender_id = ? OR receiver_id = ?
      )
      SELECT
        c.other_user_id,
        u.name AS other_user_name,
        u.avatar AS other_user_avatar,
        (SELECT content FROM messages WHERE (sender_id = ? AND receiver_id = c.other_user_id) OR (sender_id = c.other_user_id AND receiver_id = ?) ORDER BY created_at DESC LIMIT 1) AS last_message,
        (SELECT created_at FROM messages WHERE (sender_id = ? AND receiver_id = c.other_user_id) OR (sender_id = c.other_user_id AND receiver_id = ?) ORDER BY created_at DESC LIMIT 1) AS last_message_at,
        (SELECT COUNT(*) FROM messages WHERE receiver_id = ? AND sender_id = c.other_user_id AND is_read = 0) AS unread_count
      FROM conv c
      JOIN users u ON u.id = c.other_user_id
      ORDER BY last_message_at DESC
    `).all(userId, userId, userId, userId, userId, userId, userId, userId);

    return res.render('messages/inbox', { title: 'الرسائل', conversations });
  } catch(err) { next(err); }
});

router.get('/inbox', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const userId = req.session.userId;

    const messages = await db.prepare(`
      SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.receiver_id = ?
      ORDER BY m.created_at DESC
    `).all(userId);

    const unreadCount = (await db.prepare('SELECT COUNT(*) as count FROM messages WHERE receiver_id = ? AND is_read = 0').get(userId)).count;

    return res.render('messages/inbox', { title: 'الرسائل الواردة', messages, unreadCount, inboxMode: true });
  } catch(err) { next(err); }
});

router.get('/sent', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const userId = req.session.userId;

    const messages = await db.prepare(`
      SELECT m.*, u.name as receiver_name, u.avatar as receiver_avatar
      FROM messages m
      JOIN users u ON m.receiver_id = u.id
      WHERE m.sender_id = ?
      ORDER BY m.created_at DESC
    `).all(userId);

    return res.render('messages/sent', { title: 'الرسائل المرسلة', messages });
  } catch(err) { next(err); }
});

router.get('/conversation/:userId', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const currentUserId = req.session.userId;
    const otherUserId = toSafeInt(req.params.userId);

    const otherUser = await db.prepare('SELECT id, name, email, role, avatar FROM users WHERE id = ?').get(otherUserId);
    if (!otherUser) {
      return res.status(404).render('error', { title: 'غير موجود', message: 'المستخدم غير موجود', error: null });
    }

    await db.prepare('UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?').run(otherUserId, currentUserId);

    const messages = await db.prepare(`
      SELECT m.*,
        s.name as sender_name, s.avatar as sender_avatar,
        r.name as receiver_name, r.avatar as receiver_avatar
      FROM messages m
      JOIN users s ON m.sender_id = s.id
      JOIN users r ON m.receiver_id = r.id
      WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
      ORDER BY m.created_at ASC
    `).all(currentUserId, otherUserId, otherUserId, currentUserId);

    return res.render('messages/conversation', { title: 'الرسائل مع ' + otherUser.name, messages, otherUser });
  } catch(err) { next(err); }
});

router.get('/compose', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const currentUserId = req.session.userId;

    const users = await db.prepare('SELECT id, name, email, role, avatar FROM users WHERE id != ? ORDER BY name ASC').all(currentUserId);

    const preselectedUser = req.query.to ? toSafeInt(req.query.to) : null;
    let parentMessage = null;

    if (req.query.reply) {
      parentMessage = await db.prepare('SELECT * FROM messages WHERE id = ?').get(toSafeInt(req.query.reply));
    }

    return res.render('messages/compose', { title: 'رسالة جديدة', users, preselectedUser, parentMessage });
  } catch(err) { next(err); }
});

router.post('/send', isAuthenticated, sendLimiter, async (req, res, next) => {
  try {
    const db = getDb();
    const receiverId = toSafeInt(req.body.receiver_id);
    const subject = (req.body.subject || '').trim();
    const content = (req.body.content || '').trim();
    const parentId = req.body.parent_id ? toSafeInt(req.body.parent_id) : null;

    if (!receiverId || !subject || !content) {
      req.session.flash = { type: 'error', message: 'جميع الحقول مطلوبة' };
      return res.redirect('/messages/compose');
    }

    const receiver = await db.prepare('SELECT id FROM users WHERE id = ?').get(receiverId);
    if (!receiver) {
      req.session.flash = { type: 'error', message: 'المستخدم غير موجود' };
      return res.redirect('/messages/compose');
    }

    await db.prepare('INSERT INTO messages (sender_id, receiver_id, subject, content, parent_id) VALUES (?, ?, ?, ?, ?)')
      .run(req.session.userId, receiverId, subject, content, parentId);

    if (receiverId !== req.session.userId) {
      await createNotification(receiverId, 'message', 'رسالة جديدة', req.session.userName + ' أرسل لك رسالة: ' + subject, null, null);
    }

    req.session.flash = { type: 'success', message: 'تم إرسال الرسالة بنجاح' };
    return res.redirect('/messages/conversation/' + receiverId);
  } catch(err) { next(err); }
});

router.post('/:id/read', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const messageId = toSafeInt(req.params.id);
    const userId = req.session.userId;

    const message = await db.prepare('SELECT * FROM messages WHERE id = ? AND receiver_id = ?').get(messageId, userId);
    if (!message) {
      return res.status(404).json({ success: false, error: 'الرسالة غير موجودة' });
    }

    await db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').run(messageId);
    return res.json({ success: true });
  } catch(err) { next(err); }
});

router.post('/:id/delete', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    const messageId = toSafeInt(req.params.id);
    const userId = req.session.userId;

    const message = await db.prepare('SELECT * FROM messages WHERE id = ? AND sender_id = ?').get(messageId, userId);
    if (!message) {
      req.session.flash = { type: 'error', message: 'الرسالة غير موجودة أو لا يمكنك حذفها' };
      return res.redirect('/messages');
    }

    await db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
    req.session.flash = { type: 'success', message: 'تم حذف الرسالة بنجاح' };
    return res.redirect('/messages');
  } catch(err) { next(err); }
});

module.exports = router;
