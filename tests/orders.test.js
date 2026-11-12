'use strict';
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, makeSeller, makeBuyer, order, setClockOffset, db } = require('./helpers');

const CODE = /^[A-HJ-NP-Z]{3}[0-9]{3}$/;
let app;
let seller;
let seller2;

beforeEach(() => setClockOffset(0));
before(async () => {
  app = await freshApp();
  seller = await makeSeller(app, { stall: 'Warung Uji', menus: [{ name: 'Nasi Ayam', price: 13000, daily_stock: 50, prep_minutes: 3 }, { name: 'Es Teh', price: 4000, category: 'Minuman', daily_stock: 5, prep_minutes: 1 }] });
  seller2 = await makeSeller(app, { stall: 'Dimsum Uji', prepay: true, menus: [{ name: 'Dimsum', price: 12000, category: 'Camilan', daily_stock: 10, prep_minutes: 5 }] });
});

test('TC-10 penjual menambah menu dan stok harian, pembeli melihat stok terkini', async () => {
  const b = await makeBuyer(app);
  const r = await b.agent.get(`/api/stalls/${seller.stall.id}`);
  const m = r.body.menus.find((x) => x.name === 'Nasi Ayam');
  assert.equal(m.daily_stock, 50);
  assert.equal(m.stock_left, 50);
});

test('TC-11 pre-order secepatnya: kode unik, nomor antrean berurutan, stok berkurang', async () => {
  const b1 = await makeBuyer(app);
  const b2 = await makeBuyer(app);
  const r1 = await order(b1, seller.menus[0].id, { verified: true, qty: 2, group: { stall_id: seller.stall.id } });
  const r2 = await order(b2, seller.menus[0].id, { verified: true, qty: 1, group: { stall_id: seller.stall.id } });
  assert.equal(r1.status, 201);
  const [o1] = r1.body.orders;
  const [o2] = r2.body.orders;
  assert.match(o1.code, CODE);
  assert.notEqual(o1.code, o2.code);
  assert.equal(o1.status, 'dalam_antrean');
  assert.equal(o2.queue_number, o1.queue_number + 1);
  const menu = db.get('SELECT stock_left FROM menus WHERE id = ?', [seller.menus[0].id]);
  assert.equal(menu.stock_left, 47);
});

