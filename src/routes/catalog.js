'use strict';
/** Katalog publik: direktori stan, menu, dan slot jam ambil (FR-03). */
const express = require('express');
const db = require('../db');
const { HttpError, int, str } = require('../utils');
const { ensureDailyStock } = require('../services/stock');
const { stallState, stallQueue, getSlots } = require('../services/orders');

const router = express.Router();

const MENU_COLS = `m.id, m.stall_id, m.name, m.description, m.ingredients, m.category, m.price, m.prep_minutes,
  m.daily_stock, m.stock_left, m.image, m.is_available, s.name AS stall_name`;

function favSet(req) {
  if (!req.user || req.user.role !== 'buyer') return new Set();
  return new Set(db.all('SELECT menu_id FROM favorites WHERE user_id = ?', [req.user.id]).map((r) => r.menu_id));
}

const decorateMenu = (m, favs) => ({ ...m, sold_out: m.stock_left <= 0, is_favorite: favs.has(m.id) });

function decorateStall(s) {
  const stats = db.get(
    'SELECT COUNT(*) AS menu_count, MIN(price) AS min_price FROM menus WHERE stall_id = ? AND is_deleted = 0', [s.id]);
  const { qris_image, ...rest } = s;
  return { ...rest, has_qris: Boolean(qris_image), state: stallState(s), queue: stallQueue(s.id), ...stats };
}

router.get('/stalls', (_req, res) => {
  ensureDailyStock();
  const stalls = db.all('SELECT * FROM stalls ORDER BY is_open DESC, name ASC').map(decorateStall);
  res.json({ stalls });
});

router.get('/stalls/:id', (req, res) => {
  ensureDailyStock();
  const s = db.get('SELECT * FROM stalls WHERE id = ?', [int(req.params.id)]);
  if (!s) throw new HttpError(404, 'Stan tidak ditemukan.');
  const favs = favSet(req);
  const menus = db.all(`SELECT ${MENU_COLS} FROM menus m JOIN stalls s ON s.id = m.stall_id
    WHERE m.stall_id = ? AND m.is_deleted = 0 ORDER BY m.category, m.name`, [s.id]).map((m) => decorateMenu(m, favs));
  res.json({ stall: decorateStall(s), menus });
});

router.get('/stalls/:id/slots', (req, res) => {
  const s = db.get('SELECT * FROM stalls WHERE id = ?', [int(req.params.id)]);
  if (!s) throw new HttpError(404, 'Stan tidak ditemukan.');
  const prep = Math.min(120, Math.max(1, int(req.query.prep, 5)));
  res.json({ slots: getSlots(s, prep), state: stallState(s) });
});

router.get('/menus', (req, res) => {
  ensureDailyStock();
  const where = ['m.is_deleted = 0'];
  const params = [];
  const q = str(req.query.q, 60);
  if (q) { where.push('(m.name LIKE ? OR s.name LIKE ? OR m.description LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const cat = str(req.query.category, 30);
  if (cat) { where.push('m.category = ?'); params.push(cat); }
  const stall = int(req.query.stall);
  if (stall) { where.push('m.stall_id = ?'); params.push(stall); }
  const favs = favSet(req);
  const popular = db.all(`SELECT i.menu_id, SUM(i.qty) AS sold FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.status = 'selesai' AND o.order_date >= date('now', '-7 day') GROUP BY i.menu_id`);
  const sold = Object.fromEntries(popular.map((p) => [p.menu_id, p.sold]));
  const menus = db.all(`SELECT ${MENU_COLS} FROM menus m JOIN stalls s ON s.id = m.stall_id WHERE ${where.join(' AND ')}
    ORDER BY m.name`, params).map((m) => ({ ...decorateMenu(m, favs), sold_7d: sold[m.id] || 0 }));
  if (req.query.sort === 'popular') menus.sort((a, b) => b.sold_7d - a.sold_7d);
  res.json({ menus });
});

router.get('/menus/:id', (req, res) => {
  ensureDailyStock();
  const m = db.get(`SELECT ${MENU_COLS} FROM menus m JOIN stalls s ON s.id = m.stall_id WHERE m.id = ? AND m.is_deleted = 0`, [int(req.params.id)]);
  if (!m) throw new HttpError(404, 'Menu tidak ditemukan.');
  const stall = decorateStall(db.get('SELECT * FROM stalls WHERE id = ?', [m.stall_id]));
  res.json({ menu: decorateMenu(m, favSet(req)), stall });
});

module.exports = router;
