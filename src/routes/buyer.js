'use strict';
/** Rute pembeli: favorit, keranjang, checkout, pesanan, pembayaran. */
const express = require('express');
const QRCode = require('qrcode');
const db = require('../db');
const { HttpError, iso, int, str } = require('../utils');
const { requireRole } = require('../middleware/auth');
const { imageUpload } = require('../middleware/upload');
const { ensureDailyStock } = require('../services/stock');
const orders = require('../services/orders');

const router = express.Router();
router.use(requireRole('buyer'));
const proofUpload = imageUpload('proofs');

/* ----------------------------- Favorit ----------------------------- */
router.get('/favorites', (req, res) => {
  ensureDailyStock();
  const menus = db.all(`SELECT m.*, s.name AS stall_name FROM favorites f JOIN menus m ON m.id = f.menu_id
    JOIN stalls s ON s.id = m.stall_id WHERE f.user_id = ? AND m.is_deleted = 0 ORDER BY f.created_at DESC`, [req.user.id])
    .map((m) => ({ ...m, is_favorite: true, sold_out: m.stock_left <= 0 }));
  res.json({ menus });
});
router.post('/favorites/:menuId', (req, res) => {
  const m = db.get('SELECT id FROM menus WHERE id = ? AND is_deleted = 0', [int(req.params.menuId)]);
  if (!m) throw new HttpError(404, 'Menu tidak ditemukan.');
  db.run('INSERT OR IGNORE INTO favorites (user_id, menu_id, created_at) VALUES (?, ?, ?)', [req.user.id, m.id, iso()]);
  res.json({ is_favorite: true });
});
router.delete('/favorites/:menuId', (req, res) => {
  db.run('DELETE FROM favorites WHERE user_id = ? AND menu_id = ?', [req.user.id, int(req.params.menuId)]);
  res.json({ is_favorite: false });
});

/* ----------------------------- Keranjang ----------------------------- */
function cartView(userId) {
  ensureDailyStock();
  const rows = db.all(`SELECT c.id, c.menu_id, c.qty, c.note, c.recipient, m.name, m.price, m.prep_minutes, m.image, m.category,
      m.stock_left, m.is_available, m.is_deleted, s.id AS stall_id, s.name AS stall_name, s.prepay_required, s.is_open, s.accepting_orders
    FROM cart_items c JOIN menus m ON m.id = c.menu_id JOIN stalls s ON s.id = m.stall_id WHERE c.user_id = ? ORDER BY s.name, c.id`, [userId]);
  const groups = [];
  for (const r of rows) {
    let g = groups.find((x) => x.stall.id === r.stall_id);
    if (!g) {
      const stall = db.get('SELECT * FROM stalls WHERE id = ?', [r.stall_id]);
      g = { stall: { id: stall.id, name: stall.name, prepay_required: stall.prepay_required, open_time: stall.open_time, close_time: stall.close_time, state: orders.stallState(stall), queue: orders.stallQueue(stall.id) }, items: [], subtotal: 0, portions: 0, prep_minutes: 0 };
      groups.push(g);
    }
    const unavailable = Boolean(r.is_deleted || !r.is_available || r.stock_left < r.qty);
    g.items.push({ id: r.id, menu_id: r.menu_id, name: r.name, price: r.price, qty: r.qty, note: r.note, recipient: r.recipient, image: r.image, category: r.category, stock_left: r.stock_left, prep_minutes: r.prep_minutes, unavailable });
    g.subtotal += r.price * r.qty;
    g.portions += r.qty;
    g.prep_minutes = Math.max(g.prep_minutes, r.prep_minutes);
  }
  return { groups, count: groups.reduce((s, g) => s + g.portions, 0), total: groups.reduce((s, g) => s + g.subtotal, 0) };
}

router.get('/cart', (req, res) => res.json(cartView(req.user.id)));

router.post('/cart', (req, res) => {
  const b = req.body || {};
  const qty = int(b.qty, 1);
  if (qty < 1 || qty > 99) throw new HttpError(400, 'Jumlah porsi 1 sampai 99.');
  ensureDailyStock();
  const m = db.get('SELECT * FROM menus WHERE id = ? AND is_deleted = 0', [int(b.menu_id)]);
  if (!m) throw new HttpError(404, 'Menu tidak ditemukan.');
  if (!m.is_available || m.stock_left <= 0) throw new HttpError(409, `${m.name} sedang habis.`);
  const note = str(b.note, 120) || null;
  const recipient = str(b.recipient, 40) || null;
  const inCart = db.get('SELECT COALESCE(SUM(qty),0) AS n FROM cart_items WHERE user_id = ? AND menu_id = ?', [req.user.id, m.id]).n;
  if (inCart + qty > m.stock_left) throw new HttpError(409, `Stok ${m.name} tersisa ${m.stock_left} porsi.`);
  const same = db.get(`SELECT * FROM cart_items WHERE user_id = ? AND menu_id = ? AND COALESCE(note,'') = ? AND COALESCE(recipient,'') = ?`,
    [req.user.id, m.id, note || '', recipient || '']);
  if (same) db.run('UPDATE cart_items SET qty = qty + ? WHERE id = ?', [qty, same.id]);
  else db.run('INSERT INTO cart_items (user_id, menu_id, qty, note, recipient, created_at) VALUES (?, ?, ?, ?, ?, ?)', [req.user.id, m.id, qty, note, recipient, iso()]);
  res.status(201).json(cartView(req.user.id));
});

