'use strict';
/** Penjadwal ringan: batal otomatis pesanan tak dibayar, pengingat ambil, reset stok harian. */
const orders = require('./orders');
const { ensureDailyStock } = require('./stock');

let timer = null;

function tick() {
  try {
    ensureDailyStock();
    return { expired: orders.expireUnpaid(), reminded: orders.sendReminders() };
  } catch (err) {
    console.error('[scheduler]', err.message);
    return { error: err.message };
  }
}

function start(intervalMs = 30000) {
  stop();
  tick();
  timer = setInterval(tick, intervalMs);
  timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { tick, start, stop };
