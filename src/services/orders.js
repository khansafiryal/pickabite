'use strict';
/** Logika inti pesanan: checkout, antrean adil (FIFO), status, pembayaran, serah terima. */
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { HttpError, iso, now, addMinutes, wibDate, wibHM, fromWib, isHM } = require('../utils');
const { generateUniqueCode, normalize } = require('./orderCode');
const { notify, orderChanged } = require('./notify');
const { ensureDailyStock, restoreItems } = require('./stock');
const penalty = require('./penalty');

const ACTIVE = ['menunggu_pembayaran', 'dalam_antrean', 'diproses', 'siap_diambil'];
const IN_QUEUE = ['dalam_antrean', 'diproses'];
const STATUS_LABEL = {
  menunggu_pembayaran: 'Menunggu Pembayaran',
  dalam_antrean: 'Dalam Antrean',
  diproses: 'Diproses',
  siap_diambil: 'Siap Diambil',
  selesai: 'Selesai',
  dibatalkan: 'Dibatalkan',
  tidak_diambil: 'Tidak Diambil',
};
const rupiah = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
const inList = (arr) => arr.map((s) => `'${s}'`).join(',');

/* ------------------------------ Stan & slot ------------------------------ */

/** Rentang jam operasional hari ini dalam WIB (ms). */
function operatingWindow(stall, at = now()) {
  const today = wibDate(at);
  return { open: fromWib(today, stall.open_time).getTime(), close: fromWib(today, stall.close_time).getTime() };
}

function withinHours(stall, at = now()) {
  const t = new Date(at).getTime();
  const w = operatingWindow(stall, at);
  return t >= w.open && t < w.close;
}

function stallState(stall) {
  const demo_mode = false;
  if (!stall.is_open) return { open: false, accepting: false, label: 'Tutup', demo_mode };
  if (!withinHours(stall)) return { open: false, accepting: false, label: 'Di luar jam operasional', demo_mode };
  if (!stall.accepting_orders) return { open: true, accepting: false, label: 'Jeda pesanan online', demo_mode };
  return { open: true, accepting: true, label: 'Buka', demo_mode };
}

function stallQueue(stallId) {
  const rows = db.all(
    `SELECT status, prep_minutes, processing_at FROM orders WHERE stall_id = ? AND payment_status = 'lunas' AND status IN (${inList(IN_QUEUE)})`,
    [stallId]
  );
  const t = now().getTime();
  let minutes = 0;
  for (const r of rows) {
    if (r.status === 'diproses' && r.processing_at) {
      minutes += Math.max(0, (new Date(r.processing_at).getTime() + r.prep_minutes * 60000 - t) / 60000);
    } else minutes += r.prep_minutes;
  }
  return { count: rows.length, wait_minutes: Math.round(minutes) };
}

function getSlots(stall, prepMinutes = 5) {
  const slotMs = config.rules.slotMinutes * 60000;
  const { open, close } = operatingWindow(stall);
  const earliest = Math.max(open, now().getTime() + prepMinutes * 60000);
  const start = Math.ceil(earliest / slotMs) * slotMs;
  const used = {};
  for (const r of db.all(
    `SELECT pickup_time, COUNT(*) AS n FROM orders WHERE stall_id = ? AND pickup_type = 'slot'
     AND status NOT IN ('dibatalkan') AND pickup_time >= ? GROUP BY pickup_time`,
    [stall.id, new Date(start).toISOString()]
  )) used[r.pickup_time] = r.n;
  const slots = [];
  for (let t = start; t < close; t += slotMs) {
    const at = new Date(t).toISOString();
    const n = used[at] || 0;
    slots.push({ time: wibHM(t), at, used: n, capacity: stall.slot_capacity, available: n < stall.slot_capacity });
  }
  return slots;
}

/* ------------------------------ Antrean ------------------------------ */

