'use strict';
/** Rute penjual: dashboard, papan pesanan, verifikasi kode, menu, pengaturan stan, laporan. */
const express = require('express');
const db = require('../db');
const { HttpError, iso, int, str, isHM, wibDate } = require('../utils');
const { requireRole } = require('../middleware/auth');
const { imageUpload } = require('../middleware/upload');
const { orderChanged } = require('../services/notify');
const { ensureDailyStock } = require('../services/stock');
const orders = require('../services/orders');
const dashboard = require('../services/dashboard');

const router = express.Router();
router.use(requireRole('seller'));
const publicUpload = imageUpload('public');

const CATEGORIES = ['Makanan Berat', 'Mie', 'Camilan', 'Minuman'];
const ILLUSTRATIONS = ['nasi-ayam', 'nasi-telur', 'nasi-pecel', 'nasi-goreng', 'ayam-katsu', 'mie-ayam', 'dimsum', 'gyoza', 'gorengan', 'es-teh', 'es-jeruk', 'kopi'];

/* ----------------------------- Dashboard ----------------------------- */
router.get('/dashboard', (req, res) => res.json(dashboard.summary(req.stall)));

/* ----------------------------- Pesanan ----------------------------- */
const STATUS_ORDER = { siap_diambil: 0, diproses: 1, dalam_antrean: 2, menunggu_pembayaran: 3 };

router.get('/orders', (req, res) => {
  const scope = str(req.query.status, 30) || 'active';
  let rows;
  if (scope === 'active') {
    rows = db.all(`SELECT * FROM orders WHERE stall_id = ? AND status IN (${orders.ACTIVE.map((s) => `'${s}'`).join(',')})`, [req.stall.id]);
    rows.sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
      || String(a.target_ready_at || a.created_at).localeCompare(String(b.target_ready_at || b.created_at))
      || (a.queue_number || 0) - (b.queue_number || 0));
  } else if (scope === 'history') {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : wibDate();
    rows = db.all(`SELECT * FROM orders WHERE stall_id = ? AND order_date = ? AND status IN ('selesai','dibatalkan','tidak_diambil') ORDER BY created_at DESC`, [req.stall.id, date]);
  } else {
    if (!orders.STATUS_LABEL[scope]) throw new HttpError(400, 'Status tidak dikenal.');
    rows = db.all('SELECT * FROM orders WHERE stall_id = ? AND status = ? ORDER BY created_at DESC LIMIT 200', [req.stall.id, scope]);
  }
  res.json({ orders: rows.map((o) => orders.serialize(o, { forSeller: true })) });
});

const act = (fn) => (req, res) => {
  const o = fn(req.stall, int(req.params.id), req.body || {});
  res.json({ order: orders.serialize(o, { forSeller: true }) });
};
router.post('/orders/:id/verify-payment', act((s, id) => orders.verifyPayment(s, id)));
router.post('/orders/:id/reject-payment', act((s, id, b) => orders.rejectPayment(s, id, str(b.reason, 200))));
router.post('/orders/:id/process', act((s, id) => orders.startProcessing(s, id)));
router.post('/orders/:id/ready', act((s, id) => orders.markReady(s, id)));
router.post('/orders/:id/complete', act((s, id, b) => orders.complete(s, id, { code: b.code, paid: Boolean(b.paid) })));
router.post('/orders/:id/no-show', act((s, id) => orders.markNoShow(s, id)));
router.post('/orders/:id/cancel', act((s, id, b) => orders.sellerCancel(s, id, str(b.reason, 200))));

router.post('/verify-code', (req, res) => {
  const o = orders.findByCode(req.stall, req.body && req.body.code);
  res.json({ order: orders.serialize(o, { forSeller: true }) });
});

/* ----------------------------- Menu ----------------------------- */
router.get('/menus', (req, res) => {
  ensureDailyStock();
  const menus = db.all('SELECT * FROM menus WHERE stall_id = ? AND is_deleted = 0 ORDER BY category, name', [req.stall.id]);
  res.json({ menus, categories: CATEGORIES, illustrations: ILLUSTRATIONS });
});

function menuInput(b, existing) {
  const pick = (k, d) => (b[k] === undefined ? d : b[k]);
  const name = str(pick('name', existing?.name), 60);
  const category = pick('category', existing?.category);
  const price = int(pick('price', existing?.price), -1);
  const prep = int(pick('prep_minutes', existing?.prep_minutes ?? 5), -1);
  const daily = int(pick('daily_stock', existing?.daily_stock ?? 0), -1);
  if (name.length < 2) throw new HttpError(400, 'Nama menu minimal 2 karakter.', { field: 'name' });
  if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Kategori tidak valid.', { field: 'category' });
  if (price < 0 || price > 1000000) throw new HttpError(400, 'Harga harus angka 0 sampai 1.000.000.', { field: 'price' });
  if (prep < 1 || prep > 120) throw new HttpError(400, 'Waktu siap 1 sampai 120 menit.', { field: 'prep_minutes' });
  if (daily < 0 || daily > 2000) throw new HttpError(400, 'Stok harian 0 sampai 2000.', { field: 'daily_stock' });
  let stockLeft = b.stock_left === undefined || b.stock_left === '' ? null : int(b.stock_left, -1);
  if (stockLeft !== null && (stockLeft < 0 || stockLeft > daily)) throw new HttpError(400, 'Sisa stok hari ini tidak boleh melebihi stok harian.', { field: 'stock_left' });
  const illus = str(pick('illustration', ''), 30);
  return {
    name, category, price, prep, daily, stockLeft,
    description: str(pick('description', existing?.description || ''), 300) || null,
    ingredients: str(pick('ingredients', existing?.ingredients || ''), 200) || null,
    illustration: ILLUSTRATIONS.includes(illus) ? `illust:${illus}` : null,
  };
}