router.patch('/cart/:id', (req, res) => {
  const item = db.get('SELECT * FROM cart_items WHERE id = ? AND user_id = ?', [int(req.params.id), req.user.id]);
  if (!item) throw new HttpError(404, 'Item keranjang tidak ditemukan.');
  const b = req.body || {};
  const qty = b.qty === undefined ? item.qty : int(b.qty, 0);
  if (qty < 1 || qty > 99) throw new HttpError(400, 'Jumlah porsi 1 sampai 99.');
  const note = b.note === undefined ? item.note : (str(b.note, 120) || null);
  const recipient = b.recipient === undefined ? item.recipient : (str(b.recipient, 40) || null);
  db.run('UPDATE cart_items SET qty = ?, note = ?, recipient = ? WHERE id = ?', [qty, note, recipient, item.id]);
  res.json(cartView(req.user.id));
});

router.delete('/cart/:id', (req, res) => {
  db.run('DELETE FROM cart_items WHERE id = ? AND user_id = ?', [int(req.params.id), req.user.id]);
  res.json(cartView(req.user.id));
});
router.delete('/cart', (req, res) => {
  db.run('DELETE FROM cart_items WHERE user_id = ?', [req.user.id]);
  res.json(cartView(req.user.id));
});

/* ----------------------------- Pesanan ----------------------------- */
router.post('/orders/checkout', (req, res) => {
  const created = orders.checkout(req.user, (req.body && req.body.groups) || []);
  res.status(201).json({ orders: created.map((o) => orders.serialize(o)) });
});

router.get('/orders', (req, res) => {
  const scope = req.query.scope === 'history' ? 'history' : req.query.scope === 'all' ? 'all' : 'active';
  const active = orders.ACTIVE.map((s) => `'${s}'`).join(',');
  const cond = scope === 'active' ? `AND status IN (${active})` : scope === 'history' ? `AND status NOT IN (${active})` : '';
  const rows = db.all(`SELECT * FROM orders WHERE user_id = ? ${cond} ORDER BY created_at DESC LIMIT 100`, [req.user.id]);
  res.json({ orders: rows.map((o) => orders.serialize(o)) });
});

router.get('/orders/:id', async (req, res, next) => {
  try {
    const o = orders.getOrder(int(req.params.id));
    if (!o || o.user_id !== req.user.id) throw new HttpError(404, 'Pesanan tidak ditemukan.');
    const out = orders.serialize(o);
    out.qr = await QRCode.toDataURL(`PICKABITE:${o.code}`, { margin: 1, width: 260, color: { dark: '#1E1E24', light: '#FFFFFF' } });
    if (o.payment_method === 'qris') {
      const stall = db.get('SELECT name, qris_image FROM stalls WHERE id = ?', [o.stall_id]);
      out.qris = stall.qris_image
        ? { image: stall.qris_image, demo: false }
        : { image: await QRCode.toDataURL(`QRIS-DEMO|${stall.name}|${o.total}|${o.code}`, { margin: 1, width: 260 }), demo: true };
    }
    if (o.payment_proof) out.payment_proof_url = `/api/files/proof/${o.id}`;
    res.json({ order: out });
  } catch (e) { next(e); }
});

router.post('/orders/:id/cancel', (req, res) => {
  const o = orders.buyerCancel(req.user, int(req.params.id), str(req.body && req.body.reason, 200));
  res.json({ order: orders.serialize(o) });
});

router.post('/orders/:id/payment', proofUpload.single('proof'), (req, res) => {
  const proof = req.file ? `proofs/${req.file.filename}` : null;
  const o = orders.submitPayment(req.user, int(req.params.id), { ref: str(req.body && req.body.payment_ref, 60), proof });
  res.json({ order: orders.serialize(o) });
});

router.post('/orders/:id/reorder', (req, res) => {
  const o = orders.getOrder(int(req.params.id));
  if (!o || o.user_id !== req.user.id) throw new HttpError(404, 'Pesanan tidak ditemukan.');
  ensureDailyStock();
  const added = [];
  const skipped = [];
  for (const it of db.all('SELECT * FROM order_items WHERE order_id = ?', [o.id])) {
    const m = db.get('SELECT * FROM menus WHERE id = ? AND is_deleted = 0', [it.menu_id]);
    const inCart = m ? db.get('SELECT COALESCE(SUM(qty),0) AS n FROM cart_items WHERE user_id = ? AND menu_id = ?', [req.user.id, m.id]).n : 0;
    if (!m || !m.is_available || m.stock_left < inCart + it.qty) { skipped.push(it.name); continue; }
    const same = db.get("SELECT * FROM cart_items WHERE user_id = ? AND menu_id = ? AND COALESCE(note,'') = ? AND COALESCE(recipient,'') = ?", [req.user.id, m.id, it.note || '', it.recipient || '']);
    if (same && same.qty + it.qty > 99) { skipped.push(it.name); continue; }
    if (same) db.run('UPDATE cart_items SET qty = qty + ? WHERE id = ?', [it.qty, same.id]);
    else db.run('INSERT INTO cart_items (user_id, menu_id, qty, note, recipient, created_at) VALUES (?, ?, ?, ?, ?, ?)', [req.user.id, m.id, it.qty, it.note, it.recipient, iso()]);
    added.push(it.name);
  }
  res.json({ added, skipped, cart: cartView(req.user.id) });
});

module.exports = router;
