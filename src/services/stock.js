'use strict';
/** BR-12: stok harian direset otomatis saat hari berganti (dicek setiap kali stok dibaca). */
const db = require('../db');
const { wibDate, iso } = require('../utils');

function ensureDailyStock() {
  const today = wibDate();
  const stale = db.get('SELECT COUNT(*) AS n FROM menus WHERE stock_date IS NULL OR stock_date <> ?', [today]).n;
  if (stale > 0) {
    db.run('UPDATE menus SET stock_left = daily_stock, stock_date = ?, updated_at = ? WHERE stock_date IS NULL OR stock_date <> ?', [today, iso(), today]);
  }
}

function restoreItems(orderId) {
  const order = db.get('SELECT order_date FROM orders WHERE id = ?', [orderId]);
  if (!order || order.order_date !== wibDate()) return; // stok hari lalu sudah direset
  for (const it of db.all('SELECT menu_id, qty FROM order_items WHERE order_id = ?', [orderId])) {
    db.run('UPDATE menus SET stock_left = MIN(daily_stock, stock_left + ?) WHERE id = ?', [it.qty, it.menu_id]);
  }
}

module.exports = { ensureDailyStock, restoreItems };
