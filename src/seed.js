'use strict';
/**
 * Data contoh untuk demo lokal. Nama stan Warung Bu Mimin dan CNC Dimsum Gyoza mengikuti hasil wawancara,
 * sedangkan akun pembeli dan Kedai Kopi Sudut bersifat fiktif.
 */
const bcrypt = require('bcryptjs');
const db = require('./db');
const { now, iso, addMinutes, wibDate, fromWib } = require('./utils');
const { randomCode } = require('./services/orderCode');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SELLERS = [
  {
    name: 'Ibu Mimin', email: 'mimin@pickabite.id', phone: '081234500001',
    stall: { name: 'Warung Bu Mimin', description: 'Masakan rumahan yang siap dalam 1 sampai 3 menit. Pembayaran diverifikasi sebelum pesanan masuk antrean.', location: 'Kantin FILKOM, stan 1', open: '07:00', close: '16:00', prepay: 0, cap: 12, cover: 'nasi-ayam' },
    menus: [
      ['Nasi Ayam Geprek', 'Makanan Berat', 13000, 3, 40, 'nasi-ayam', 'Ayam goreng tepung digeprek dengan sambal bawang pedas.', 'Nasi, Ayam tepung, Sambal bawang, Lalapan'],
      ['Nasi Telur Balado', 'Makanan Berat', 10000, 2, 30, 'nasi-telur', 'Telur rebus berbalut sambal balado merah yang manis pedas.', 'Nasi, Telur, Sambal balado, Kerupuk'],
      ['Nasi Pecel', 'Makanan Berat', 9000, 2, 25, 'nasi-pecel', 'Sayur rebus segar dengan bumbu kacang khas Madiun.', 'Nasi, Sayur rebus, Bumbu kacang, Peyek'],
      ['Nasi Goreng Spesial', 'Makanan Berat', 13000, 3, 20, 'nasi-goreng', 'Nasi goreng kecap dengan telur ceplok dan kerupuk.', 'Nasi, Telur, Kecap, Kerupuk'],
      ['Gorengan Isi 3', 'Camilan', 5000, 1, 40, 'gorengan', 'Tahu isi, tempe mendoan, dan bakwan sayur.', 'Tahu, Tempe, Bakwan'],
      ['Es Teh Manis', 'Minuman', 4000, 1, 60, 'es-teh', 'Teh melati dingin dengan gula pasir.', 'Teh melati, Gula, Es batu'],
      ['Es Jeruk', 'Minuman', 6000, 1, 30, 'es-jeruk', 'Perasan jeruk peras segar.', 'Jeruk peras, Gula, Es batu'],
    ],
  },
  {
    name: 'Fia (CNC)', email: 'cnc@pickabite.id', phone: '081234500002',
    stall: { name: 'CNC Dimsum Gyoza', description: 'Dimsum, gyoza, dan mie kukus. Bayar di muka lewat QRIS, lalu pesanan dibuat.', location: 'Kantin FILKOM, stan 4', open: '08:00', close: '15:00', prepay: 1, cap: 6, cover: 'dimsum' },
    menus: [
      ['Dimsum Ayam isi 4', 'Camilan', 12000, 5, 15, 'dimsum', 'Siomay ayam kukus dengan saus cabai.', 'Ayam, Udang, Kulit pangsit, Saus cabai'],
      ['Gyoza Ayam isi 5', 'Camilan', 13000, 5, 12, 'gyoza', 'Gyoza ayam panggang dengan dasar renyah.', 'Ayam, Kubis, Kulit gyoza, Saus wijen'],
      ['Mie Ayam Dimsum', 'Mie', 15000, 10, 10, 'mie-ayam', 'Mie ayam kenyal dengan topping dua dimsum.', 'Mie, Ayam kecap, Dimsum, Sawi'],
      ['Chicken Katsu Rice', 'Makanan Berat', 16000, 5, 10, 'ayam-katsu', 'Katsu ayam renyah dengan saus katsu dan nasi hangat.', 'Nasi, Ayam katsu, Kubis, Saus katsu'],
      ['Es Teh Lemon', 'Minuman', 5000, 1, 20, 'es-teh', 'Teh dingin dengan irisan lemon.', 'Teh, Lemon, Gula, Es batu'],
    ],
  },
  {
    name: 'Kedai Kopi Sudut', email: 'kopi@pickabite.id', phone: '081234500003',
    stall: { name: 'Kedai Kopi Sudut', description: 'Kopi dan camilan untuk teman nugas (stan demo).', location: 'Kantin FILKOM, stan 6', open: '07:00', close: '17:00', prepay: 0, cap: 10, cover: 'kopi' },
    menus: [
      ['Kopi Susu Gula Aren', 'Minuman', 12000, 3, 30, 'kopi', 'Espresso, susu segar, dan gula aren.', 'Espresso, Susu, Gula aren, Es'],
      ['Kopi Hitam Tubruk', 'Minuman', 7000, 2, 30, 'kopi', 'Kopi robusta Dampit diseduh tubruk.', 'Kopi robusta, Gula'],
      ['Es Teh Tarik', 'Minuman', 8000, 2, 25, 'es-teh', 'Teh susu yang ditarik hingga berbuih.', 'Teh, Susu kental, Es'],
      ['Pisang Goreng Keju', 'Camilan', 9000, 4, 20, 'gorengan', 'Pisang kepok goreng dengan parutan keju.', 'Pisang, Tepung, Keju, Susu kental'],
    ],
  },
];

