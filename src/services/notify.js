'use strict';
/** Hub Server-Sent Events dan pencatat notifikasi. */
const db = require('../db');
const { iso } = require('../utils');

const clients = new Map(); // userId -> Set<res>

function subscribe(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
  return () => {
    const set = clients.get(userId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) clients.delete(userId);
  };
}

function push(userId, event, data) {
  const set = clients.get(userId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch (_) { /* koneksi sudah tertutup */ }
  }
}

/** Menyimpan notifikasi lalu mengirimkannya secara real-time. */
function notify(userId, { type, title, body, orderId = null }) {
  const createdAt = iso();
  const { lastInsertRowid } = db.run(
    'INSERT INTO notifications (user_id, type, title, body, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, type, title, body, orderId, createdAt]
  );
  push(userId, 'notification', { id: lastInsertRowid, type, title, body, order_id: orderId, created_at: createdAt, is_read: 0 });
}

/** Memberi tahu pembeli dan penjual bahwa data pesanan berubah agar layar diperbarui. */
function orderChanged(order) {
  if (!order) return;
  const stall = db.get('SELECT owner_id FROM stalls WHERE id = ?', [order.stall_id]);
  const data = { id: order.id, status: order.status, stall_id: order.stall_id, code: order.code };
  push(order.user_id, 'order', data);
  if (stall) push(stall.owner_id, 'order', data);
  for (const userId of clients.keys()) push(userId, 'queue', { stall_id: order.stall_id });
}

function connectedCount() {
  let n = 0;
  for (const s of clients.values()) n += s.size;
  return n;
}

module.exports = { subscribe, push, notify, orderChanged, connectedCount };
