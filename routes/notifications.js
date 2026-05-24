const express = require('express');
const { getDb, sqlNow } = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');
const { getNotifications, getUnreadCount } = require('../config/notifications');

const router = express.Router();

router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const notifications = await getNotifications(req.session.userId, 50);
    const unreadCount = await getUnreadCount(req.session.userId);
    return res.render('notifications/index', { title: 'الإشعارات', notifications, unreadCount });
  } catch(err) { next(err); }
});

router.post('/read-all', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.session.userId);
    return res.redirect('/notifications');
  } catch(err) { next(err); }
});

router.post('/:id/read', isAuthenticated, async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(parseInt(req.params.id), req.session.userId);
    return res.json({ success: true });
  } catch(err) { next(err); }
});

module.exports = router;
