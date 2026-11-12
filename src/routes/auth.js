'use strict';
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const { HttpError, iso, addMinutes, str } = require('../utils');
const { createSession, destroySession, requireAuth, publicUser } = require('../middleware/auth');
const penalty = require('../services/penalty');
const { ACTIVE } = require('../services/orders');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^(\+62|62|0)8\d{7,12}$/;
function newOtp(userId) {
  const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  db.run('UPDATE users SET otp_code = ?, otp_expires_at = ? WHERE id = ?', [otp, addMinutes(new Date(), config.rules.otpTtlMin).toISOString(), userId]);
  if (config.showOtp && process.env.NODE_ENV !== 'test') console.log(`[OTP] user #${userId}: ${otp} (berlaku ${config.rules.otpTtlMin} menit)`);
  return otp;
}

router.post('/register', (req, res) => {
  const b = req.body || {};
  const role = b.role === 'seller' ? 'seller' : 'buyer';
  const name = str(b.name, 80);
  const email = str(b.email, 120).toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';
  const phone = str(b.phone, 20).replace(/[\s-]/g, '');
  if (name.length < 2) throw new HttpError(400, 'Nama minimal 2 karakter.', { field: 'name' });
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Format email tidak valid.', { field: 'email' });
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new HttpError(400, 'Password minimal 8 karakter dan memuat huruf serta angka.', { field: 'password' });
  }
  if (phone && !PHONE_RE.test(phone)) throw new HttpError(400, 'Nomor HP tidak valid. Contoh: 081234567890.', { field: 'phone' });

  const buyerType = null;
  const identity = null;
  const stallName = str(b.stall_name, 60);
  if (role === 'seller' && stallName.length < 3) throw new HttpError(400, 'Nama stan minimal 3 karakter.', { field: 'stall_name' });

  if (db.get('SELECT 1 FROM users WHERE email = ?', [email])) throw new HttpError(409, 'Email sudah terdaftar.', { field: 'email' });
  const hashPw = bcrypt.hashSync(password, 10);
  const userId = db.tx(() => {
    const { lastInsertRowid } = db.run(
      `INSERT INTO users (role, name, email, buyer_type, identity_number, phone, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [role, name, email, buyerType, identity, phone || null, hashPw, iso()]
    );
    if (role === 'seller') {
      db.run(
        `INSERT INTO stalls (owner_id, name, description, location, created_at) VALUES (?, ?, ?, ?, ?)`,
        [lastInsertRowid, stallName, str(b.stall_description, 200) || null, str(b.stall_location, 80) || 'Kantin FILKOM UB', iso()]
      );
    }
    return lastInsertRowid;
  });
  const otp = newOtp(userId);
  createSession(res, userId);
  const user = db.get('SELECT * FROM users WHERE id = ?', [userId]);
  res.status(201).json({ user: publicUser(user), dev_otp: config.showOtp ? otp : undefined });
});

// Pembatas percobaan login sederhana (NFR-03).
const attempts = new Map();
function checkRate(key) {
  const rec = attempts.get(key);
  const windowMs = config.rules.loginWindowMin * 60000;
  if (rec && Date.now() - rec.first < windowMs && rec.count >= config.rules.loginMaxAttempts) {
    throw new HttpError(429, `Terlalu banyak percobaan masuk. Coba lagi dalam ${config.rules.loginWindowMin} menit.`);
  }
  if (rec && Date.now() - rec.first >= windowMs) attempts.delete(key);
}
function failRate(key) {
  const rec = attempts.get(key) || { count: 0, first: Date.now() };
  rec.count += 1;
  attempts.set(key, rec);
}

router.post('/login', (req, res) => {
  const b = req.body || {};
  const identifier = str(b.identifier, 120).toLowerCase().replace(/\s/g, '');
  const password = typeof b.password === 'string' ? b.password : '';
  const role = b.role === 'seller' ? 'seller' : 'buyer';
  if (!identifier || !password) throw new HttpError(400, 'Isi NIM/email dan password.');
  const key = `${identifier}|${req.ip}`;
  checkRate(key);
  const user = db.get('SELECT * FROM users WHERE email = ? OR identity_number = ?', [identifier, identifier]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    failRate(key);
    throw new HttpError(401, 'NIM/email atau password salah.');
  }
  if (user.role !== role) {
    throw new HttpError(403, user.role === 'seller'
      ? 'Akun ini terdaftar sebagai penjual. Pilih tab Penjual untuk masuk.'
      : 'Akun ini terdaftar sebagai pembeli. Pilih tab Pembeli untuk masuk.', { code: 'ROLE_MISMATCH' });
  }
  attempts.delete(key);
  createSession(res, user.id);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  const u = req.user;
  const out = {
    user: publicUser(u),
    unread_notifications: db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', [u.id]).n,
  };
  if (u.role === 'seller') out.stall = req.stall;
  else {
    out.penalty = penalty.summary(u);
    out.cart_count = db.get('SELECT COALESCE(SUM(qty),0) AS n FROM cart_items WHERE user_id = ?', [u.id]).n;
    out.active_orders = db.get(`SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status IN (${ACTIVE.map((s) => `'${s}'`).join(',')})`, [u.id]).n;
    out.max_active_orders = config.rules.maxActiveOrders;
  }
  res.json(out);
});

router.post('/verify', requireAuth, (req, res) => {
  const otp = str(req.body && req.body.otp, 6);
  const u = req.user;
  if (u.is_verified) return res.json({ user: publicUser(u) });
  if (!u.otp_code || u.otp_expires_at < iso()) throw new HttpError(400, 'Kode OTP kedaluwarsa. Minta kode baru.');
  if (otp !== u.otp_code) throw new HttpError(400, 'Kode OTP salah.');
  db.run('UPDATE users SET is_verified = 1, otp_code = NULL, otp_expires_at = NULL WHERE id = ?', [u.id]);
  res.json({ user: publicUser(db.get('SELECT * FROM users WHERE id = ?', [u.id])) });
});

router.post('/resend-otp', requireAuth, (req, res) => {
  if (req.user.is_verified) throw new HttpError(400, 'Akun sudah terverifikasi.');
  const otp = newOtp(req.user.id);
  res.json({ ok: true, dev_otp: config.showOtp ? otp : undefined });
});

router.patch('/profile', requireAuth, (req, res) => {
  const name = str(req.body && req.body.name, 80);
  const phone = str(req.body && req.body.phone, 20).replace(/[\s-]/g, '');
  if (name.length < 2) throw new HttpError(400, 'Nama minimal 2 karakter.', { field: 'name' });
  if (phone && !PHONE_RE.test(phone)) throw new HttpError(400, 'Nomor HP tidak valid.', { field: 'phone' });
  db.run('UPDATE users SET name = ?, phone = ? WHERE id = ?', [name, phone || null, req.user.id]);
  res.json({ user: publicUser(db.get('SELECT * FROM users WHERE id = ?', [req.user.id])) });
});

router.post('/password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!bcrypt.compareSync(String(current || ''), req.user.password_hash)) throw new HttpError(400, 'Password lama salah.', { field: 'current' });
  if (typeof next !== 'string' || next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) {
    throw new HttpError(400, 'Password baru minimal 8 karakter dan memuat huruf serta angka.', { field: 'next' });
  }
  db.run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(next, 10), req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