test('TC-12 pre-order dengan slot jam ambil mencatat jam yang dipilih, slot penuh ditolak', async (t) => {
  await seller.agent.patch('/api/seller/stall').send({ slot_capacity: 1 });
  const { body } = await seller.agent.get(`/api/stalls/${seller.stall.id}/slots?prep=3`);
  if (!body.slots.length) return t.skip('Tidak ada slot tersisa hari ini (dijalankan menjelang tengah malam)');
  const slot = body.slots[body.slots.length - 1];
  const b1 = await makeBuyer(app);
  const r = await order(b1, seller.menus[0].id, { verified: true, group: { stall_id: seller.stall.id, pickup_type: 'slot', pickup_time: slot.time } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.orders[0].pickup_time, slot.at);
  const b2 = await makeBuyer(app);
  const full = await order(b2, seller.menus[0].id, { verified: true, group: { stall_id: seller.stall.id, pickup_type: 'slot', pickup_time: slot.time } });
  assert.equal(full.status, 409);
  assert.equal(full.body.code, 'SLOT_FULL');
  await seller.agent.patch('/api/seller/stall').send({ slot_capacity: 10 });
});

test('TC-13 antrean adil: dosen yang memesan belakangan berada di belakang mahasiswa (tanpa jalur khusus)', async () => {
  const s = await makeSeller(app, { menus: [{ name: 'Pecel', price: 9000, prep_minutes: 2 }] });
  const mhs = await makeBuyer(app);
  const dosen = await makeBuyer(app, { type: 'dosen' });
  const a = (await order(mhs, s.menus[0].id, { verified: true, group: { stall_id: s.stall.id } })).body.orders[0];
  const d = (await order(dosen, s.menus[0].id, { verified: true, group: { stall_id: s.stall.id } })).body.orders[0];
  assert.equal(a.queue.position, 1);
  assert.equal(d.queue.position, 2);
  assert.equal(d.queue.ahead, 1);
  assert.ok(d.queue_number > a.queue_number);
});

test('TC-14 status bergerak dalam antrean, diproses, siap diambil, selesai; transisi tidak sah ditolak', async () => {
  const b = await makeBuyer(app);
  const o = (await order(b, seller.menus[0].id, { verified: true, group: { stall_id: seller.stall.id } })).body.orders[0];
  const early = await seller.agent.post(`/api/seller/orders/${o.id}/complete`).send({ code: o.code, paid: true });
  assert.equal(early.status, 409);
  assert.equal((await seller.agent.post(`/api/seller/orders/${o.id}/process`)).body.order.status, 'diproses');
  assert.equal((await seller.agent.post(`/api/seller/orders/${o.id}/process`)).status, 409);
  assert.equal((await seller.agent.post(`/api/seller/orders/${o.id}/ready`)).body.order.status, 'siap_diambil');
  const notif = await b.agent.get('/api/notifications');
  assert.ok(notif.body.notifications.some((n) => n.type === 'siap' && n.order_id === o.id));
  const done = await seller.agent.post(`/api/seller/orders/${o.id}/complete`).send({ code: o.code, paid: true });
  assert.equal(done.body.order.status, 'selesai');
  assert.equal(done.body.order.payment_status, 'lunas');
});

test('TC-15 keranjang lintas stan dipecah menjadi satu pesanan per stan dengan kode berbeda', async () => {
  const b = await makeBuyer(app);
  await b.agent.post('/api/cart').send({ menu_id: seller.menus[0].id, qty: 3, recipient: 'Rani' });
  await b.agent.post('/api/cart').send({ menu_id: seller.menus[1].id, qty: 1 });
  const cart = await b.agent.post('/api/cart').send({ menu_id: seller2.menus[0].id, qty: 1 });
  assert.equal(cart.body.groups.length, 2);
  const r = await b.agent.post('/api/orders/checkout').send({ groups: [{ stall_id: seller.stall.id, payment_method: 'kasir' }, { stall_id: seller2.stall.id, payment_method: 'qris' }] });
  assert.equal(r.status, 201);
  const [a, c] = r.body.orders;
  assert.equal(r.body.orders.length, 2);
  assert.notEqual(a.code, c.code);
  assert.equal(a.checkout_id, c.checkout_id);
  assert.equal(a.items.length, 2);
  assert.equal(a.item_count, 4);
  assert.equal(a.items.find((i) => i.recipient === 'Rani').qty, 3);
  assert.equal((await b.agent.get('/api/cart')).body.count, 0);
});

test('TC-16 pesanan aktif lebih dari 3 ditolak dengan pesan jelas', async () => {
  const b = await makeBuyer(app);
  for (let i = 0; i < 3; i++) assert.equal((await order(b, seller.menus[0].id, { verified: true, group: { stall_id: seller.stall.id } })).status, 201);
  const r = await order(b, seller.menus[0].id, { verified: true, group: { stall_id: seller.stall.id } });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'ACTIVE_LIMIT');
  assert.match(r.body.error, /Maksimal 3 pesanan aktif/);
});

test('TC-17 menu yang ditutup penjual atau stok habis tidak bisa dipesan', async () => {
  const b = await makeBuyer(app);
  await seller.agent.post(`/api/seller/menus/${seller.menus[1].id}/availability`).send({ is_available: false });
  assert.equal((await b.agent.post('/api/cart').send({ menu_id: seller.menus[1].id, qty: 1 })).status, 409);
  await seller.agent.post(`/api/seller/menus/${seller.menus[1].id}/availability`).send({ is_available: true });
  const left = db.get('SELECT stock_left FROM menus WHERE id = ?', [seller.menus[1].id]).stock_left;
  const r = await b.agent.post('/api/cart').send({ menu_id: seller.menus[1].id, qty: left + 1 });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /tersisa/);
});

