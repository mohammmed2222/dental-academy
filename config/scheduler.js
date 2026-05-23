var cron = require('node-cron');
var path = require('path');
var fs = require('fs');

function startScheduler() {
  // Clean expired password reset tokens every hour
  cron.schedule('0 * * * *', function() {
    try {
      var db = require('./database').getDb();
      db.prepare("DELETE FROM password_reset_tokens WHERE expires_at < datetime('now')").run();
      require('./database').saveDatabase();
      console.log('✓ تنظيف توكنات إعادة التعيين منتهية الصلاحية');
    } catch (e) { console.error('خطأ في تنظيف التوكنات:', e.message); }
  });

  // Auto-cancel pending payments older than 7 days every day at midnight
  cron.schedule('0 0 * * *', function() {
    try {
      var db = require('./database').getDb();
      db.prepare("UPDATE payments SET status = 'cancelled' WHERE status = 'pending' AND created_at < datetime('now', '-7 days')").run();
      require('./database').saveDatabase();
      console.log('✓ إلغاء المدفوعات المعلقة القديمة');
    } catch (e) { console.error('خطأ في إلغاء المدفوعات:', e.message); }
  });

  // Backup database every day at 3 AM
  cron.schedule('0 3 * * *', function() {
    try {
      var dbDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..');
      var srcPath = path.join(dbDir, 'database.sqlite');
      if (fs.existsSync(srcPath)) {
        var date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        var backupDir = path.join(dbDir, 'backups');
        try { fs.mkdirSync(backupDir, { recursive: true }); } catch (e) {}
        fs.copyFileSync(srcPath, path.join(backupDir, 'database-' + date + '.sqlite'));
        console.log('✓ تم إنشاء نسخة احتياطية لقاعدة البيانات');
        // Keep only last 30 backups
        var files = fs.readdirSync(backupDir).filter(function(f) { return f.startsWith('database-'); }).sort();
        while (files.length > 30) {
          fs.unlinkSync(path.join(backupDir, files[0]));
          files.shift();
        }
      }
    } catch (e) { console.error('خطأ في النسخ الاحتياطي:', e.message); }
  });

  // Delete read notifications older than 30 days every day at 4 AM
  cron.schedule('0 4 * * *', function() {
    try {
      var db = require('./database').getDb();
      db.prepare("DELETE FROM notifications WHERE is_read = 1 AND created_at < datetime('now', '-30 days')").run();
      require('./database').saveDatabase();
      console.log('✓ تنظيف الإشعارات القديمة المقروءة');
    } catch (e) { console.error('خطأ في تنظيف الإشعارات:', e.message); }
  });

  console.log('✓ جدولة المهام الدورية');
}

module.exports = { startScheduler };