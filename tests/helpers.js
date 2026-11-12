'use strict';
/** Fixture uji: basis data in-memory, akun penjual/pembeli terverifikasi, dan menu. */
const os = require('os');
const path = require('path');
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'pickabite-test-uploads');
process.env.SHOW_OTP = 'true';
process.env.NODE_ENV = 'test';
const request = require('supertest');
const db = require('../src/db');
const { createApp } = require('../src/app');
const { setClockOffset: setOffset, fromWib, wibDate } = require('../src/utils');
const testStart = fromWib(wibDate(), '09:00').getTime();
const setClockOffset = (ms) => setOffset(testStart - Date.now() + ms);
const sellerAgents = new Map();

let seq = 0;
const nim = () => `2351504${String(++seq).padStart(8, '0')}`;

async function freshApp() {
  setClockOffset(0);
  await db.init({});
  return createApp();
}

async function makeSeller(app, { stall = 'Stan Uji', prepay = false, menus = [] } = {}) {
  const agent = request.agent(app);
  const email = `seller${++seq}@uji.id`;
  const r = await agent.post('/api/auth/register').send({ role: 'seller', name: 'Penjual Uji', email, password: 'rahasia123', stall_name: stall });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  await agent.post('/api/auth/verify').send({ otp: r.body.dev_otp });
  await agent.patch('/api/seller/stall').send({ open_time: '00:00', close_time: '23:59', prepay_required: prepay, is_open: true, accepting_orders: true, slot_capacity: 10 });
  const created = [];
  for (const m of menus) {
    const res = await agent.post('/api/seller/menus').send({ category: 'Makanan Berat', prep_minutes: 5, daily_stock: 20, ...m });
    created.push(res.body.menu);
  }
  const me = await agent.get('/api/auth/me');
  sellerAgents.set(me.body.stall.id, agent);
  return { agent, email, stall: me.body.stall, menus: created };
}

async function makeBuyer(app, { type = 'mahasiswa', verify = true } = {}) {
  const agent = request.agent(app);
  const identity = type === 'mahasiswa' ? nim() : type === 'dosen' ? `1985031520101220${String(++seq).padStart(2, '0')}` : undefined;
  const email = `buyer${++seq}@student.ub.ac.id`;
  const r = await agent.post('/api/auth/register').send({ role: 'buyer', name: `Pembeli ${seq}`, email, password: 'rahasia123', buyer_type: type, identity_number: identity });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  if (verify) await agent.post('/api/auth/verify').send({ otp: r.body.dev_otp });
  return { agent, email, identity, user: r.body.user, otp: r.body.dev_otp };
}

/** Tambah ke keranjang lalu checkout satu stan. */
async function order(buyer, menuId, { qty = 1, group = {}, verified = false } = {}) {
  await buyer.agent.post('/api/cart').send({ menu_id: menuId, qty });
  const result = await buyer.agent.post('/api/orders/checkout').send({ groups: [{ stall_id: group.stall_id, pickup_type: 'asap', payment_method: 'kasir', ...group }] });
  if (verified && result.status === 201) {
    const payment = await sellerAgents.get(group.stall_id).post(`/api/seller/orders/${result.body.orders[0].id}/verify-payment`);
    if (payment.status !== 200) throw new Error(JSON.stringify(payment.body));
    result.body.orders[0] = payment.body.order;
  }
  return result;
}

const minutes = (m) => m * 60000;

module.exports = { freshApp, makeSeller, makeBuyer, order, setClockOffset, minutes, db };
