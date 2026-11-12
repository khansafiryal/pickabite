'use strict';
/** Ringkasan dashboard dan laporan penjualan penjual (FR-15, FR-19). */
const db = require('../db');
const { now, wibDate, wibHour, addMinutes } = require('../utils');
const { stallQueue } = require('./orders');

const DAY_MS = 86400000;
function lastDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(wibDate(new Date(now().getTime() - i * DAY_MS)));
  return out;
}

function summary(stall) {
  const today = wibDate();
  const yesterday = wibDate(new Date(now().getTime() - DAY_MS));
  const sumDay = (d) => db.get(
    `SELECT COALESCE(SUM(total),0) AS revenue, COALESCE(SUM(item_count),0) AS portions, COUNT(*) AS orders
     FROM orders WHERE stall_id = ? AND order_date = ? AND status = 'selesai'`, [stall.id, d]);
  const t = sumDay(today);
  const y = sumDay(yesterday);
  const count = (where, params = []) => db.get(`SELECT COUNT(*) AS n FROM orders WHERE stall_id = ? AND ${where}`, [stall.id, ...params]).n;

  const days = lastDays(7);
  const revenueRows = db.all(
    `SELECT order_date, SUM(total) AS revenue, SUM(item_count) AS portions FROM orders
     WHERE stall_id = ? AND status = 'selesai' AND order_date >= ? GROUP BY order_date`, [stall.id, days[0]]);
  const revMap = Object.fromEntries(revenueRows.map((r) => [r.order_date, r]));

  const hourly = Array.from({ length: 24 }, () => 0);
  for (const r of db.all(`SELECT created_at FROM orders WHERE stall_id = ? AND order_date >= ? AND status <> 'dibatalkan'`, [stall.id, days[0]])) {
    hourly[wibHour(r.created_at)] += 1;
  }
  const peakHour = hourly.indexOf(Math.max(...hourly));

  const prep = db.get(
    `SELECT AVG((julianday(ready_at) - julianday(COALESCE(processing_at, queued_at))) * 1440) AS m
     FROM orders WHERE stall_id = ? AND order_date = ? AND ready_at IS NOT NULL`, [stall.id, today]).m;

  const top = db.all(
    `SELECT i.menu_id, i.name, SUM(i.qty) AS qty, SUM(i.qty * i.price) AS revenue FROM order_items i
     JOIN orders o ON o.id = i.order_id WHERE o.stall_id = ? AND o.status = 'selesai' AND o.order_date >= ?
     GROUP BY i.menu_id, i.name ORDER BY qty DESC LIMIT 5`, [stall.id, days[0]]);

  const lowStock = db.all(
    `SELECT id, name, stock_left, daily_stock FROM menus WHERE stall_id = ? AND is_deleted = 0
     AND (stock_left <= 3 OR stock_left * 10 <= daily_stock) ORDER BY stock_left ASC LIMIT 6`, [stall.id]);

  return {
    today,
    revenue_today: t.revenue,
    revenue_yesterday: y.revenue,
    portions_today: t.portions,
    completed_today: t.orders,
    processing: count(`status IN ('dalam_antrean','diproses')`),
    in_queue: count(`status = 'dalam_antrean'`),
    cooking: count(`status = 'diproses'`),
    ready: count(`status = 'siap_diambil'`),
    awaiting_payment: count(`status NOT IN ('dibatalkan','tidak_diambil','selesai') AND (status = 'menunggu_pembayaran' OR payment_status = 'menunggu_verifikasi')`),
    cancelled_today: count(`order_date = ? AND status = 'dibatalkan'`, [today]),
    no_show_today: count(`order_date = ? AND status = 'tidak_diambil'`, [today]),
    avg_prep_minutes: prep ? Math.round(prep * 10) / 10 : null,
    queue: stallQueue(stall.id),
    revenue_7d: days.map((d) => ({ date: d, revenue: revMap[d]?.revenue || 0, portions: revMap[d]?.portions || 0 })),
    hourly_7d: hourly.map((n, h) => ({ hour: h, orders: n })).filter((r) => r.hour >= 6 && r.hour <= 20),
    peak_hour: Math.max(...hourly) > 0 ? peakHour : null,
    top_menus: top,
    low_stock: lowStock,
  };
}

function report(stall, from, to) {
  const days = db.all(
    `SELECT order_date AS date,
       SUM(CASE WHEN status = 'selesai' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN status = 'selesai' THEN item_count ELSE 0 END) AS portions,
       SUM(CASE WHEN status = 'selesai' THEN total ELSE 0 END) AS revenue,
       SUM(CASE WHEN status = 'dibatalkan' THEN 1 ELSE 0 END) AS cancelled,
       SUM(CASE WHEN status = 'tidak_diambil' THEN 1 ELSE 0 END) AS no_show,
       COUNT(*) AS orders
     FROM orders WHERE stall_id = ? AND order_date BETWEEN ? AND ? GROUP BY order_date ORDER BY order_date`, [stall.id, from, to]);
  const menus = db.all(
    `SELECT i.name, SUM(i.qty) AS qty, SUM(i.qty * i.price) AS revenue FROM order_items i JOIN orders o ON o.id = i.order_id
     WHERE o.stall_id = ? AND o.status = 'selesai' AND o.order_date BETWEEN ? AND ? GROUP BY i.name ORDER BY qty DESC`, [stall.id, from, to]);
  const totals = days.reduce((a, d) => ({
    orders: a.orders + d.orders, completed: a.completed + d.completed, portions: a.portions + d.portions,
    revenue: a.revenue + d.revenue, cancelled: a.cancelled + d.cancelled, no_show: a.no_show + d.no_show,
  }), { orders: 0, completed: 0, portions: 0, revenue: 0, cancelled: 0, no_show: 0 });
  return { from, to, days, menus, totals };
}

function csv(stall, from, to) {
  const rows = db.all(
    `SELECT o.code, o.order_date, o.created_at, o.status, o.payment_method, o.payment_status, o.item_count, o.total, u.name AS buyer
     FROM orders o JOIN users u ON u.id = o.user_id WHERE o.stall_id = ? AND o.order_date BETWEEN ? AND ? ORDER BY o.created_at`,
    [stall.id, from, to]);
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['kode', 'tanggal', 'waktu_dibuat', 'status', 'metode_bayar', 'status_bayar', 'porsi', 'total', 'pembeli'];
  return [head.join(','), ...rows.map((r) => [r.code, r.order_date, r.created_at, r.status, r.payment_method, r.payment_status, r.item_count, r.total, r.buyer].map(esc).join(','))].join('\n');
}

module.exports = { summary, report, csv, lastDays, addMinutes };
