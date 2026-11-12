'use strict';
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, makeSeller, makeBuyer, order, setClockOffset, db } = require('./helpers');
const { subscribe } = require('../src/services/notify');

let app;
before(async () => { app = await freshApp(); });
beforeEach(() => setClockOffset(0));

test('QRIS opsional dan kasir sama-sama menunggu verifikasi sebelum masuk antrean', async () => {
  const s = await makeSeller(app, { menus: [{ name: 'Nasi', price: 10000 }] });
  for (const method of ['qris', 'kasir']) {
    const b = await makeBuyer(app);
    const result = await order(b, s.menus[0].id, { group: { stall_id: s.stall.id, payment_method: method } });
    assert.equal(result.status, 201);
    const o = result.body.orders[0];
    assert.equal(o.status, 'menunggu_pembayaran');
    assert.equal(o.queue_number, null);
    assert.equal(o.queue, null);
    assert.equal((await s.agent.get(`/api/stalls/${s.stall.id}`)).body.stall.queue.count, 0);
    assert.equal((await s.agent.post(`/api/seller/orders/${o.id}/process`)).status, 409);
    assert.equal((await s.agent.post(`/api/seller/orders/${o.id}/ready`)).status, 409);
    const verified = await s.agent.post(`/api/seller/orders/${o.id}/verify-payment`);
    assert.equal(verified.body.order.status, 'dalam_antrean');
    assert.equal(verified.body.order.queue.position, 1);
    assert.equal((await s.agent.post(`/api/seller/orders/${o.id}/cancel`).send({ reason: 'Batal' })).status, 409);
    assert.equal((await b.agent.post(`/api/orders/${o.id}/cancel`)).status, 409);
    await s.agent.post(`/api/seller/orders/${o.id}/ready`);
    await s.agent.post(`/api/seller/orders/${o.id}/complete`).send({ code: o.code, paid: true });
  }
});

test('penolakan memberi notifikasi dan alasan tersimpan, bukti baru bisa diverifikasi sekali', async () => {
  const s = await makeSeller(app, { menus: [{ name: 'Mie', price: 12000 }] });
  const b = await makeBuyer(app);
  const o = (await order(b, s.menus[0].id, { group: { stall_id: s.stall.id, payment_method: 'qris' } })).body.orders[0];
  await b.agent.post(`/api/orders/${o.id}/payment`).field('payment_ref', 'BUKTI-LAMA');
  assert.equal((await b.agent.post(`/api/orders/${o.id}/payment`).field('payment_ref', 'GANDA')).status, 409);
  const rejected = await s.agent.post(`/api/seller/orders/${o.id}/reject-payment`).send({ reason: 'Nominal salah' });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.order.payment_rejection_reason, 'Nominal salah');
  assert.equal(rejected.body.order.queue_number, null);
  assert.equal(rejected.body.order.payment_ref, null);
  assert.equal((await s.agent.post(`/api/seller/orders/${o.id}/reject-payment`)).status, 409);
  const notifications = (await b.agent.get('/api/notifications')).body.notifications;
  assert.equal(notifications.filter((n) => n.title.includes('ditolak')).length, 1);
  assert.match(notifications.find((n) => n.title.includes('ditolak')).body, /Unggah ulang/);
  const resubmitted = await b.agent.post(`/api/orders/${o.id}/payment`).field('payment_ref', 'BUKTI-BARU');
  assert.equal(resubmitted.status, 200);
  assert.equal(resubmitted.body.order.payment_rejection_reason, null);
  const verified = await s.agent.post(`/api/seller/orders/${o.id}/verify-payment`);
  assert.equal(verified.status, 200);
  assert.equal((await s.agent.post(`/api/seller/orders/${o.id}/verify-payment`)).status, 409);
  assert.equal(db.get('SELECT queue_number FROM orders WHERE id = ?', [o.id]).queue_number, verified.body.order.queue_number);
});

test('pembaruan antrean mencapai pembeli yang belum memiliki pesanan aktif', async () => {
  const s = await makeSeller(app, { menus: [{ name: 'Roti', price: 5000 }] });
  const viewer = await makeBuyer(app);
  const b = await makeBuyer(app);
  const events = [];
  const off = subscribe(viewer.user.id, { write: (message) => events.push(message) });
  try {
    const o = (await order(b, s.menus[0].id, { group: { stall_id: s.stall.id } })).body.orders[0];
    await s.agent.post(`/api/seller/orders/${o.id}/verify-payment`);
    assert.ok(events.some((message) => message.includes('event: queue')));
    assert.equal((await viewer.agent.get(`/api/stalls/${s.stall.id}`)).body.stall.queue.count, 1);
  } finally { off(); }
});

test('pesan ulang menghormati stok gabungan dan menyatukan item yang sama', async () => {
  const s = await makeSeller(app, { menus: [{ name: 'Teh', price: 4000, daily_stock: 3 }] });
  const b = await makeBuyer(app);
  const o = (await order(b, s.menus[0].id, { group: { stall_id: s.stall.id } })).body.orders[0];
  await s.agent.post(`/api/seller/orders/${o.id}/cancel`).send({ reason: 'Uji stok' });
  await b.agent.post('/api/cart').send({ menu_id: s.menus[0].id, qty: 2 });
  const first = await b.agent.post(`/api/orders/${o.id}/reorder`);
  assert.equal(first.body.cart.count, 3);
  assert.equal(first.body.cart.groups[0].items.length, 1);
  const second = await b.agent.post(`/api/orders/${o.id}/reorder`);
  assert.equal(second.body.cart.count, 3);
  assert.deepEqual(second.body.skipped, ['Teh']);
});
