'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { freshApp, makeSeller, makeBuyer, order } = require('./helpers');

let app;
before(async () => { app = await freshApp(); });

test('TC-01 registrasi pembeli valid membuat akun belum terverifikasi yang belum bisa memesan', async () => {
  const seller = await makeSeller(app, { menus: [{ name: 'Nasi Uji', price: 10000 }] });
  const b = await makeBuyer(app, { verify: false });
  assert.equal(b.user.is_verified, 0);
  assert.match(b.otp, /^\d{6}$/);
  const r = await order(b, seller.menus[0].id, { group: { stall_id: seller.stall.id } });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'NOT_VERIFIED');
});

test('TC-02 registrasi pembeli cukup dengan email tanpa jenis pembeli dan NIM', async () => {
  const r = await request(app).post('/api/auth/register').send({ name: 'Pembeli Baru', email: 'baru@uji.id', password: 'rahasia123' });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.identity_number, null);
  assert.equal(r.body.user.buyer_type, null);
});

test('TC-03 email ganda ditolak', async () => {
  const first = await makeBuyer(app);
  const r = await request(app).post('/api/auth/register').send({ name: 'Ganda', email: first.email, password: 'rahasia123' });
  assert.equal(r.status, 409);
});

test('TC-04 OTP salah ditolak, OTP benar memverifikasi akun', async () => {
  const b = await makeBuyer(app, { verify: false });
  const wrong = b.otp === '000000' ? '111111' : '000000';
  assert.equal((await b.agent.post('/api/auth/verify').send({ otp: wrong })).status, 400);
  const ok = await b.agent.post('/api/auth/verify').send({ otp: b.otp });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.is_verified, 1);
});

test('TC-05 login dengan tab peran yang salah ditolak dengan pesan jelas', async () => {
  const s = await makeSeller(app);
  const r = await request(app).post('/api/auth/login').send({ identifier: s.email, password: 'rahasia123', role: 'buyer' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'ROLE_MISMATCH');
  assert.match(r.body.error, /penjual/);
});

test('TC-06 hak akses berbeda: pembeli tidak bisa membuka API penjual dan sebaliknya', async () => {
  const s = await makeSeller(app);
  const b = await makeBuyer(app);
  assert.equal((await b.agent.get('/api/seller/dashboard')).status, 403);
  assert.equal((await s.agent.get('/api/cart')).status, 403);
  assert.equal((await request(app).get('/api/cart')).status, 401);
  assert.equal((await request(app).get('/api/seller/orders')).status, 401);
});

test('TC-07 pembeli bisa login memakai email', async () => {
  const b = await makeBuyer(app);
  const r = await request(app).post('/api/auth/login').send({ identifier: b.email, password: 'rahasia123', role: 'buyer' });
  assert.equal(r.status, 200);
  assert.ok(String(r.headers['set-cookie']).includes('HttpOnly'));
});

test('TC-08 percobaan login gagal berulang dibatasi (HTTP 429)', async () => {
  let last;
  for (let i = 0; i < 9; i++) last = await request(app).post('/api/auth/login').send({ identifier: 'tidakada@uji.id', password: 'salah', role: 'buyer' });
  assert.equal(last.status, 429);
});

test('TC-09 password disimpan dalam bentuk hash dan tidak pernah dikirim ke klien', async () => {
  const b = await makeBuyer(app);
  const me = await b.agent.get('/api/auth/me');
  assert.equal(me.body.user.password_hash, undefined);
  assert.equal(me.body.user.otp_code, undefined);
});
