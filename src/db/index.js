'use strict';
/**
 * Pembungkus sql.js (SQLite versi WebAssembly) agar tidak butuh kompilasi native.
 * Basis data disimpan ke berkas setelah setiap perubahan (atau di akhir transaksi).
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

let SQL = null;
let db = null;
let dbFile = null;
let txDepth = 0;

async function init({ file = null, reset = false } = {}) {
  if (!SQL) SQL = await initSqlJs();
  dbFile = file;
  if (file && !reset && fs.existsSync(file)) {
    db = new SQL.Database(fs.readFileSync(file));
  } else {
    db = new SQL.Database();
  }
  pragmas();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  if (!all('PRAGMA table_info(orders)').some((column) => column.name === 'payment_rejection_reason')) {
    db.run('ALTER TABLE orders ADD COLUMN payment_rejection_reason TEXT');
    db.run(`UPDATE orders SET status = 'menunggu_pembayaran', queue_number = NULL, queue_date = NULL,
      queued_at = NULL, processing_at = NULL, target_ready_at = NULL,
      payment_deadline = COALESCE(payment_deadline, ?)
      WHERE status IN ('dalam_antrean', 'diproses') AND payment_status <> 'lunas'`,
      [new Date(Date.now() + require('../config').rules.paymentWindowMin * 60000).toISOString()]);
  }
  persist();
  return db;
}

function pragmas() {
  db.run('PRAGMA foreign_keys = ON');
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function get(sql, params = []) {
  return all(sql, params)[0];
}

function run(sql, params = []) {
  db.run(sql, params);
  const changes = db.getRowsModified();
  const lastInsertRowid = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  persist();
  return { changes, lastInsertRowid };
}

/** Menjalankan fn di dalam transaksi. Bila fn melempar galat, semua perubahan dibatalkan. */
function tx(fn) {
  if (txDepth > 0) return fn();
  db.run('BEGIN');
  txDepth++;
  try {
    const result = fn();
    db.run('COMMIT');
    txDepth--;
    persist();
    return result;
  } catch (err) {
    db.run('ROLLBACK');
    txDepth--;
    throw err;
  }
}

function persist() {
  if (txDepth > 0 || !dbFile) return;
  const data = db.export(); // export() mengembalikan pragma ke nilai bawaan
  pragmas();
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const tmp = `${dbFile}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(data));
  fs.renameSync(tmp, dbFile);
}

function close() {
  if (db) db.close();
  db = null;
}

module.exports = { init, all, get, run, tx, close };