function enterQueue(order, at = now()) {
  const qDate = wibDate(at);
  const next = db.get('SELECT COALESCE(MAX(queue_number), 0) + 1 AS n FROM orders WHERE stall_id = ? AND queue_date = ?', [order.stall_id, qDate]).n;
  const target = order.pickup_type === 'slot' && order.pickup_time
    ? order.pickup_time
    : addMinutes(at, order.prep_minutes).toISOString();
  db.run(
    `UPDATE orders SET status = 'dalam_antrean', queue_number = ?, queue_date = ?, queued_at = ?, target_ready_at = ? WHERE id = ?`,
    [next, qDate, iso(at), target, order.id]
  );
  return next;
}

/** Posisi antrean dan estimasi siap (BR-01, BR-03). */
function queueInfo(order) {
  if (!IN_QUEUE.includes(order.status) || order.payment_status !== 'lunas') return null;
  const t = now().getTime();
  if (order.status === 'diproses') {
    const est = Math.max(t, new Date(order.processing_at || order.queued_at).getTime() + order.prep_minutes * 60000);
    return { position: 1, ahead: 0, est_ready_at: new Date(est).toISOString() };
  }
  const ahead = db.all(
    `SELECT status, prep_minutes, processing_at FROM orders
     WHERE stall_id = ? AND id <> ? AND payment_status = 'lunas' AND (status = 'diproses' OR (status = 'dalam_antrean' AND
       (target_ready_at < ? OR (target_ready_at = ? AND queue_number < ?))))`,
    [order.stall_id, order.id, order.target_ready_at, order.target_ready_at, order.queue_number]
  );
  let minutes = 0;
  for (const r of ahead) {
    if (r.status === 'diproses' && r.processing_at) {
      minutes += Math.max(0, (new Date(r.processing_at).getTime() + r.prep_minutes * 60000 - t) / 60000);
    } else minutes += r.prep_minutes;
  }
  let est = t + (minutes + order.prep_minutes) * 60000;
  if (order.pickup_type === 'slot' && order.pickup_time) est = Math.max(est, new Date(order.pickup_time).getTime());
  return { position: ahead.length + 1, ahead: ahead.length, est_ready_at: new Date(est).toISOString() };
}

/* ------------------------------ Serialisasi ------------------------------ */

function serialize(order, { forSeller = false } = {}) {
  if (!order) return null;
  const items = db.all('SELECT id, menu_id, name, price, qty, note, recipient, prep_minutes FROM order_items WHERE order_id = ? ORDER BY id', [order.id]);
  const stall = db.get('SELECT id, name, location, prepay_required FROM stalls WHERE id = ?', [order.stall_id]);
  const out = {
    ...order,
    status_label: STATUS_LABEL[order.status],
    items,
    stall,
    queue: queueInfo(order),
    can_cancel: ['menunggu_pembayaran', 'dalam_antrean'].includes(order.status) && order.payment_status !== 'lunas',
  };
  if (order.status === 'siap_diambil') {
    const base = Math.max(new Date(order.ready_at).getTime(), order.pickup_time ? new Date(order.pickup_time).getTime() : 0);
    out.no_show_allowed_at = new Date(base + config.rules.noShowGraceMin * 60000).toISOString();
  }
  if (forSeller) {
    const buyer = db.get('SELECT name, buyer_type, phone, identity_number FROM users WHERE id = ?', [order.user_id]);
    out.buyer = buyer;
  }
  return out;
}

const getOrder = (id) => db.get('SELECT * FROM orders WHERE id = ?', [id]);

/* ------------------------------ Checkout ------------------------------ */

function activeCount(userId) {
  return db.get(`SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status IN (${inList(ACTIVE)})`, [userId]).n;
}

/**
 * Membuat pesanan dari isi keranjang. Satu stan = satu pesanan (BR-05).
 * groups: [{ stall_id, pickup_type: 'asap'|'slot', pickup_time: 'HH:MM', payment_method: 'qris'|'kasir', note }]
 */