const BUYERS = [
  ['Alya Putri', 'alya@student.ub.ac.id', 'mahasiswa', '235150400111001'],
  ['Dimas Pratama', 'dimas@student.ub.ac.id', 'mahasiswa', '235150401111002'],
  ['Dr. Sari Wulandari', 'sari.wulandari@ub.ac.id', 'dosen', '198503152010122001'],
  ['Raka Aditya', 'raka@student.ub.ac.id', 'mahasiswa', '225150200111003'],
  ['Nadia Kusuma', 'nadia@student.ub.ac.id', 'mahasiswa', '225150700111004'],
  ['Bima Saputra', 'bima@student.ub.ac.id', 'mahasiswa', '245150400111005'],
  ['Citra Lestari', 'citra@student.ub.ac.id', 'mahasiswa', '245150401111006'],
  ['Fajar Nugroho', 'fajar@ub.ac.id', 'tendik', '199001012019031007'],
  ['Tamu Fakultas', 'tamu@example.com', 'umum', null],
];

const HOUR_WEIGHTS = [[7, 0.04], [8, 0.08], [9, 0.11], [10, 0.12], [11, 0.2], [12, 0.24], [13, 0.12], [14, 0.06], [15, 0.03]];

function seed({ quiet = false } = {}) {
  const rnd = mulberry32(20261109);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const usedCodes = new Set();
  const code = () => { let c; do { c = randomCode(); } while (usedCodes.has(c)); usedCodes.add(c); return c; };
  const t0 = now();
  const today = wibDate(t0);

  return db.tx(() => {
    const sellerHash = bcrypt.hashSync('penjual123', 8);
    const buyerHash = bcrypt.hashSync('pembeli123', 8);
    const stalls = [];
    for (const s of SELLERS) {
      const uid = db.run(`INSERT INTO users (role, name, email, phone, password_hash, is_verified, created_at) VALUES ('seller', ?, ?, ?, ?, 1, ?)`,
        [s.name, s.email, s.phone, sellerHash, iso(addMinutes(t0, -60 * 24 * 30))]).lastInsertRowid;
      const sid = db.run(`INSERT INTO stalls (owner_id, name, description, location, open_time, close_time, prepay_required, slot_capacity, cover, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [uid, s.stall.name, s.stall.description, s.stall.location, s.stall.open, s.stall.close, s.stall.prepay, s.stall.cap, s.stall.cover, iso()]).lastInsertRowid;
      const menus = s.menus.map(([name, cat, price, prep, stock, img, desc, ingr]) => {
        const id = db.run(`INSERT INTO menus (stall_id, name, description, ingredients, category, price, prep_minutes, daily_stock, stock_left, stock_date, image, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [sid, name, desc, ingr, cat, price, prep, stock, stock, today, `illust:${img}`, iso(), iso()]).lastInsertRowid;
        return { id, name, price, prep, stock };
      });
      stalls.push({ id: sid, owner: uid, prepay: s.stall.prepay, menus, name: s.stall.name });
    }
    const buyers = BUYERS.map(([name, email, type, nid]) => ({
      id: db.run(`INSERT INTO users (role, name, email, buyer_type, identity_number, phone, password_hash, is_verified, created_at) VALUES ('buyer', ?, ?, ?, ?, ?, ?, 1, ?)`,
        [name, email, type, nid, `0812345${String(Math.floor(rnd() * 90000) + 10000)}`, buyerHash, iso(addMinutes(t0, -60 * 24 * 20))]).lastInsertRowid,
      name,
    }));
    const alya = buyers[0];
    const historyBuyers = buyers.slice(1);
    const queueCounter = {};

    function insertOrder(stall, buyer, createdAt, status, opts = {}) {
      const items = [];
      const nItems = opts.items || between(1, 2);
      for (let i = 0; i < nItems; i++) {
        const m = pick(stall.menus);
        if (items.find((x) => x.m.id === m.id)) continue;
        items.push({ m, qty: opts.qty || between(1, 3) });
      }
      const prep = Math.max(...items.map((x) => x.m.prep));
      const total = items.reduce((s, x) => s + x.m.price * x.qty, 0);
      const count = items.reduce((s, x) => s + x.qty, 0);
      const date = wibDate(createdAt);
      const method = stall.prepay ? 'qris' : (rnd() < 0.45 ? 'qris' : 'kasir');
      const queued = ['dibatalkan_awal', 'menunggu_pembayaran'].includes(status) ? null : addMinutes(createdAt, stall.prepay ? between(1, 3) : 0);
      const key = `${stall.id}|${date}`;
      let qn = null;
      if (queued) { queueCounter[key] = (queueCounter[key] || 0) + 1; qn = queueCounter[key]; }
      const processing = ['diproses', 'siap_diambil', 'selesai', 'tidak_diambil'].includes(status) ? addMinutes(queued, opts.wait ?? between(1, 6)) : null;
      const ready = ['siap_diambil', 'selesai', 'tidak_diambil'].includes(status) ? addMinutes(processing, prep + between(0, 2)) : null;
      const completed = status === 'selesai' ? addMinutes(ready, between(1, 8)) : null;
      const finalStatus = status === 'dibatalkan_awal' ? 'dibatalkan' : status;
      const paid = Boolean(queued) || opts.paid;
      const id = db.run(`INSERT INTO orders (code, checkout_id, user_id, stall_id, status, queue_number, queue_date, pickup_type, target_ready_at, payment_method,
          payment_status, payment_ref, payment_deadline, total, item_count, prep_minutes, order_date, created_at, paid_at, queued_at, processing_at, ready_at, completed_at,
          cancelled_at, cancelled_by, cancel_reason, code_used_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'asap', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code(), `seed-${stall.id}-${createdAt.getTime()}`, buyer.id, stall.id, finalStatus, qn, queued ? date : null,
        queued ? iso(addMinutes(queued, prep)) : null, method,
        opts.paymentStatus || (paid ? 'lunas' : 'belum_bayar'), opts.paymentRef || (paid && method === 'qris' ? `QR${between(100000, 999999)}` : null),
        stall.prepay ? iso(addMinutes(createdAt, 15)) : null, total, count, prep, date, iso(createdAt),
        paid ? iso(queued || createdAt) : null, queued ? iso(queued) : null, processing ? iso(processing) : null, ready ? iso(ready) : null,
        completed ? iso(completed) : null, finalStatus === 'dibatalkan' || finalStatus === 'tidak_diambil' ? iso(addMinutes(createdAt, 20)) : null,
        finalStatus === 'dibatalkan' ? 'pembeli' : finalStatus === 'tidak_diambil' ? 'penjual' : null,
        finalStatus === 'dibatalkan' ? 'Jadwal kelas berubah' : finalStatus === 'tidak_diambil' ? 'Tidak diambil' : null,
        completed ? iso(completed) : null]).lastInsertRowid;
      for (const x of items) {
        db.run('INSERT INTO order_items (order_id, menu_id, name, price, qty, note, recipient, prep_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [id, x.m.id, x.m.name, x.m.price, x.qty, opts.note || null, opts.recipient || null, x.m.prep]);
        if (date === today && finalStatus !== 'dibatalkan') db.run('UPDATE menus SET stock_left = MAX(0, stock_left - ?) WHERE id = ?', [x.qty, x.m.id]);
      }
      return id;
    }

    function randomTime(dateStr) {
      let r = rnd();
      let hour = 12;
      for (const [h, w] of HOUR_WEIGHTS) { if (r < w) { hour = h; break; } r -= w; }
      return addMinutes(fromWib(dateStr, `${String(hour).padStart(2, '0')}:00`), between(0, 59));
    }

    // Riwayat 7 hari terakhir.
    const volume = [[18, 28], [6, 10], [8, 14]];
    for (let d = 7; d >= 1; d--) {
      const dateStr = wibDate(addMinutes(t0, -d * 1440));
      stalls.forEach((stall, idx) => {
        const n = between(...volume[idx]);
        const times = Array.from({ length: n }, () => randomTime(dateStr)).sort((a, b) => a - b);
        for (const t of times) {
          const r = rnd();
          insertOrder(stall, pick(historyBuyers), t, r < 0.05 ? 'dibatalkan_awal' : r < 0.08 ? 'tidak_diambil' : 'selesai');
        }
      });
    }

    // Hari ini: pesanan selesai beberapa jam terakhir (bila jam sekarang sudah lewat jam buka).
    const open = fromWib(today, '07:00');
    const windowStart = Math.max(open.getTime(), t0.getTime() - 4 * 3600000);
    const windowEnd = t0.getTime() - 30 * 60000;
    stalls.forEach((stall, idx) => {
      if (windowEnd <= windowStart) return;
      const n = [9, 3, 4][idx];
      const times = Array.from({ length: n }, () => new Date(windowStart + rnd() * (windowEnd - windowStart))).sort((a, b) => a - b);
      for (const t of times) insertOrder(stall, pick(historyBuyers), t, 'selesai');
    });
    if (windowEnd > windowStart) insertOrder(stalls[0], alya, new Date(windowEnd - 20 * 60000), 'selesai', { items: 1, qty: 1 });

    // Pesanan aktif untuk demo papan pesanan.
    const [mimin, cnc] = stalls;
    const [, dimas, , raka, nadia, bima, citra, fajar] = buyers;
    insertOrder(mimin, fajar, addMinutes(t0, -14), 'siap_diambil', { wait: 1, recipient: 'Pak Andi' });
    insertOrder(mimin, bima, addMinutes(t0, -6), 'diproses', { wait: 1 });
    insertOrder(mimin, raka, addMinutes(t0, -4), 'dalam_antrean', { note: 'Sambal dipisah' });
    insertOrder(mimin, nadia, addMinutes(t0, -3), 'dalam_antrean', { items: 2, qty: 2, recipient: 'Titipan Rani' });
    insertOrder(mimin, citra, addMinutes(t0, -1), 'dalam_antrean');
    insertOrder(cnc, raka, addMinutes(t0, -8), 'dalam_antrean');
    insertOrder(cnc, citra, addMinutes(t0, -2), 'menunggu_pembayaran', { paymentStatus: 'menunggu_verifikasi', paymentRef: 'QR204611' });

    // Satu pelanggaran lama untuk akun Dimas (contoh status peringatan).
    db.run(`INSERT INTO violations (user_id, reason, created_at) VALUES (?, 'tidak_diambil', ?)`, [dimas.id, iso(addMinutes(t0, -2 * 1440))]);

    // Favorit dan notifikasi sambutan untuk Alya.
    db.run('INSERT INTO favorites (user_id, menu_id, created_at) VALUES (?, ?, ?)', [alya.id, mimin.menus[0].id, iso()]);
    db.run('INSERT INTO favorites (user_id, menu_id, created_at) VALUES (?, ?, ?)', [alya.id, cnc.menus[0].id, iso()]);
    db.run(`INSERT INTO notifications (user_id, type, title, body, created_at) VALUES (?, 'info', 'Selamat datang di Pickabite', 'Pesan menu kantin FILKOM, pilih jam ambil, lalu ambil dengan kode unik.', ?)`, [alya.id, iso(addMinutes(t0, -60))]);

    if (!quiet) console.log(`[seed] ${stalls.length} stan, ${buyers.length} pembeli, data 7 hari terakhir dibuat.`);
    return { stalls: stalls.length, buyers: buyers.length };
  });
}

function seedIfEmpty() {
  const n = db.get('SELECT COUNT(*) AS n FROM users').n;
  if (n === 0) return seed();
  return null;
}

const DEMO_ACCOUNTS = [
  { peran: 'Pembeli (mahasiswa)', login: '235150400111001 atau alya@student.ub.ac.id', password: 'pembeli123' },
  { peran: 'Pembeli (dosen)', login: 'sari.wulandari@ub.ac.id', password: 'pembeli123' },
  { peran: 'Penjual (Warung Bu Mimin)', login: 'mimin@pickabite.id', password: 'penjual123' },
  { peran: 'Penjual (CNC Dimsum Gyoza)', login: 'cnc@pickabite.id', password: 'penjual123' },
];

module.exports = { seed, seedIfEmpty, DEMO_ACCOUNTS };
