const nodemailer = require('nodemailer');

let transporter = null;

async function initializeMail() {
  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    await transporter.verify();
  } else {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    console.log('📧 Ethereal Email: ' + testAccount.user);
  }
  return transporter;
}

function getTransporter() {
  return transporter;
}

async function sendMail({ to, subject, html }) {
  if (!transporter) return null;
  const info = await transporter.sendMail({
    from: '"أكاديمية طب الأسنان" <noreply@dental-academy.com>',
    to, subject, html,
  });
  if (process.env.SMTP_HOST) {
    console.log('📧 Email sent: ' + info.messageId);
  } else {
    console.log('📧 Preview URL: ' + nodemailer.getTestMessageUrl(info));
  }
  return info;
}

module.exports = { initializeMail, getTransporter, sendMail };