router.post('/menus', publicUpload.single('image'), (req, res) => {
  const v = menuInput(req.body || {});
  const image = req.file ? `/uploads/public/${req.file.filename}` : (v.illustration || 'illust:nasi-ayam');
  const t = iso();
  const { lastInsertRowid } = db.run(
    `INSERT INTO menus (stall_id, name, description, ingredients, category, price, prep_minutes, daily_stock, stock_left, stock_date, image, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.stall.id, v.name, v.description, v.ingredients, v.category, v.price, v.prep, v.daily, v.stockLeft ?? v.daily, wibDate(), image, t, t]
  );
  res.status(201).json({ menu: db.get('SELECT * FROM menus WHERE id = ?', [lastInsertRowid]) });
});

function ownMenu(req) {
  const m = db.get('SELECT * FROM menus WHERE id = ? AND stall_id = ? AND is_deleted = 0', [int(req.params.id), req.stall.id]);
  if (!m) throw new HttpError(404, 'Menu tidak ditemukan.');
  return m;
}

router.patch('/menus/:id', publicUpload.single('image'), (req, res) => {
  const m = ownMenu(req);
  const v = menuInput(req.body || {}, m);
  let stockLeft = v.stockLeft;
  if (stockLeft === null) stockLeft = Math.max(0, Math.min(v.daily, m.stock_left + (v.daily - m.daily_stock)));
  const image = req.file ? `/uploads/public/${req.file.filename}` : (v.illustration || m.image);
  db.run(
    `UPDATE menus SET name = ?, description = ?, ingredients = ?, category = ?, price = ?, prep_minutes = ?, daily_stock = ?, stock_left = ?, image = ?, updated_at = ? WHERE id = ?`,
    [v.name, v.description, v.ingredients, v.category, v.price, v.prep, v.daily, stockLeft, image, iso(), m.id]
  );
  res.json({ menu: db.get('SELECT * FROM menus WHERE id = ?', [m.id]) });
});

router.post('/menus/:id/availability', (req, res) => {
  const m = ownMenu(req);
  const available = Boolean(req.body && req.body.is_available);
  db.run('UPDATE menus SET is_available = ?, updated_at = ? WHERE id = ?', [available ? 1 : 0, iso(), m.id]);
  res.json({ menu: db.get('SELECT * FROM menus WHERE id = ?', [m.id]) });
});

router.delete('/menus/:id', (req, res) => {
  const m = ownMenu(req);
  db.tx(() => {
    db.run('UPDATE menus SET is_deleted = 1, is_available = 0, updated_at = ? WHERE id = ?', [iso(), m.id]);
    db.run('DELETE FROM cart_items WHERE menu_id = ?', [m.id]);
  });
  res.json({ ok: true });
});

/* ----------------------------- Stan ----------------------------- */
router.get('/stall', (req, res) => {
  res.json({ stall: { ...req.stall, state: orders.stallState(req.stall) } });
});

router.patch('/stall', (req, res) => {
  const b = req.body || {};
  const s = req.stall;
  const val = (k) => (b[k] === undefined ? s[k] : b[k]);
  const name = str(val('name'), 60);
  if (name.length < 3) throw new HttpError(400, 'Nama stan minimal 3 karakter.', { field: 'name' });
  const open = val('open_time');
  const close = val('close_time');
  if (!isHM(open) || !isHM(close) || open >= close) throw new HttpError(400, 'Jam operasional tidak valid. Jam buka harus lebih awal dari jam tutup.', { field: 'open_time' });
  const cap = int(val('slot_capacity'), 0);
  if (cap < 1 || cap > 100) throw new HttpError(400, 'Kapasitas slot 1 sampai 100 pesanan.', { field: 'slot_capacity' });
  const bool = (k) => (val(k) === true || val(k) === 1 || val(k) === '1' || val(k) === 'true' ? 1 : 0);
  db.run(
    `UPDATE stalls SET name = ?, description = ?, location = ?, open_time = ?, close_time = ?, is_open = ?, accepting_orders = ?,
      prepay_required = ?, slot_capacity = ? WHERE id = ?`,
    [name, str(val('description') || '', 200) || null, str(val('location') || '', 80) || null, open, close,
      bool('is_open'), bool('accepting_orders'), bool('prepay_required'), cap, s.id]
  );
  const stall = db.get('SELECT * FROM stalls WHERE id = ?', [s.id]);
  orderChanged({ id: null, stall_id: stall.id, user_id: stall.owner_id });
  res.json({ stall: { ...stall, state: orders.stallState(stall) } });
});

router.post('/stall/qris', publicUpload.single('qris'), (req, res) => {
  if (!req.file) throw new HttpError(400, 'Pilih gambar QRIS terlebih dahulu.');
  db.run('UPDATE stalls SET qris_image = ? WHERE id = ?', [`/uploads/public/${req.file.filename}`, req.stall.id]);
  res.json({ stall: db.get('SELECT * FROM stalls WHERE id = ?', [req.stall.id]) });
});

/* ----------------------------- Laporan ----------------------------- */
function range(req) {
  const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  const to = ok(req.query.to) ? req.query.to : wibDate();
  const from = ok(req.query.from) ? req.query.from : dashboard.lastDays(7)[0];
  if (from > to) throw new HttpError(400, 'Tanggal awal harus sebelum tanggal akhir.');
  return { from, to };
}
router.get('/reports', (req, res) => {
  const { from, to } = range(req);
  res.json(dashboard.report(req.stall, from, to));
});
router.get('/reports.csv', (req, res) => {
  const { from, to } = range(req);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="pickabite-${from}-sd-${to}.csv"`);
  res.send('﻿' + dashboard.csv(req.stall, from, to));
});

module.exports = router;
