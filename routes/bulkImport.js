const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { getDb } = require('../config/database');
const { isAdmin } = require('../middleware/auth');

var bulkImportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, handler: function(req, res) { res.status(429).render('admin/bulk-import', { title: 'استيراد المستخدمين', result: null, error: 'طلبات كثيرة جداً، حاول بعد ساعة' }); } });

const router = express.Router();

const csvStorage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, path.join(__dirname, '..', 'public', 'uploads')); },
  filename: function (req, file, cb) { cb(null, 'bulk-import-' + Date.now() + '.csv'); }
});

const uploadCsv = multer({
  storage: csvStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    var ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.csv' || (file.mimetype !== 'text/csv' && file.mimetype !== 'application/vnd.ms-excel')) {
      return cb(new Error('يُسمح فقط بملفات CSV'), false);
    }
    cb(null, true);
  }
});

function parseCsvLine(line) {
  var result = [];
  var current = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

router.get('/bulk-import', isAdmin, async (req, res, next) => {
  try {
    return res.render('admin/bulk-import', { title: 'استيراد المستخدمين', result: null, error: null });
  } catch(err) { next(err); }
});

router.post('/bulk-import', isAdmin, bulkImportLimiter, async (req, res, next) => {
  try {
    uploadCsv.single('csv_file')(req, res, async function (err) {
      try {
        if (err) {
          return res.render('admin/bulk-import', { title: 'استيراد المستخدمين', result: null, error: err.message });
        }

        if (!req.file) {
          return res.render('admin/bulk-import', { title: 'استيراد المستخدمين', result: null, error: 'يرجى رفع ملف CSV' });
        }

        const db = getDb();
        var filePath = req.file.path;
        var content = fs.readFileSync(filePath, 'utf-8');
        var lines = content.split(/\r?\n/).filter(function(l) { return l.trim() !== ''; });

        if (lines.length < 2) {
          fs.unlinkSync(filePath);
          return res.render('admin/bulk-import', { title: 'استيراد المستخدمين', result: null, error: 'الملف فارغ أو لا يحتوي على بيانات كافية' });
        }

        var headerLine = lines[0];
        var headers = parseCsvLine(headerLine).map(function(h) { return h.toLowerCase().trim(); });

        var nameIdx = headers.indexOf('name');
        var emailIdx = headers.indexOf('email');
        var passwordIdx = headers.indexOf('password');
        var roleIdx = headers.indexOf('role');

        if (nameIdx === -1 || emailIdx === -1 || passwordIdx === -1) {
          fs.unlinkSync(filePath);
          return res.render('admin/bulk-import', { title: 'استيراد المستخدمين', result: null, error: 'تنسيق CSV غير صحيح. الأعمدة المطلوبة: name, email, password, role' });
        }

        var results = { succeeded: 0, failed: 0, errors: [] };
        var allowedRoles = ['student', 'instructor'];

        for (var i = 1; i < lines.length; i++) {
          var fields = parseCsvLine(lines[i]);

          var name = fields[nameIdx] ? fields[nameIdx].trim() : '';
          var email = fields[emailIdx] ? fields[emailIdx].trim().toLowerCase() : '';
          var password = fields[passwordIdx] ? fields[passwordIdx].trim() : '';
          var role = roleIdx !== -1 && fields[roleIdx] ? fields[roleIdx].trim().toLowerCase() : 'student';

          if (!name || !email || !password) {
            results.failed++;
            results.errors.push({ row: i + 1, error: 'الحقول المطلوبة مفقودة', name: name || '—' });
            continue;
          }

          if (!email.includes('@')) {
            results.failed++;
            results.errors.push({ row: i + 1, error: 'بريد إلكتروني غير صالح', name: name });
            continue;
          }

          if (password.length < 12) {
            results.failed++;
            results.errors.push({ row: i + 1, error: 'كلمة المرور أقل من 12 حرفاً', name: name });
            continue;
          }

          if (allowedRoles.indexOf(role) === -1) {
            role = 'student';
          }

          var existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
          if (existing) {
            results.failed++;
            results.errors.push({ row: i + 1, error: 'البريد الإلكتروني موجود مسبقاً (تم تخطيه)', name: name });
            continue;
          }

          try {
            var hashedPassword = await bcrypt.hash(password, 10);
            await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
              .run(name, email, hashedPassword, role);
            results.succeeded++;
          } catch (insertErr) {
            results.failed++;
            results.errors.push({ row: i + 1, error: 'خطأ في الإدراج: ' + insertErr.message, name: name });
          }
        }

        fs.unlinkSync(filePath);

        return res.render('admin/bulk-import', {
          title: 'استيراد المستخدمين',
          result: results,
          error: null
        });
      } catch (cbErr) {
        return res.render('admin/bulk-import', { title: 'استيراد المستخدمين', result: null, error: 'خطأ في قراءة الملف: ' + cbErr.message });
      }
    });
  } catch(err) { next(err); }
});

module.exports = router;
