'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// Pemuat .env sederhana tanpa dependensi tambahan (KEY=VALUE per baris).
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let value = m[2].trim();
    // Nilai bertanda kutip dipakai apa adanya, sedangkan komentar sebaris (" # ...") dibuang.
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    process.env[m[1]] = value;
  }
}

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

module.exports = {
  root,
  port: num(process.env.PORT, 3000),
  dbFile: process.env.DB_FILE || path.join(root, 'data', 'pickabite.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(root, 'uploads'),
  publicDir: path.join(root, 'public'),
  showOtp: process.env.SHOW_OTP !== 'false',
  timezone: 'Asia/Jakarta',
  rules: {
    maxActiveOrders: num(process.env.MAX_ACTIVE_ORDERS, 3),
    paymentWindowMin: num(process.env.PAYMENT_WINDOW_MIN, 15),
    noShowGraceMin: num(process.env.NO_SHOW_GRACE_MIN, 30),
    reminderAfterMin: num(process.env.REMINDER_AFTER_MIN, 10),
    violationWindowDays: num(process.env.VIOLATION_WINDOW_DAYS, 7),
    violationsToBlock: num(process.env.VIOLATIONS_TO_BLOCK, 3),
    blockHours: num(process.env.BLOCK_HOURS, 24),
    slotMinutes: 15,
    otpTtlMin: 10,
    sessionDays: 7,
    loginMaxAttempts: 8,
    loginWindowMin: 15,
  },
};
