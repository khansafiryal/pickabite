'use strict';
/**
 * BR-07: kode pesanan = 3 huruf + 3 angka, contoh "KTB482".
 * Huruf I dan O tidak dipakai agar tidak tertukar dengan angka 1 dan 0.
 * Memakai crypto.randomInt, sehingga kode tidak bisa ditebak dari kode sebelumnya.
 */
const crypto = require('crypto');

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '0123456789';
const PATTERN = /^[A-HJ-NP-Z]{3}[0-9]{3}$/;

function randomCode() {
  let s = '';
  for (let i = 0; i < 3; i++) s += LETTERS[crypto.randomInt(LETTERS.length)];
  for (let i = 0; i < 3; i++) s += DIGITS[crypto.randomInt(DIGITS.length)];
  return s;
}

/** Menghasilkan kode yang belum pernah dipakai. isTaken(code) mengecek ke basis data. */
function generateUniqueCode(isTaken, maxTries = 50) {
  for (let i = 0; i < maxTries; i++) {
    const code = randomCode();
    if (!isTaken(code)) return code;
  }
  throw new Error('Gagal membuat kode pesanan unik');
}

const normalize = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const isValid = (code) => PATTERN.test(normalize(code));

module.exports = { randomCode, generateUniqueCode, normalize, isValid, LETTERS, PATTERN };