function checkout(user, groupsInput = []) {
  if (!user.is_verified) throw new HttpError(403, 'Verifikasi akun terlebih dahulu sebelum memesan.', { code: 'NOT_VERIFIED' });
  if (penalty.isBlocked(user)) {
    throw new HttpError(403, 'Akun sedang diblokir sementara karena pelanggaran berulang.', { code: 'BLOCKED', blocked_until: user.blocked_until });
  }
  ensureDailyStock();
  const cart = db.all(
    `SELECT c.*, m.name AS menu_name, m.price, m.prep_minutes, m.stock_left, m.is_available, m.is_deleted, m.stall_id
     FROM cart_items c JOIN menus m ON m.id = c.menu_id WHERE c.user_id = ? ORDER BY c.id`,
    [user.id]
  );
  if (cart.length === 0) throw new HttpError(400, 'Keranjang masih kosong.');

  const byStall = new Map();
  for (const it of cart) {
    if (!byStall.has(it.stall_id)) byStall.set(it.stall_id, []);
    byStall.get(it.stall_id).push(it);
  }
  const groups = (Array.isArray(groupsInput) && groupsInput.length ? groupsInput : [...byStall.keys()].map((id) => ({ stall_id: id })))
    .map((g) => ({ ...g, stall_id: Number(g.stall_id) }));
  if (new Set(groups.map((g) => g.stall_id)).size !== groups.length) throw new HttpError(400, 'Stan checkout tidak boleh berulang.');
  for (const g of groups) {
    if (!byStall.has(g.stall_id)) throw new HttpError(400, 'Stan yang dipilih tidak ada di keranjang.');
  }

  const active = activeCount(user.id);
  const max = config.rules.maxActiveOrders;
  if (active + groups.length > max) {
    throw new HttpError(409, `Kamu sudah punya ${active} pesanan aktif. Maksimal ${max} pesanan aktif per akun, jadi selesaikan dulu pesanan yang berjalan.`, { code: 'ACTIVE_LIMIT' });
  }

  // Validasi semua grup sebelum menulis apa pun.
  const plans = groups.map((g) => {
    const stall = db.get('SELECT * FROM stalls WHERE id = ?', [g.stall_id]);
    const state = stallState(stall);
    if (!state.accepting) throw new HttpError(409, `${stall.name} sedang ${state.label.toLowerCase()}. Coba lagi nanti.`, { code: 'STALL_CLOSED' });
    const items = byStall.get(g.stall_id);
    const qtyByMenu = {};
    for (const it of items) {
      if (it.is_deleted || !it.is_available) throw new HttpError(409, `${it.menu_name} sedang tidak tersedia. Hapus dari keranjang untuk melanjutkan.`, { code: 'MENU_UNAVAILABLE' });
      qtyByMenu[it.menu_id] = (qtyByMenu[it.menu_id] || 0) + it.qty;
      if (qtyByMenu[it.menu_id] > it.stock_left) {
        throw new HttpError(409, `Stok ${it.menu_name} tersisa ${it.stock_left} porsi.`, { code: 'OUT_OF_STOCK' });
      }
    }
    const prep = Math.max(...items.map((i) => i.prep_minutes));
    const pickupType = g.pickup_type === 'slot' ? 'slot' : 'asap';
    let pickupTime = null;
    if (pickupType === 'slot') {
      if (!isHM(g.pickup_time)) throw new HttpError(400, 'Jam ambil tidak valid.');
      const slot = getSlots(stall, prep).find((s) => s.time === g.pickup_time);
      if (!slot) throw new HttpError(409, `Slot ${g.pickup_time} di ${stall.name} sudah lewat atau di luar jam operasional.`, { code: 'SLOT_INVALID' });
      if (!slot.available) throw new HttpError(409, `Slot ${g.pickup_time} di ${stall.name} sudah penuh. Pilih slot lain.`, { code: 'SLOT_FULL' });
      pickupTime = slot.at;
    }
    let method = g.payment_method === 'kasir' ? 'kasir' : 'qris';
    if (stall.prepay_required && method !== 'qris') {
      throw new HttpError(409, `${stall.name} mewajibkan bayar di muka lewat QRIS.`, { code: 'PREPAY_REQUIRED' });
    }
    return { stall, items, prep, pickupType, pickupTime, method, note: typeof g.note === 'string' ? g.note.trim().slice(0, 200) : null };
  });

  const checkoutId = crypto.randomUUID();
  const createdIds = db.tx(() => {
    const ids = [];
    for (const p of plans) {
      const code = generateUniqueCode((c) => Boolean(db.get('SELECT 1 FROM orders WHERE code = ?', [c])));
      const total = p.items.reduce((s, i) => s + i.price * i.qty, 0);
      const count = p.items.reduce((s, i) => s + i.qty, 0);
      const t = now();
      const { lastInsertRowid: orderId } = db.run(
        `INSERT INTO orders (code, checkout_id, user_id, stall_id, status, pickup_type, pickup_time, payment_method,
          payment_status, payment_deadline, total, item_count, prep_minutes, note, order_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'belum_bayar', ?, ?, ?, ?, ?, ?, ?)`,
        [code, checkoutId, user.id, p.stall.id, 'menunggu_pembayaran', p.pickupType, p.pickupTime,
          p.method, addMinutes(t, config.rules.paymentWindowMin).toISOString(), total, count, p.prep, p.note,
          wibDate(t), iso(t)]
      );
      for (const it of p.items) {
        const { changes } = db.run('UPDATE menus SET stock_left = stock_left - ? WHERE id = ? AND stock_left >= ?', [it.qty, it.menu_id, it.qty]);
        if (changes !== 1) throw new HttpError(409, `Stok ${it.menu_name} baru saja habis.`, { code: 'OUT_OF_STOCK' });
        db.run(
          'INSERT INTO order_items (order_id, menu_id, name, price, qty, note, recipient, prep_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [orderId, it.menu_id, it.menu_name, it.price, it.qty, it.note || null, it.recipient || null, it.prep_minutes]
        );
        db.run('DELETE FROM cart_items WHERE id = ?', [it.id]);
      }
      ids.push(orderId);
    }
    return ids;
  });

  const orders = createdIds.map(getOrder);
  for (const o of orders) {
    const stall = db.get('SELECT name, owner_id FROM stalls WHERE id = ?', [o.stall_id]);
    if (o.status === 'menunggu_pembayaran') {
      notify(user.id, { type: 'pembayaran', title: `Bayar pesanan ${o.code}`, body: `Selesaikan pembayaran ${rupiah(o.total)} ke ${stall.name} dalam ${config.rules.paymentWindowMin} menit agar pesanan masuk antrean.`, orderId: o.id });
    } else {
      notify(user.id, { type: 'antrean', title: `Pesanan ${o.code} masuk antrean`, body: `Nomor antrean kamu ${o.queue_number} di ${stall.name}.`, orderId: o.id });
    }
    notify(stall.owner_id, { type: 'pesanan_baru', title: `Pesanan baru ${o.code}`, body: `${o.item_count} porsi, ${rupiah(o.total)}${o.status === 'menunggu_pembayaran' ? ' (menunggu pembayaran)' : ''}.`, orderId: o.id });
    orderChanged(o);
  }
  return orders;
}

