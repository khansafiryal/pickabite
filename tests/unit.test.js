'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomCode, generateUniqueCode, normalize, isValid, PATTERN } = require('../src/services/orderCode');
const { wibDate, wibHM, fromWib } = require('../src/utils');

test('UT-01 kode pesanan selalu 3 huruf + 3 angka tanpa huruf I dan O', () => {
  for (let i = 0; i < 20000; i++) {
    const c = randomCode();
    assert.match(c, PATTERN);
    assert.ok(!/[IO]/.test(c.slice(0, 3)), `kode ${c} memuat I atau O`);
  }
});

test('UT-02 kode acak tersebar (tidak berulang dalam 5.000 percobaan pertama secara berlebihan)', () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i++) seen.add(randomCode());
  assert.ok(seen.size > 4990, `terlalu banyak tabrakan: ${5000 - seen.size}`);
});

test('UT-03 generateUniqueCode menghindari kode yang sudah dipakai', () => {
  const taken = new Set();
  for (let i = 0; i < 1000; i++) taken.add(generateUniqueCode((c) => taken.has(c)));
  assert.equal(taken.size, 1000);
  assert.throws(() => generateUniqueCode(() => true, 5), /unik/);
});

test('UT-04 normalisasi dan validasi kode masukan penjual', () => {
  assert.equal(normalize(' ktb-482 '), 'KTB482');
  assert.ok(isValid('ktb482'));
  assert.ok(!isValid('KIO482'));
  assert.ok(!isValid('KT4821'));
});

test('UT-05 konversi waktu WIB', () => {
  const d = fromWib('2026-11-09', '12:30');
  assert.equal(d.toISOString(), '2026-11-09T05:30:00.000Z');
  assert.equal(wibHM(d), '12:30');
  assert.equal(wibDate(new Date('2026-11-09T17:30:00Z')), '2026-11-10');
});
