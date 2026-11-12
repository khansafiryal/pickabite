'use strict';
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, makeSeller, makeBuyer, order, setClockOffset, minutes, db } = require('./helpers');
const scheduler = require('../src/services/scheduler');

let app;
let warung;
let dimsum;
beforeEach(() => setClockOffset(0));
before(async () => {
  app = await freshApp();
  warung = await makeSeller(app, { stall: 'Warung Uji', menus: [{ name: 'Nasi Pecel', price: 9000, daily_stock: 80, prep_minutes: 2 }] });
  dimsum = await makeSeller(app, { stall: 'Dimsum Uji', prepay: true, menus: [{ name: 'Dimsum', price: 12000, category: 'Camilan', daily_stock: 30, prep_minutes: 5 }] });
});

async function readyOrder(buyer, seller = warung, opts = {}) {
  const o = (await order(buyer, seller.menus[0].id, { verified: true, group: { stall_id: seller.stall.id, ...opts } })).body.orders[0];
  await seller.agent.post(`/api/seller/orders/${o.id}/ready`);
  db.run("UPDATE orders SET payment_status = 'belum_bayar', paid_at = NULL WHERE id = ?", [o.id]);
  return o;
}

test('TC-22 kode pengambilan hanya berlaku sekali dan hanya di stan terkait', async () => {
  const b = await makeBuyer(app);
  const o = await readyOrder(b);
  const other = await dimsum.agent.post('/api/seller/verify-code').send({ code: o.code });
  assert.equal(other.status, 404);
  const found = await warung.agent.post('/api/seller/verify-code').send({ code: o.code.toLowerCase() });
  assert.equal(found.body.order.id, o.id);
  const wrong = await warung.agent.post(`/api/seller/orders/${o.id}/complete`).send({ code: 'ABC123', paid: true });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, 'CODE_MISMATCH');
  const unpaid = await warung.agent.post(`/api/seller/orders/${o.id}/complete`).send({ code: o.code, paid: false });
  assert.equal(unpaid.body.code, 'UNPAID');
  assert.equal((await warung.agent.post(`/api/seller/orders/${o.id}/complete`).send({ code: o.code, paid: true })).status, 200);
  const again = await warung.agent.post('/api/seller/verify-code').send({ code: o.code });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'CODE_USED');
});

test('TC-23 stan wajib bayar di muka: pesanan masuk antrean hanya setelah pembayaran diverifikasi', async () => {
  const b = await makeBuyer(app);
  const kasir = await order(b, dimsum.menus[0].id, { group: { stall_id: dimsum.stall.id, payment_method: 'kasir' } });
  assert.equal(kasir.status, 409);
  assert.equal(kasir.body.code, 'PREPAY_REQUIRED');
  const r = await b.agent.post('/api/orders/checkout').send({ groups: [{ stall_id: dimsum.stall.id, payment_method: 'qris' }] });
  const o = r.body.orders[0];
  assert.equal(o.status, 'menunggu_pembayaran');
  assert.equal(o.queue_number, null);
  assert.equal((await dimsum.agent.post(`/api/seller/orders/${o.id}/process`)).status, 409);
  const pay = await b.agent.post(`/api/orders/${o.id}/payment`).field('payment_ref', 'QR778899');
  assert.equal(pay.body.order.payment_status, 'menunggu_verifikasi');
  assert.equal(pay.body.order.status, 'menunggu_pembayaran');
  const v = await dimsum.agent.post(`/api/seller/orders/${o.id}/verify-payment`);
  assert.equal(v.body.order.status, 'dalam_antrean');
  assert.equal(v.body.order.payment_status, 'lunas');
  assert.ok(v.body.order.queue_number >= 1);
});

test('TC-24 unggah bukti bayar berupa gambar diterima dan hanya bisa dibuka pemilik serta penjual', async () => {
  const b = await makeBuyer(app);
  const other = await makeBuyer(app);
  const o = (await b.agent.post('/api/cart').send({ menu_id: dimsum.menus[0].id, qty: 1 }), (await b.agent.post('/api/orders/checkout').send({ groups: [{ stall_id: dimsum.stall.id, payment_method: 'qris' }] })).body.orders[0]);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const r = await b.agent.post(`/api/orders/${o.id}/payment`).attach('proof', png, { filename: 'bukti.png', contentType: 'image/png' });
  assert.equal(r.status, 200);
  assert.equal((await b.agent.get(`/api/files/proof/${o.id}`)).status, 200);
  assert.equal((await dimsum.agent.get(`/api/files/proof/${o.id}`)).status, 200);
  assert.equal((await other.agent.get(`/api/files/proof/${o.id}`)).status, 404);
  const bad = await b.agent.post(`/api/orders/${o.id}/payment`).attach('proof', Buffer.from('bukan gambar'), { filename: 'x.txt', contentType: 'text/plain' });
  assert.equal(bad.status, 400);
});

