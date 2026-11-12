'use strict';
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { HttpError, iso, addMinutes } = require('../utils');

const COOKIE = 'pb_session';
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = addMinutes(new Date(), config.rules.sessionDays * 24 * 60);
  db.run('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)', [hash(token), userId, expires.toISOString(), iso()]);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: false, expires, path: '/' });
}

function destroySession(req, res) {
  const token = req.cookies && req.cookies[COOKIE];
  if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', [hash(token)]);
  res.clearCookie(COOKIE, { path: '/' });
}

/** Membaca cookie sesi lalu mengisi req.user (dan req.stall untuk penjual). */
function loadUser(req, _res, next) {
  req.user = null;
  const token = req.cookies && req.cookies[COOKIE];
  if (token) {
    const row = db.get(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
      [hash(token), iso()]
    );
    if (row) {
      req.user = row;
      if (row.role === 'seller') req.stall = db.get('SELECT * FROM stalls WHERE owner_id = ?', [row.id]);
    }
  }
  next();
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Silakan masuk terlebih dahulu.'));
  next();
}

const requireRole = (role) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Silakan masuk terlebih dahulu.'));
  if (req.user.role !== role) {
    return next(new HttpError(403, role === 'seller' ? 'Halaman ini khusus akun penjual.' : 'Halaman ini khusus akun pembeli.'));
  }
  if (role === 'seller' && !req.stall) return next(new HttpError(403, 'Akun penjual belum memiliki stan.'));
  next();
};

/** Publik untuk user (tanpa hash password dan OTP). */
function publicUser(u) {
  if (!u) return null;
  const { password_hash, otp_code, otp_expires_at, violation_reset_at, ...rest } = u;
  return rest;
}

module.exports = { COOKIE, createSession, destroySession, loadUser, requireAuth, requireRole, publicUser, hash };