/* ------------------------------ Pembeli ------------------------------ */

function ownedOrder(user, id) {
  const o = getOrder(id);
  if (!o || o.user_id !== user.id) throw new HttpError(404, 'Pesanan tidak ditemukan.');
  return o;
}

function buyerCancel(user, id, reason) {
  const o = ownedOrder(user, id);
  if (!['menunggu_pembayaran', 'dalam_antrean'].includes(o.status)) throw new HttpError(409, 'Pesanan yang sudah diproses tidak bisa dibatalkan.');
  if (o.payment_status === 'lunas') throw new HttpError(409, 'Pesanan sudah dibayar. Hubungi penjual untuk pembatalan dan pengembalian dana.');
  db.tx(() => {
    db.run(`UPDATE orders SET status = 'dibatalkan', cancelled_at = ?, cancelled_by = 'pembeli', cancel_reason = ? WHERE id = ?`, [iso(), reason || 'Dibatalkan pembeli', o.id]);
    restoreItems(o.id);
  });
  const stall = db.get('SELECT owner_id FROM stalls WHERE id = ?', [o.stall_id]);
  notify(stall.owner_id, { type: 'dibatalkan', title: `Pesanan ${o.code} dibatalkan pembeli`, body: reason || 'Pembeli membatalkan pesanan.', orderId: o.id });
  const updated = getOrder(o.id);
  orderChanged(updated);
  return updated;
}