test('TC-25 pesanan tidak dibayar 15 menit batal otomatis, stok kembali, dan pelanggaran tercatat', async () => {
  const b = await makeBuyer(app);
  const stock0 = db.get('SELECT stock_left FROM menus WHERE id = ?', [dimsum.menus[0].id]).stock_left;
  await b.agent.post('/api/cart').send({ menu_id: dimsum.menus[0].id, qty: 2 });
  const o = (await b.agent.post('/api/orders/checkout').send({ groups: [{ stall_id: dimsum.stall.id, payment_method: 'qris' }] })).body.orders[0];
  assert.equal(db.get('SELECT stock_left FROM menus WHERE id = ?', [dimsum.menus[0].id]).stock_left, stock0 - 2);
  setClockOffset(minutes(14));
  assert.equal(scheduler.tick().expired, 0);
  setClockOffset(minutes(16));
  assert.equal(scheduler.tick().expired, 1);
  const row = db.get('SELECT status, cancelled_by FROM orders WHERE id = ?', [o.id]);
  assert.deepEqual({ ...row }, { status: 'dibatalkan', cancelled_by: 'sistem' });
  assert.equal(db.get('SELECT stock_left FROM menus WHERE id = ?', [dimsum.menus[0].id]).stock_left, stock0);
  const me = await b.agent.get('/api/auth/me');
  assert.equal(me.body.penalty.violations, 1);
});

test('TC-26 tidak diambil hanya boleh setelah 30 menit dan pesanan lunas tidak dihitung pelanggaran', async () => {
  const b = await makeBuyer(app);
  const o = await readyOrder(b);
  const early = await warung.agent.post(`/api/seller/orders/${o.id}/no-show`);
  assert.equal(early.status, 409);
  assert.equal(early.body.code, 'GRACE_PERIOD');
  setClockOffset(minutes(31));
  const r = await warung.agent.post(`/api/seller/orders/${o.id}/no-show`);
  assert.equal(r.body.order.status, 'tidak_diambil');
  assert.equal((await b.agent.get('/api/auth/me')).body.penalty.violations, 1);

  setClockOffset(0);
  const b2 = await makeBuyer(app);
  const paid = await readyOrder(b2);
  await warung.agent.post(`/api/seller/orders/${paid.id}/verify-payment`);
  setClockOffset(minutes(31));
  await warung.agent.post(`/api/seller/orders/${paid.id}/no-show`);
  assert.equal((await b2.agent.get('/api/auth/me')).body.penalty.violations, 0);
});

test('TC-27 dua peringatan lalu blokir otomatis 24 jam pada pelanggaran ketiga', async () => {
  const b = await makeBuyer(app);
  for (let i = 0; i < 3; i++) {
    setClockOffset(0);
    const o = await readyOrder(b);
    setClockOffset(minutes(31));
    await warung.agent.post(`/api/seller/orders/${o.id}/no-show`);
  }
  const notifs = (await b.agent.get('/api/notifications')).body.notifications;
  assert.equal(notifs.filter((n) => n.type === 'peringatan').length, 2);
  assert.equal(notifs.filter((n) => n.type === 'blokir').length, 1);
  const me = (await b.agent.get('/api/auth/me')).body;
  assert.ok(me.penalty.blocked_until);
  const blocked = await order(b, warung.menus[0].id, { verified: true, group: { stall_id: warung.stall.id } });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'BLOCKED');
  setClockOffset(minutes(31 + 24 * 60 + 1));
  const after = await b.agent.post('/api/orders/checkout').send({ groups: [{ stall_id: warung.stall.id, payment_method: 'kasir' }] });
  assert.equal(after.status, 201, JSON.stringify(after.body));
});

test('TC-28 pengingat dikirim 10 menit setelah pesanan siap', async () => {
  const b = await makeBuyer(app);
  const o = await readyOrder(b);
  setClockOffset(minutes(11));
  assert.ok(scheduler.tick().reminded >= 1);
  const n = (await b.agent.get('/api/notifications')).body.notifications;
  assert.ok(n.some((x) => x.type === 'pengingat' && x.order_id === o.id));
});

test('TC-29 pembeli tidak bisa membatalkan pesanan yang sudah diproses', async () => {
  const b = await makeBuyer(app);
  const o = (await order(b, warung.menus[0].id, { verified: true, group: { stall_id: warung.stall.id } })).body.orders[0];
  await warung.agent.post(`/api/seller/orders/${o.id}/process`);
  const r = await b.agent.post(`/api/orders/${o.id}/cancel`).send({});
  assert.equal(r.status, 409);
});