test('TC-18 stan yang menjeda pesanan online menolak checkout', async () => {
  const s = await makeSeller(app, { menus: [{ name: 'Roti', price: 5000 }] });
  const b = await makeBuyer(app);
  await b.agent.post('/api/cart').send({ menu_id: s.menus[0].id, qty: 1 });
  await s.agent.patch('/api/seller/stall').send({ accepting_orders: false });
  const r = await b.agent.post('/api/orders/checkout').send({ groups: [{ stall_id: s.stall.id, payment_method: 'kasir' }] });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'STALL_CLOSED');
});

test('TC-19 pesanan lain tidak bisa dibuka oleh akun lain', async () => {
  const b1 = await makeBuyer(app);
  const b2 = await makeBuyer(app);
  const o = (await order(b1, seller.menus[0].id, { verified: true, group: { stall_id: seller.stall.id } })).body.orders[0];
  assert.equal((await b2.agent.get(`/api/orders/${o.id}`)).status, 404);
  const mine = await b1.agent.get(`/api/orders/${o.id}`);
  assert.ok(mine.body.order.qr.startsWith('data:image/png'));
});

test('TC-20 riwayat menampilkan pesanan selesai dan pesan ulang mengisi keranjang', async () => {
  const b = await makeBuyer(app);
  const o = (await order(b, seller.menus[0].id, { verified: true, group: { stall_id: seller.stall.id } })).body.orders[0];
  await seller.agent.post(`/api/seller/orders/${o.id}/ready`);
  await seller.agent.post(`/api/seller/orders/${o.id}/complete`).send({ code: o.code, paid: true });
  const h = await b.agent.get('/api/orders?scope=history');
  assert.equal(h.body.orders[0].code, o.code);
  const re = await b.agent.post(`/api/orders/${o.id}/reorder`);
  assert.deepEqual(re.body.added, ['Nasi Ayam']);
  assert.equal(re.body.cart.count, 1);
});

test('TC-21 pembatalan oleh penjual wajib beralasan dan mengembalikan stok', async () => {
  const b = await makeBuyer(app);
  const before = db.get('SELECT stock_left FROM menus WHERE id = ?', [seller.menus[0].id]).stock_left;
  const o = (await order(b, seller.menus[0].id, { qty: 2, group: { stall_id: seller.stall.id } })).body.orders[0];
  assert.equal((await seller.agent.post(`/api/seller/orders/${o.id}/cancel`).send({})).status, 400);
  const r = await seller.agent.post(`/api/seller/orders/${o.id}/cancel`).send({ reason: 'Stok habis' });
  assert.equal(r.body.order.status, 'dibatalkan');
  assert.equal(db.get('SELECT stock_left FROM menus WHERE id = ?', [seller.menus[0].id]).stock_left, before);
});

test('TC-33 jam operasional selalu ditegakkan di localhost', async () => {
  const s = await makeSeller(app, { menus: [{ name: 'Soto', price: 10000 }] });
  await s.agent.patch('/api/seller/stall').send({ open_time: '13:00', close_time: '16:00' });
  const b = await makeBuyer(app);
  const slots = await b.agent.get(`/api/stalls/${s.stall.id}/slots`);
  assert.equal(slots.body.state.accepting, false);
  assert.ok(slots.body.slots.every((slot) => slot.time >= '13:00' && slot.time < '16:00'));
  const r = await order(b, s.menus[0].id, { group: { stall_id: s.stall.id } });
  assert.equal(r.status, 409);
  setClockOffset(7 * 60 * 60000);
  const afterClose = await order(b, s.menus[0].id, { group: { stall_id: s.stall.id } });
  assert.equal(afterClose.status, 409);
});