function submitPayment(user, id, { ref, proof }) {
  const o = ownedOrder(user, id);
  if (o.payment_method !== 'qris') throw new HttpError(409, 'Pesanan ini dibayar di kasir saat pengambilan.');
  if (['dibatalkan', 'tidak_diambil', 'selesai'].includes(o.status)) throw new HttpError(409, 'Pesanan sudah tidak aktif.');
  if (o.payment_status === 'lunas') throw new HttpError(409, 'Pembayaran sudah terverifikasi.');
  if (o.payment_deadline && o.status === 'menunggu_pembayaran' && o.payment_status === 'belum_bayar' && o.payment_deadline < iso()) {
    throw new HttpError(409, 'Batas waktu pembayaran sudah lewat.');
  }
  if (o.payment_status === 'menunggu_verifikasi') throw new HttpError(409, 'Bukti pembayaran sedang menunggu verifikasi.');
  if (!ref && !proof) throw new HttpError(400, 'Isi nomor referensi atau unggah bukti pembayaran.');
  db.run(`UPDATE orders SET payment_status = 'menunggu_verifikasi', payment_rejection_reason = NULL, payment_ref = ?, payment_proof = COALESCE(?, payment_proof) WHERE id = ?`, [ref || null, proof || null, o.id]);
  const stall = db.get('SELECT owner_id FROM stalls WHERE id = ?', [o.stall_id]);
  notify(stall.owner_id, { type: 'bukti_bayar', title: `Bukti bayar ${o.code} masuk`, body: `Cek mutasi QRIS sebesar ${rupiah(o.total)} lalu verifikasi.`, orderId: o.id });
  const updated = getOrder(o.id);
  orderChanged(updated);
  return updated;
}

/* ------------------------------ Penjual ------------------------------ */

function stallOrder(stall, id) {
  const o = getOrder(id);
  if (!o || o.stall_id !== stall.id) throw new HttpError(404, 'Pesanan tidak ditemukan di stan ini.');
  return o;
}

function expectStatus(o, allowed, msg) {
  if (!allowed.includes(o.status)) throw new HttpError(409, msg || `Aksi tidak bisa dilakukan saat status ${STATUS_LABEL[o.status]}.`, { code: 'INVALID_TRANSITION' });
}

function finishSellerAction(o, notice) {
  if (notice) notify(o.user_id, { ...notice, orderId: o.id });
  const updated = getOrder(o.id);
  orderChanged(updated);
  return updated;
}

function verifyPayment(stall, id) {
  const o = stallOrder(stall, id);
  if (!ACTIVE.includes(o.status)) throw new HttpError(409, 'Pesanan sudah tidak aktif.');
  if (o.payment_status === 'lunas') throw new HttpError(409, 'Pembayaran sudah terverifikasi.');
  let queueNo = null;
  db.tx(() => {
    db.run(`UPDATE orders SET payment_status = 'lunas', payment_rejection_reason = NULL, paid_at = ? WHERE id = ?`, [iso(), o.id]);
    if (o.status === 'menunggu_pembayaran') queueNo = enterQueue(getOrder(o.id));
  });
  return finishSellerAction(o, queueNo
    ? { type: 'antrean', title: `Pembayaran ${o.code} diterima`, body: `Pesanan masuk antrean dengan nomor ${queueNo}.` }
    : { type: 'pembayaran', title: `Pembayaran ${o.code} diterima`, body: 'Terima kasih, pembayaranmu sudah terverifikasi.' });
}

function rejectPayment(stall, id, reason) {
  const o = stallOrder(stall, id);
  if (o.payment_status !== 'menunggu_verifikasi') throw new HttpError(409, 'Tidak ada bukti pembayaran yang menunggu verifikasi.');
  const deadline = o.status === 'menunggu_pembayaran' ? addMinutes(now(), 10).toISOString() : o.payment_deadline;
  db.run(`UPDATE orders SET payment_status = 'belum_bayar', payment_deadline = ?, payment_rejection_reason = ?, payment_ref = NULL, payment_proof = NULL WHERE id = ?`, [deadline, reason || 'Pembayaran belum ditemukan di mutasi QRIS.', o.id]);
  return finishSellerAction(o, { type: 'pembayaran', title: `Bukti bayar ${o.code} ditolak`, body: `${reason || 'Pembayaran belum ditemukan di mutasi QRIS.'} Unggah ulang bukti dalam 10 menit.` });
}

