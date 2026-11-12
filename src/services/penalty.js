'use strict';
/** Aturan BR-09 dan BR-10: pencatatan pelanggaran, peringatan, dan blokir sementara. */
const db = require('../db');
const config = require('../config');
const { iso, now, addMinutes } = require('../utils');
const { notify } = require('./notify');

const fmtWib = (d) => new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
}).format(new Date(d));

function windowStart(user) {
  const byDays = addMinutes(now(), -config.rules.violationWindowDays * 24 * 60).toISOString();
  return user.violation_reset_at && user.violation_reset_at > byDays ? user.violation_reset_at : byDays;
}

function activeViolations(userId) {
  const user = db.get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return 0;
  return db.get('SELECT COUNT(*) AS n FROM violations WHERE user_id = ? AND created_at > ?', [userId, windowStart(user)]).n;
}

function isBlocked(user) {
  return Boolean(user && user.blocked_until && user.blocked_until > iso());
}

function addViolation(userId, orderId, reason) {
  db.run('INSERT INTO violations (user_id, order_id, reason, created_at) VALUES (?, ?, ?, ?)', [userId, orderId, reason, iso()]);
  const count = activeViolations(userId);
  const limit = config.rules.violationsToBlock;
  const why = reason === 'tidak_bayar' ? 'pesanan tidak dibayar sampai batas waktu' : 'pesanan tidak diambil';
  if (count >= limit) {
    const until = addMinutes(now(), config.rules.blockHours * 60);
    db.run('UPDATE users SET blocked_until = ?, violation_reset_at = ? WHERE id = ?', [until.toISOString(), iso(), userId]);
    notify(userId, {
      type: 'blokir',
      title: 'Akun diblokir sementara',
      body: `Kamu mencatat ${count} pelanggaran dalam ${config.rules.violationWindowDays} hari (${why}). Pemesanan dibuka lagi pada ${fmtWib(until)} WIB.`,
      orderId,
    });
    return { count, blocked: true, until: until.toISOString() };
  }
  const left = limit - count;
  notify(userId, {
    type: 'peringatan',
    title: left === 1 ? 'Peringatan terakhir' : `Peringatan ${count} dari ${limit - 1}`,
    body: `Tercatat pelanggaran karena ${why}. Jika terjadi ${left} kali lagi dalam ${config.rules.violationWindowDays} hari, akun akan diblokir ${config.rules.blockHours} jam.`,
    orderId,
  });
  return { count, blocked: false };
}

function summary(user) {
  return {
    violations: activeViolations(user.id),
    limit: config.rules.violationsToBlock,
    window_days: config.rules.violationWindowDays,
    blocked_until: isBlocked(user) ? user.blocked_until : null,
  };
}

module.exports = { addViolation, isBlocked, activeViolations, summary };
