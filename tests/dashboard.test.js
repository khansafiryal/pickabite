'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, makeSeller, makeBuyer, order } = require('./helpers');

let app;
let seller;
before(async () => {
  app = await freshApp();
  seller = await makeSeller(app, { menus: [{ name: 'Nasi Goreng', price: 13000, prep_minutes: 3 }, { name: 'Es Jeruk', price: 6000, category: 'Minuman', prep_minutes: 1 }] });
});

async function complete(buyer, menuId, qty) {
  const o = (await order(buyer, menuId, { verified: true, qty, group: { stall_id: seller.stall.id } })).body.orders[0];
  await seller.agent.post(`/api/seller/orders/${o.id}/process`);
  await seller.agent.post(`/api/seller/orders/${o.id}/ready`);
  await seller.agent.post(`/api/seller/orders/${o.id}/complete`).send({ code: o.code, paid: true });
  return o;
}

test('TC-30 dashboard menghitung pendapatan, porsi terjual, dan pesanan diproses sesuai data', async () => {
  const b1 = await makeBuyer(app);
  const b2 = await makeBuyer(app);
  await complete(b1, seller.menus[0].id, 2); // 26.000
  await complete(b2, seller.menus[1].id, 3); // 18.000
  await order(b1, seller.menus[0].id, { verified: true, qty: 1, group: { stall_id: seller.stall.id } }); // masih antre
  const d = (await seller.agent.get('/api/seller/dashboard')).body;
  assert.equal(d.revenue_today, 44000);
  assert.equal(d.portions_today, 5);
  assert.equal(d.completed_today, 2);
  assert.equal(d.processing, 1);
  assert.equal(d.revenue_7d.length, 7);
  assert.equal(d.revenue_7d[6].revenue, 44000);
  assert.equal(d.top_menus[0].name, 'Es Jeruk');
});

test('TC-31 laporan per periode dan ekspor CSV', async () => {
  const r = (await seller.agent.get('/api/seller/reports')).body;
  assert.equal(r.totals.revenue, 44000);
  assert.equal(r.menus.length, 2);
  const csv = await seller.agent.get('/api/seller/reports.csv');
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, /kode,tanggal,waktu_dibuat,status/);
  assert.equal(csv.text.trim().split('\n').length, 4);
});

test('TC-32 pengaturan stan berubah tanpa mengubah kode dan langsung terlihat oleh pembeli', async () => {
  await seller.agent.patch('/api/seller/stall').send({ is_open: false });
  const b = await makeBuyer(app);
  const s = (await b.agent.get(`/api/stalls/${seller.stall.id}`)).body.stall;
  assert.equal(s.state.label, 'Tutup');
  const bad = await seller.agent.patch('/api/seller/stall').send({ open_time: '16:00', close_time: '08:00' });
  assert.equal(bad.status, 400);
});
