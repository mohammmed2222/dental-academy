var https = require('https');

async function getSettings() {
  try {
    const { getDb } = require('./database');
    const db = getDb();
    var settings = await db.prepare('SELECT * FROM whatsapp_settings ORDER BY id DESC LIMIT 1').get();
    return settings || { provider: 'direct', api_key: '', api_url: '', sender_name: '', is_active: 0 };
  } catch(e) { return { provider: 'direct', api_key: '', api_url: '', sender_name: '', is_active: 0 }; }
}

async function saveSettings(settings) {
  const { getDb } = require('./database');
  const db = getDb();
  var existing = await db.prepare('SELECT id FROM whatsapp_settings ORDER BY id DESC LIMIT 1').get();
  if (existing) {
    await db.prepare('UPDATE whatsapp_settings SET provider = ?, api_key = ?, api_url = ?, sender_name = ?, is_active = ? WHERE id = ?')
      .run(settings.provider || 'direct', settings.api_key || '', settings.api_url || '', settings.sender_name || '', settings.is_active ? 1 : 0, existing.id);
  } else {
    await db.prepare('INSERT INTO whatsapp_settings (provider, api_key, api_url, sender_name, is_active) VALUES (?, ?, ?, ?, ?)')
      .run(settings.provider || 'direct', settings.api_key || '', settings.api_url || '', settings.sender_name || '', settings.is_active ? 1 : 0);
  }
}

async function sendWhatsApp(phone, message) {
  if (!phone) return false;
  var cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned) return false;

  var settings = await getSettings();
  if (!settings.is_active) return false;

  if (settings.provider === 'twilio' && settings.api_key && settings.api_url) {
    return sendViaTwilio(settings, cleaned, message);
  }

  return true;
}

function sendViaTwilio(settings, phone, message) {
  return new Promise(function(resolve) {
    var parts = settings.api_url.split(':');
    var accountSid = parts[0] || '';
    var authToken = settings.api_key;
    var from = settings.sender_name || '+14155238886';
    var postData = 'From=whatsapp:' + encodeURIComponent(from) + '&Body=' + encodeURIComponent(message) + '&To=whatsapp:' + encodeURIComponent(phone);
    var req = https.request({
      hostname: 'api.twilio.com',
      path: '/2010-04-01/Accounts/' + accountSid + '/Messages.json',
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(accountSid + ':' + authToken).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }, function(res) {
      resolve(true);
    });
    req.on('error', function() { resolve(false); });
    req.write(postData);
    req.end();
  });
}

function getWhatsAppLink(phone, text) {
  var cleaned = phone.replace(/[^0-9]/g, '');
  if (!cleaned) return '#';
  return 'https://wa.me/' + cleaned + '?text=' + encodeURIComponent(text);
}

module.exports = { sendWhatsApp, getWhatsAppLink, getSettings, saveSettings };
