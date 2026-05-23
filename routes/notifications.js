const express = require('express');
const { getDb } = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');
const { getNotifications, getUnreadCount } = require('../config/notifications');

const router = express.Router();

router.get('/', isAuthenticated, (req, res) => {
  const notifications = getNotifications(req.session.userId, 50);
  const unreadCount = getUnreadCount(req.session.userId);
  res.render('notifications/index', { title: 'الإشعارات', notifications, unreadCount });
});

router.post('/read-all', isAuthenticated, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.session.userId);
  res.redirect('/notifications');
});

router.post('/:id/read', isAuthenticated, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(parseInt(req.params.id), req.session.userId);
  res.json({ success: true });
});

module.exports = router;