function startProcessing(stall, id) {
  const o = stallOrder(stall, id);
  expectStatus(o, ['dalam_antrean']);
  if (o.payment_status !== 'lunas') throw new HttpError(409, 'Verifikasi pembayaran sebelum memproses pesanan.');
  db.run(`UPDATE orders SET status = 'diproses', processing_at = ? WHERE id = ?`, [iso(), o.id]);
  return finishSellerAction(o, { type: 'diproses', title: `Pesanan ${o.code} sedang dibuat`, body: 'Penjual mulai menyiapkan pesananmu.' });
}

function markReady(stall, id) {
  const o = stallOrder(stall, id);
  expectStatus(o, ['dalam_antrean', 'diproses']);
  if (o.payment_status !== 'lunas') throw new HttpError(409, 'Verifikasi pembayaran sebelum menyiapkan pesanan.');
  const t = iso();
  db.run(`UPDATE orders SET status = 'siap_diambil', processing_at = COALESCE(processing_at, ?), ready_at = ? WHERE id = ?`, [t, t, o.id]);
  return finishSellerAction(o, { type: 'siap', title: `Pesanan ${o.code} siap diambil!`, body: `Ambil di ${stall.name} dan tunjukkan kode ${o.code}${o.payment_status !== 'lunas' ? `. Siapkan pembayaran ${rupiah(o.total)}` : ''}.` });
}

function findByCode(stall, rawCode) {
  const code = normalize(rawCode);
  const o = db.get('SELECT * FROM orders WHERE code = ?', [code]);
  if (!o || o.stall_id !== stall.id) throw new HttpError(404, `Kode ${code || '-'} tidak ditemukan di stan ini.`, { code: 'CODE_NOT_FOUND' });
  if (o.code_used_at) throw new HttpError(409, `Kode ${code} sudah dipakai pada pengambilan sebelumnya.`, { code: 'CODE_USED' });
  return o;
}

/** Serah terima: kode harus cocok dan hanya berlaku sekali (BR-07). */
function complete(stall, id, { code, paid }) {
  const o = stallOrder(stall, id);
  if (o.code_used_at) throw new HttpError(409, `Kode ${o.code} sudah dipakai.`, { code: 'CODE_USED' });
  if (normalize(code) !== o.code) throw new HttpError(400, 'Kode pengambilan tidak cocok.', { code: 'CODE_MISMATCH' });
  expectStatus(o, ['siap_diambil'], 'Pesanan belum siap diambil.');
  if (o.payment_status !== 'lunas' && !paid) throw new HttpError(409, 'Konfirmasi dulu bahwa pembeli sudah membayar.', { code: 'UNPAID' });
  const t = iso();
  db.run(
    `UPDATE orders SET status = 'selesai', completed_at = ?, code_used_at = ?, payment_status = 'lunas', paid_at = COALESCE(paid_at, ?) WHERE id = ?`,
    [t, t, t, o.id]
  );
  return finishSellerAction(o, { type: 'selesai', title: `Pesanan ${o.code} selesai`, body: `Terima kasih sudah memesan di ${stall.name}. Selamat menikmati!` });
}

function markNoShow(stall, id) {
  const o = stallOrder(stall, id);
  expectStatus(o, ['siap_diambil']);
  const allowedAt = serialize(o).no_show_allowed_at;
  if (allowedAt > iso()) {
    throw new HttpError(409, `Tunggu sampai ${wibHM(allowedAt)} WIB sebelum menandai tidak diambil.`, { code: 'GRACE_PERIOD' });
  }
  db.run(`UPDATE orders SET status = 'tidak_diambil', cancelled_at = ?, cancelled_by = 'penjual', cancel_reason = 'Tidak diambil' WHERE id = ?`, [iso(), o.id]);
  let extra = '';
  if (o.payment_status !== 'lunas') {
    penalty.addViolation(o.user_id, o.id, 'tidak_diambil');
    extra = ' Pelanggaran tercatat di akunmu.';
  }
  return finishSellerAction(o, { type: 'tidak_diambil', title: `Pesanan ${o.code} tidak diambil`, body: `Pesanan ditandai tidak diambil oleh ${stall.name}.${extra}` });
}

function sellerCancel(stall, id, reason) {
  const o = stallOrder(stall, id);
  expectStatus(o, ['menunggu_pembayaran', 'dalam_antrean', 'diproses']);
  if (!reason || !reason.trim()) throw new HttpError(400, 'Tuliskan alasan pembatalan.');
  if (o.payment_status === 'lunas') throw new HttpError(409, 'Pesanan yang pembayarannya sudah diverifikasi tidak bisa dibatalkan.', { code: 'PAYMENT_VERIFIED' });
  db.tx(() => {
    db.run(
      `UPDATE orders SET status = 'dibatalkan', cancelled_at = ?, cancelled_by = 'penjual', cancel_reason = ? WHERE id = ?`,
      [iso(), reason.trim().slice(0, 200), o.id]
    );
    restoreItems(o.id);
  });
  return finishSellerAction(o, {
    type: 'dibatalkan',
    title: `Pesanan ${o.code} dibatalkan penjual`,
    body: `Alasan: ${reason.trim()}.`,
  });
}

/* ------------------------------ Penjadwal ------------------------------ */

function expireUnpaid() {
  const rows = db.all(
    `SELECT * FROM orders WHERE status = 'menunggu_pembayaran' AND payment_status = 'belum_bayar' AND payment_deadline < ?`,
    [iso()]
  );
  for (const o of rows) {
    db.tx(() => {
      db.run(`UPDATE orders SET status = 'dibatalkan', cancelled_at = ?, cancelled_by = 'sistem', cancel_reason = 'Batas waktu pembayaran habis' WHERE id = ?`, [iso(), o.id]);
      restoreItems(o.id);
    });
    notify(o.user_id, { type: 'dibatalkan', title: `Pesanan ${o.code} dibatalkan otomatis`, body: `Pembayaran tidak diterima dalam ${config.rules.paymentWindowMin} menit.`, orderId: o.id });
    penalty.addViolation(o.user_id, o.id, 'tidak_bayar');
    const stall = db.get('SELECT owner_id FROM stalls WHERE id = ?', [o.stall_id]);
    notify(stall.owner_id, { type: 'dibatalkan', title: `Pesanan ${o.code} batal otomatis`, body: 'Pembeli tidak membayar sampai batas waktu. Stok sudah dikembalikan.', orderId: o.id });
    orderChanged(getOrder(o.id));
  }
  return rows.length;
}

function sendReminders() {
  const limit = addMinutes(now(), -config.rules.reminderAfterMin).toISOString();
  const rows = db.all(`SELECT o.*, s.name AS stall_name FROM orders o JOIN stalls s ON s.id = o.stall_id
    WHERE o.status = 'siap_diambil' AND o.reminded_at IS NULL AND o.ready_at < ?`, [limit]);
  for (const o of rows) {
    db.run('UPDATE orders SET reminded_at = ? WHERE id = ?', [iso(), o.id]);
    notify(o.user_id, { type: 'pengingat', title: `Pesanan ${o.code} menunggumu`, body: `Pesananmu sudah siap di ${o.stall_name} sejak ${config.rules.reminderAfterMin} menit lalu. Segera ambil agar tidak ditandai tidak diambil.`, orderId: o.id });
  }
  return rows.length;
}

module.exports = {
  ACTIVE, IN_QUEUE, STATUS_LABEL, operatingWindow, withinHours, stallState, stallQueue, getSlots, enterQueue, queueInfo, serialize, getOrder,
  activeCount, checkout, buyerCancel, submitPayment, verifyPayment, rejectPayment, startProcessing, markReady,
  findByCode, complete, markNoShow, sellerCancel, expireUnpaid, sendReminders, rupiah,
};
