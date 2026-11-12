// Halaman penjual: dashboard, papan pesanan, kelola menu, laporan, pengaturan stan.
import { api } from '../api.js';
import { icon } from '../icons.js';
import {
  $, $$, esc, rupiah, fmtTime, fmtDate, fmtShortDate, fmtDateTime, relTime, foodImg, foodSrc, statusPill, payPill, toast, modal,
  confirmDialog, formValues, showFieldError, withBusy, debounce, emptyState, BUYER_TYPES,
} from '../ui.js';
import { state, navigate, refreshMe, logout } from '../app.js';
import { renderNotifications, passwordModal } from './buyer.js';

/* ------------------------------ Grafik SVG ------------------------------ */
function barChart(rows, { height = 200, fmt = (v) => v, highlight = -1 } = {}) {
  const w = 560; const h = height; const pad = { l: 8, r: 8, t: 22, b: 26 };
  const max = Math.max(1, ...rows.map((r) => r.value));
  const bw = (w - pad.l - pad.r) / rows.length;
  const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - v / max);
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Grafik batang">
    ${[0.25, 0.5, 0.75].map((f) => `<line class="grid" x1="${pad.l}" x2="${w - pad.r}" y1="${y(max * f)}" y2="${y(max * f)}"/>`).join('')}
    ${rows.map((r, i) => {
      const x = pad.l + i * bw + bw * 0.18; const bh = h - pad.b - y(r.value);
      return `<g><title>${esc(r.label)}: ${esc(fmt(r.value))}</title><rect class="bar ${i === highlight ? 'hl' : ''}" x="${x}" y="${y(r.value)}" width="${bw * 0.64}" height="${Math.max(bh, r.value ? 2 : 0)}" rx="6"/>
        ${r.value ? `<text class="val" x="${x + bw * 0.32}" y="${y(r.value) - 6}" text-anchor="middle">${esc(r.short ?? fmt(r.value))}</text>` : ''}
        <text x="${x + bw * 0.32}" y="${h - 8}" text-anchor="middle">${esc(r.label)}</text></g>`;
    }).join('')}</svg>`;
}
const shortRp = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} jt` : n >= 1000 ? `${Math.round(n / 1000)} rb` : String(n));

/* ------------------------------ Dashboard ------------------------------ */
export async function dashboard(ctx) {
  const { view } = ctx;
  async function paint() {
    const d = await api('/seller/dashboard');
    const { orders: active } = await api('/seller/orders?status=active');
    const delta = d.revenue_yesterday ? Math.round(((d.revenue_today - d.revenue_yesterday) / d.revenue_yesterday) * 100) : null;
    const maxTop = Math.max(1, ...d.top_menus.map((m) => m.qty));
    const stall = state.stall;
    view.innerHTML = `<div class="row wrap" style="justify-content:space-between;margin:8px 0 16px;gap:10px">
        <div><span class="muted small">${esc(fmtDate(new Date()))}</span><h1>Dashboard ${esc(stall.name)}</h1></div>
        <div class="row wrap"><span class="pill ${stall.is_open && stall.accepting_orders ? 'pill-green' : 'pill-red'}">${stall.is_open ? (stall.accepting_orders ? 'Menerima pesanan' : 'Jeda pesanan online') : 'Stan tutup'}</span>
        <a href="/penjual/pesanan" class="btn btn-primary btn-sm">${icon('receipt')}Buka papan pesanan</a></div></div>
      <div class="kpi-grid">
        <div class="card kpi primary"><span class="kpi-label">${icon('wallet')}Pendapatan hari ini</span><span class="kpi-value">${rupiah(d.revenue_today)}</span>
          <span class="delta">${delta === null ? 'Belum ada data kemarin' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% dari kemarin`}</span></div>
        <div class="card kpi"><span class="kpi-label">${icon('utensils')}Porsi terjual</span><span class="kpi-value">${d.portions_today}</span><span class="tiny muted">${d.completed_today} pesanan selesai</span></div>
        <div class="card kpi"><span class="kpi-label">${icon('flame')}Sedang diproses</span><span class="kpi-value">${d.processing}</span><span class="tiny muted">${d.in_queue} antre · ${d.cooking} dimasak</span></div>
        <div class="card kpi"><span class="kpi-label">${icon('check')}Siap diambil</span><span class="kpi-value">${d.ready}</span><span class="tiny muted">menunggu pembeli</span></div>
        <div class="card kpi"><span class="kpi-label">${icon('qr')}Menunggu bayar</span><span class="kpi-value">${d.awaiting_payment}</span><span class="tiny muted">perlu verifikasi QRIS</span></div>
        <div class="card kpi"><span class="kpi-label">${icon('clock')}Rata-rata siap</span><span class="kpi-value">${d.avg_prep_minutes === null ? '–' : d.avg_prep_minutes.toLocaleString('id-ID')}<small class="small muted"> mnt</small></span><span class="tiny muted">${d.cancelled_today} batal · ${d.no_show_today} tidak diambil</span></div>
      </div>
      <div class="dash-grid" style="margin-top:18px">
        <div style="display:grid;gap:18px">
          <section class="card chart-card"><div class="section-head"><h2>Pendapatan 7 hari</h2><span class="small muted">${rupiah(d.revenue_7d.reduce((s, r) => s + r.revenue, 0))}</span></div>
            ${barChart(d.revenue_7d.map((r) => ({ label: fmtShortDate(`${r.date}T12:00:00+07:00`), value: r.revenue, short: shortRp(r.revenue) })), { fmt: rupiah, highlight: 6 })}</section>
          <section class="card chart-card"><div class="section-head"><h2>Jam ramai</h2><span class="small muted">${d.peak_hour !== null ? `Puncak ${String(d.peak_hour).padStart(2, '0')}.00–${String(d.peak_hour + 1).padStart(2, '0')}.00` : 'Belum ada data'}</span></div>
            ${barChart(d.hourly_7d.map((r) => ({ label: String(r.hour).padStart(2, '0'), value: r.orders, short: String(r.orders) })), { fmt: (v) => `${v} pesanan`, highlight: d.hourly_7d.findIndex((r) => r.hour === d.peak_hour) })}
            <p class="tiny muted">Jumlah pesanan per jam selama 7 hari terakhir. Gunakan untuk menyiapkan stok sebelum jam puncak.</p></section>
        </div>
        <div style="display:grid;gap:18px;align-content:start">
          <section class="card chart-card"><div class="section-head"><h2>Antrean saat ini</h2><a href="/penjual/pesanan">Kelola</a></div>
            ${active.length ? active.slice(0, 6).map((o) => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--line)"><b class="serif" style="width:44px;font-size:18px">${o.queue_number ? `#${o.queue_number}` : '–'}</b>
              <div class="grow"><span class="mono small"><b>${esc(o.code)}</b></span> <span class="small muted">· ${esc(o.buyer.name)}</span><br><span class="tiny muted">${o.item_count} porsi · ${o.pickup_type === 'slot' ? `jam ${fmtTime(o.pickup_time)}` : 'secepatnya'}</span></div>${statusPill(o)}</div>`).join('') : '<p class="muted small">Tidak ada pesanan aktif.</p>'}</section>
          <section class="card chart-card"><div class="section-head"><h2>Menu terlaris</h2><span class="small muted">7 hari</span></div>
            <div class="hbar">${d.top_menus.length ? d.top_menus.map((m) => `<div class="hbar-row"><span>${esc(m.name)}</span><b>${m.qty} porsi</b><div class="track"><i style="width:${(m.qty / maxTop) * 100}%"></i></div></div>`).join('') : '<p class="muted small">Belum ada penjualan.</p>'}</div></section>
          <section class="card chart-card"><div class="section-head"><h2>Stok menipis</h2><a href="/penjual/menu">Atur stok</a></div>
            ${d.low_stock.length ? d.low_stock.map((m) => `<div class="row" style="justify-content:space-between;padding:6px 0"><span class="small">${esc(m.name)}</span><span class="pill ${m.stock_left ? 'pill-amber' : 'pill-red'}">${m.stock_left ? `sisa ${m.stock_left}` : 'habis'}</span></div>`).join('') : '<p class="muted small">Semua stok aman.</p>'}</section>
        </div></div>`;
  }
  await paint();
  const refresh = debounce(paint, 500);
  ctx.onEvent = (type) => { if (type === 'order' || type === 'stall') refresh(); };
}

/* ------------------------------ Papan pesanan ------------------------------ */
const COLUMNS = [
  ['menunggu_pembayaran', 'Menunggu Bayar'],
  ['dalam_antrean', 'Dalam Antrean'],
  ['diproses', 'Diproses'],
  ['siap_diambil', 'Siap Diambil'],
];

function sellerCard(o) {
  const canNoShow = o.no_show_allowed_at && new Date(o.no_show_allowed_at) <= new Date();
  const actions = [];
  if (o.payment_status === 'menunggu_verifikasi') {
    actions.push(`<button class="btn btn-success btn-sm" data-act="verify-payment" data-id="${o.id}">${icon('check')}Verifikasi bayar</button>`);
    actions.push(`<button class="btn btn-ghost btn-sm" data-act="reject-payment" data-id="${o.id}">Tolak bukti</button>`);
  } else if (o.status === 'menunggu_pembayaran' || (o.payment_status === 'belum_bayar' && o.status !== 'siap_diambil')) {
    actions.push(`<button class="btn btn-ghost btn-sm" data-act="verify-payment" data-id="${o.id}">${icon('wallet')}Tandai lunas</button>`);
  }
  if (o.status === 'dalam_antrean') actions.push(`<button class="btn btn-primary btn-sm" data-act="process" data-id="${o.id}">${icon('flame')}Mulai buat</button>`);
  if (o.status === 'dalam_antrean' || o.status === 'diproses') actions.push(`<button class="btn ${o.status === 'diproses' ? 'btn-success' : 'btn-ghost'} btn-sm" data-act="ready" data-id="${o.id}">${icon('bell')}Siap diambil</button>`);
  if (o.status === 'siap_diambil') {
    actions.push(`<button class="btn btn-success btn-sm" data-handover="${esc(o.code)}">${icon('ticket')}Serahkan</button>`);
    actions.push(`<button class="btn btn-ghost btn-sm" data-act="no-show" data-id="${o.id}" ${canNoShow ? '' : 'disabled'} title="${canNoShow ? '' : `Aktif mulai ${fmtTime(o.no_show_allowed_at)}`}">Tidak diambil${canNoShow ? '' : ` (${fmtTime(o.no_show_allowed_at)})`}</button>`);
  }
  if (o.payment_status !== 'lunas' && ['menunggu_pembayaran', 'dalam_antrean', 'diproses'].includes(o.status)) actions.push(`<button class="btn btn-ghost btn-sm" data-act="cancel" data-id="${o.id}" aria-label="Batalkan pesanan ${esc(o.code)}">${icon('x')}</button>`);
  return `<article class="card ocard s-${o.status}">
    <div class="row" style="align-items:flex-start"><div class="qno">${o.queue_number ? `#${o.queue_number}` : '–'}<small>antrean</small></div>
      <div class="grow"><span class="mono" style="font-weight:700;font-size:15px">${esc(o.code)}</span><br><span class="small">${esc(o.buyer.name)}</span> <span class="tiny muted">· ${esc(BUYER_TYPES[o.buyer.buyer_type] || '')}</span></div>
      <div style="text-align:right"><span class="pill ${o.pickup_type === 'slot' ? 'pill-violet' : 'pill-gray'}">${icon('clock')}${o.pickup_type === 'slot' ? fmtTime(o.pickup_time) : 'Secepatnya'}</span><br><span class="tiny muted">${esc(relTime(o.created_at))}</span></div></div>
    <ul>${o.items.map((i) => `<li><b>${i.qty}×</b><span>${esc(i.name)}${i.recipient ? `<br><span class="recipient">untuk ${esc(i.recipient)}</span>` : ''}${i.note ? `<br><span class="note">${esc(i.note)}</span>` : ''}</span></li>`).join('')}</ul>
    ${o.note ? `<div class="note">Catatan: ${esc(o.note)}</div>` : ''}
    <div class="row wrap" style="gap:6px">${payPill(o)}<b class="small" style="margin-left:auto">${rupiah(o.total)}</b></div>
    ${o.payment_ref || o.payment_proof ? `<div class="tiny muted">Ref: ${esc(o.payment_ref || '-')}${o.payment_proof ? ` · <a class="link" href="/api/files/proof/${o.id}" target="_blank" rel="noopener">lihat bukti</a>` : ''}</div>` : ''}
    ${o.queue && o.status === 'dalam_antrean' ? `<div class="tiny muted">Target siap ${fmtTime(o.target_ready_at)}</div>` : ''}
    <div class="actions">${actions.join('')}</div></article>`;
}

export async function orders(ctx) {
  const { view } = ctx;
  let tab = 'dalam_antrean';
  let list = [];
  let showHistory = false;
  async function load() {
    list = (await api(`/seller/orders?status=${showHistory ? 'history' : 'active'}`)).orders;
  }
  function paint() {
    const counts = Object.fromEntries(COLUMNS.map(([k]) => [k, list.filter((o) => o.status === k).length]));
    view.innerHTML = `<div class="row wrap" style="justify-content:space-between;margin:8px 0 14px"><h1>Papan Pesanan</h1>
        <div class="segmented" style="min-width:240px"><button class="${!showHistory ? 'active' : ''}" data-hist="0">Aktif</button><button class="${showHistory ? 'active' : ''}" data-hist="1">Selesai hari ini</button></div></div>
      <form class="card verify-bar" id="verify-form"><span class="desktop-only">${icon('ticket')}</span><input class="input" name="code" maxlength="7" placeholder="Kode, mis. KTB482" aria-label="Kode pengambilan" autocomplete="off"><button class="btn btn-primary">Cek kode</button></form>
      ${showHistory ? (list.length ? `<div class="menu-admin">${list.map((o) => `<div class="card ocard"><div class="row" style="justify-content:space-between"><span class="mono"><b>${esc(o.code)}</b> · #${o.queue_number || '-'}</span>${statusPill(o)}</div><span class="small">${esc(o.buyer.name)} · ${o.item_count} porsi · ${rupiah(o.total)}</span><span class="tiny muted">${esc(fmtDateTime(o.completed_at || o.cancelled_at))}${o.cancel_reason ? ` · ${esc(o.cancel_reason)}` : ''}</span></div>`).join('')}</div>` : emptyState('Belum ada pesanan selesai', 'Pesanan selesai, batal, dan tidak diambil hari ini muncul di sini.'))
      : `<div class="board-tabs mobile-only">${COLUMNS.map(([k, l]) => `<button class="${tab === k ? 'active' : ''}" data-tab="${k}">${l}<span class="count">${counts[k]}</span></button>`).join('')}</div>
      <div class="board">${COLUMNS.map(([k, l]) => `<section class="board-col ${tab === k ? '' : 'hidden-mobile'}"><h3>${l}<span class="pill pill-gray">${counts[k]}</span></h3>
        ${list.filter((o) => o.status === k).map(sellerCard).join('') || `<div class="col-empty">Tidak ada pesanan</div>`}</section>`).join('')}</div>`}`;
  }
  await load();
  if (!list.some((o) => o.status === tab)) tab = (COLUMNS.find(([k]) => list.some((o) => o.status === k)) || ['dalam_antrean'])[0];
  paint();

  async function handover(code) {
    try {
      const { order: o } = await api('/seller/verify-code', { method: 'POST', body: { code } });
      const unpaid = o.payment_status !== 'lunas';
      const m = modal({ title: `Serah terima ${o.code}`, body: `
        <div class="row" style="margin-bottom:12px"><span class="qno serif" style="font-size:34px">#${o.queue_number || '-'}</span><div class="grow"><b>${esc(o.buyer.name)}</b><br><span class="small muted">${esc(BUYER_TYPES[o.buyer.buyer_type] || '')} · ${esc(o.buyer.identity_number || '')}</span></div>${statusPill(o)}</div>
        <ul style="padding-left:18px;margin:0 0 12px">${o.items.map((i) => `<li>${i.qty}× ${esc(i.name)}${i.recipient ? ` (untuk ${esc(i.recipient)})` : ''}</li>`).join('')}</ul>
        <div class="row" style="justify-content:space-between;margin-bottom:12px">${payPill(o)}<b>${rupiah(o.total)}</b></div>
        ${o.status !== 'siap_diambil' ? `<div class="alert alert-warn">${icon('info')}<span>Pesanan berstatus ${esc(o.status_label)}. Tandai siap diambil dulu sebelum diserahkan.</span></div>`
          : `${unpaid ? `<label class="pay-opt"><input type="checkbox" id="paid-check"><span>Pembeli sudah membayar ${rupiah(o.total)} di kasir</span></label>` : ''}
          <button class="btn btn-success btn-block" style="margin-top:14px" data-done>${icon('check')}Serahkan dan selesaikan</button>`}` });
      const done = m.el.querySelector('[data-done]');
      if (done) done.addEventListener('click', () => withBusy(done, async () => {
        try {
          await api(`/seller/orders/${o.id}/complete`, { method: 'POST', body: { code: o.code, paid: unpaid ? m.el.querySelector('#paid-check').checked : true } });
          m.close();
          toast(`Pesanan ${o.code} selesai. Kode tidak bisa dipakai lagi.`, 'success');
          await load(); paint();
        } catch (err) { toast(err.message, 'error'); }
      }));
    } catch (err) { toast(err.message, 'error'); }
  }

  view.addEventListener('submit', (e) => {
    if (e.target.id !== 'verify-form') return;
    e.preventDefault();
    const code = e.target.code.value.trim();
    if (code) handover(code);
  });
  view.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.tab) { tab = t.dataset.tab; return paint(); }
    if (t.dataset.hist !== undefined) { showHistory = t.dataset.hist === '1'; await load(); return paint(); }
    if (t.dataset.handover) return handover(t.dataset.handover);
    if (!t.dataset.act || t.dataset.pending) return;
    t.dataset.pending = 'true';
    try {
      const id = t.dataset.id;
      let body = {};
      if (t.dataset.act === 'cancel') {
        const reason = await confirmDialog({ title: 'Batalkan pesanan?', message: 'Pembeli akan menerima notifikasi beserta alasan pembatalan.', okText: 'Batalkan pesanan', danger: true, input: { label: 'Alasan', placeholder: 'Contoh: stok habis', value: 'Stok habis', required: true } });
        if (!reason) return;
        body = { reason };
      } else if (t.dataset.act === 'reject-payment') {
        const reason = await confirmDialog({ title: 'Tolak bukti bayar?', message: 'Pembeli diminta mengunggah ulang bukti dalam 10 menit.', okText: 'Tolak', danger: true, input: { label: 'Alasan', value: 'Pembayaran belum masuk di mutasi QRIS.', required: true } });
        if (!reason) return;
        body = { reason };
      } else if (t.dataset.act === 'no-show') {
        if (!(await confirmDialog({ title: 'Tandai tidak diambil?', message: 'Jika pesanan belum lunas, akun pembeli akan menerima pelanggaran.', okText: 'Tandai', danger: true }))) return;
      }
      await withBusy(t, async () => {
        try {
          await api(`/seller/orders/${id}/${t.dataset.act}`, { method: 'POST', body });
          await load(); paint();
        } catch (err) { toast(err.message, 'error'); await load(); paint(); }
      });
    } finally { delete t.dataset.pending; }
  });
  const refresh = debounce(async () => { await load(); paint(); }, 300);
  ctx.onEvent = (type) => { if (type === 'order') refresh(); };
  const tick = setInterval(() => { if (!showHistory && list.some((o) => o.status === 'siap_diambil')) paint(); }, 30000);
  ctx.cleanup = () => clearInterval(tick);
}

/* ------------------------------ Kelola menu ------------------------------ */
export async function menus(ctx) {
  const { view } = ctx;
  let data;
  async function paint() {
    data = await api('/seller/menus');
    view.innerHTML = `<div class="row wrap" style="justify-content:space-between;margin:8px 0 16px"><div><h1>Menu & Stok</h1><span class="small muted">Stok harian kembali penuh otomatis setiap pukul 00.00 WIB.</span></div>
      <button class="btn btn-primary" data-new>${icon('plus')}Tambah menu</button></div>
      ${data.menus.length ? `<div class="menu-admin">${data.menus.map((m) => {
        const pct = m.daily_stock ? Math.round((m.stock_left / m.daily_stock) * 100) : 0;
        return `<article class="card madmin"><div class="thumb">${foodImg(m.image, m.name)}</div>
          <div class="info"><h4>${esc(m.name)}</h4><span class="small muted">${esc(m.category)} · ${rupiah(m.price)} · ±${m.prep_minutes} mnt</span>
            <div class="stock-bar"><i class="${pct <= 20 ? 'low' : ''}" style="width:${pct}%"></i></div><span class="tiny muted">Sisa ${m.stock_left} dari ${m.daily_stock} porsi</span></div>
          <div style="display:grid;gap:8px;justify-items:end">
            <label class="switch" title="Tersedia"><input type="checkbox" data-avail="${m.id}" ${m.is_available ? 'checked' : ''} aria-label="${esc(m.name)} tersedia"><span class="track"></span></label>
            <div class="row" style="gap:4px"><button class="icon-btn flat" data-edit="${m.id}" aria-label="Ubah ${esc(m.name)}">${icon('edit')}</button><button class="icon-btn flat" data-del="${m.id}" aria-label="Hapus ${esc(m.name)}">${icon('trash')}</button></div></div></article>`;
      }).join('')}</div>` : emptyState('Belum ada menu', 'Tambahkan menu pertama agar pembeli bisa memesan.')}`;
  }
  function form(m = null) {
    const illus = m && m.image && m.image.startsWith('illust:') ? m.image.slice(7) : (m ? '' : 'nasi-ayam');
    const md = modal({ title: m ? `Ubah ${m.name}` : 'Tambah menu', wide: true, body: `<form id="menu-form" novalidate>
      <div class="grid-2"><div class="field"><label for="mf-name">Nama menu</label><input class="input" id="mf-name" name="name" value="${esc(m?.name || '')}" required></div>
      <div class="field"><label for="mf-cat">Kategori</label><select class="select" id="mf-cat" name="category">${data.categories.map((c) => `<option ${m?.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div></div>
      <div class="grid-2"><div class="field"><label for="mf-price">Harga (Rp)</label><input class="input" id="mf-price" name="price" type="number" min="0" step="500" value="${m?.price ?? ''}" required></div>
      <div class="field"><label for="mf-prep">Waktu siap (menit)</label><input class="input" id="mf-prep" name="prep_minutes" type="number" min="1" max="120" value="${m?.prep_minutes ?? 5}"></div></div>
      <div class="grid-2"><div class="field"><label for="mf-daily">Stok harian</label><input class="input" id="mf-daily" name="daily_stock" type="number" min="0" value="${m?.daily_stock ?? 20}"></div>
      <div class="field"><label for="mf-left">Sisa stok hari ini</label><input class="input" id="mf-left" name="stock_left" type="number" min="0" value="${m?.stock_left ?? ''}" placeholder="Sama dengan stok harian"></div></div>
      <div class="field"><label for="mf-desc">Deskripsi</label><textarea class="textarea" id="mf-desc" name="description" maxlength="300">${esc(m?.description || '')}</textarea></div>
      <div class="field"><label for="mf-ingr">Komposisi (pisahkan dengan koma)</label><input class="input" id="mf-ingr" name="ingredients" value="${esc(m?.ingredients || '')}" placeholder="Nasi, Ayam, Sambal"></div>
      <div class="field"><label>Ilustrasi</label><div class="illus-pick">${data.illustrations.map((k) => `<button type="button" class="${illus === k ? 'active' : ''}" data-illus="${k}" aria-label="${k}"><img src="/img/food/${k}.svg" alt=""></button>`).join('')}</div>
        <input type="hidden" name="illustration" value="${esc(illus)}"></div>
      <div class="field"><label for="mf-img">Atau unggah foto (JPG/PNG/WEBP, maks. 2 MB)</label><input class="input" id="mf-img" name="image" type="file" accept="image/png,image/jpeg,image/webp">
        ${m && !m.image.startsWith('illust:') ? `<span class="hint">Foto saat ini: <a class="link" href="${esc(foodSrc(m.image))}" target="_blank" rel="noopener">lihat</a></span>` : ''}</div>
      <button class="btn btn-primary btn-block" type="submit">${m ? 'Simpan perubahan' : 'Tambah menu'}</button></form>` });
    const f = md.el.querySelector('form');
    md.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-illus]');
      if (!b) return;
      $$('[data-illus]', md.el).forEach((x) => x.classList.toggle('active', x === b));
      f.illustration.value = b.dataset.illus;
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      withBusy(f.querySelector('[type=submit]'), async () => {
        const fd = new FormData(f);
        if (!fd.get('image') || !fd.get('image').size) fd.delete('image');
        try {
          await api(m ? `/seller/menus/${m.id}` : '/seller/menus', { method: m ? 'PATCH' : 'POST', form: fd });
          md.close();
          toast(m ? 'Menu diperbarui.' : 'Menu ditambahkan.', 'success');
          paint();
        } catch (err) { showFieldError(f, err); }
      });
    });
  }
  await paint();
  view.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-new')) return form();
    if (t.dataset.edit) return form(data.menus.find((m) => String(m.id) === t.dataset.edit));
    if (t.dataset.del) {
      const m = data.menus.find((x) => String(x.id) === t.dataset.del);
      if (await confirmDialog({ title: `Hapus ${m.name}?`, message: 'Menu tidak tampil lagi untuk pembeli. Riwayat pesanan tetap tersimpan.', okText: 'Hapus', danger: true })) {
        try { await api(`/seller/menus/${m.id}`, { method: 'DELETE' }); toast('Menu dihapus.', 'success'); paint(); } catch (err) { toast(err.message, 'error'); }
      }
    }
  });
  view.addEventListener('change', async (e) => {
    const t = e.target;
    if (!t.dataset.avail) return;
    try {
      await api(`/seller/menus/${t.dataset.avail}/availability`, { method: 'POST', body: { is_available: t.checked } });
      toast(t.checked ? 'Menu dibuka kembali.' : 'Menu ditutup (habis).', 'success');
    } catch (err) { t.checked = !t.checked; toast(err.message, 'error'); }
  });
}

/* ------------------------------ Laporan ------------------------------ */
export async function reports(ctx) {
  const { view } = ctx;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const weekAgo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(Date.now() - 6 * 86400000));
  let from = weekAgo; let to = today;
  async function paint() {
    const r = await api(`/seller/reports?from=${from}&to=${to}`);
    view.innerHTML = `<h1 style="margin:8px 0 16px">Laporan Penjualan</h1>
      <form class="card card-pad row wrap" id="range" style="gap:12px;align-items:flex-end">
        <div class="field" style="margin:0"><label for="from">Dari</label><input class="input" type="date" id="from" name="from" value="${from}" max="${today}"></div>
        <div class="field" style="margin:0"><label for="to">Sampai</label><input class="input" type="date" id="to" name="to" value="${to}" max="${today}"></div>
        <button class="btn btn-primary">Tampilkan</button>
        <a class="btn btn-outline" href="/api/seller/reports.csv?from=${from}&to=${to}" download>${icon('download')}Unduh CSV</a></form>
      <div class="kpi-grid" style="margin-top:16px">
        <div class="card kpi primary"><span class="kpi-label">Pendapatan</span><span class="kpi-value">${rupiah(r.totals.revenue)}</span></div>
        <div class="card kpi"><span class="kpi-label">Porsi terjual</span><span class="kpi-value">${r.totals.portions}</span></div>
        <div class="card kpi"><span class="kpi-label">Pesanan selesai</span><span class="kpi-value">${r.totals.completed}</span></div>
        <div class="card kpi"><span class="kpi-label">Total pesanan</span><span class="kpi-value">${r.totals.orders}</span></div>
        <div class="card kpi"><span class="kpi-label">Dibatalkan</span><span class="kpi-value">${r.totals.cancelled}</span></div>
        <div class="card kpi"><span class="kpi-label">Tidak diambil</span><span class="kpi-value">${r.totals.no_show}</span></div></div>
      <div class="dash-grid" style="margin-top:18px">
        <section class="card chart-card"><h2 style="margin-bottom:10px">Per hari</h2><div class="table-wrap"><table class="table"><thead><tr><th>Tanggal</th><th class="num">Pesanan</th><th class="num">Porsi</th><th class="num">Batal</th><th class="num">Pendapatan</th></tr></thead>
          <tbody>${r.days.map((d) => `<tr><td>${esc(fmtShortDate(`${d.date}T12:00:00+07:00`))}</td><td class="num">${d.completed}/${d.orders}</td><td class="num">${d.portions}</td><td class="num">${d.cancelled + d.no_show}</td><td class="num">${rupiah(d.revenue)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Tidak ada data.</td></tr>'}</tbody></table></div></section>
        <section class="card chart-card"><h2 style="margin-bottom:10px">Per menu</h2><div class="table-wrap"><table class="table"><thead><tr><th>Menu</th><th class="num">Porsi</th><th class="num">Pendapatan</th></tr></thead>
          <tbody>${r.menus.map((m) => `<tr><td>${esc(m.name)}</td><td class="num">${m.qty}</td><td class="num">${rupiah(m.revenue)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Tidak ada data.</td></tr>'}</tbody></table></div></section></div>`;
    $('#range', view).addEventListener('submit', (e) => {
      e.preventDefault();
      from = e.target.from.value; to = e.target.to.value;
      paint().catch((err) => toast(err.message, 'error'));
    });
  }
  await paint();
}

/* ------------------------------ Pengaturan ------------------------------ */
export async function settings(ctx) {
  const { view } = ctx;
  const { stall: s } = await api('/seller/stall');
  view.innerHTML = `<h1 style="margin:8px 0 16px">Pengaturan Stan</h1>
    <form id="stall-form" novalidate style="max-width:820px">
      <section class="card settings-group"><h3>Status operasional</h3>
        <div class="setting-row"><div><b>Stan buka</b><br><span class="small muted">Saat ditutup, pembeli hanya bisa melihat menu.</span></div><label class="switch"><input type="checkbox" name="is_open" ${s.is_open ? 'checked' : ''}><span class="track"></span></label></div>
        <div class="setting-row"><div><b>Terima pesanan online</b><br><span class="small muted">Matikan sementara saat stan sedang penuh pembeli langsung.</span></div><label class="switch"><input type="checkbox" name="accepting_orders" ${s.accepting_orders ? 'checked' : ''}><span class="track"></span></label></div>
        <div class="setting-row"><div><b>Wajib bayar di muka (QRIS)</b><br><span class="small muted">Pesanan masuk antrean setelah pembayaran diverifikasi. Batas bayar 15 menit.</span></div><label class="switch"><input type="checkbox" name="prepay_required" ${s.prepay_required ? 'checked' : ''}><span class="track"></span></label></div>
      </section>
      <section class="card settings-group"><h3>Jam dan kapasitas</h3>
        <div class="grid-2"><div class="field"><label for="open_time">Jam buka</label><input class="input" type="time" id="open_time" name="open_time" value="${esc(s.open_time)}"></div>
        <div class="field"><label for="close_time">Jam tutup</label><input class="input" type="time" id="close_time" name="close_time" value="${esc(s.close_time)}"></div></div>
        <div class="field"><label for="slot_capacity">Kapasitas per slot 15 menit</label><input class="input" type="number" id="slot_capacity" name="slot_capacity" min="1" max="100" value="${s.slot_capacity}"><span class="hint">Jumlah pesanan terjadwal maksimal yang bisa disiapkan dalam satu slot.</span></div>
        ${s.state && s.state.demo_mode ? '<p class="tiny muted">Mode demo aktif (DEMO_MODE=true): jam operasional belum membatasi pesanan. Set DEMO_MODE=false di berkas .env untuk pemakaian nyata.</p>' : ''}
      </section>
      <section class="card settings-group"><h3>Profil stan</h3>
        <div class="field"><label for="name">Nama stan</label><input class="input" id="name" name="name" value="${esc(s.name)}"></div>
        <div class="field"><label for="location">Lokasi</label><input class="input" id="location" name="location" value="${esc(s.location || '')}"></div>
        <div class="field"><label for="description">Deskripsi</label><textarea class="textarea" id="description" name="description" maxlength="200">${esc(s.description || '')}</textarea></div>
        <button class="btn btn-primary" type="submit">Simpan pengaturan</button>
      </section></form>
    <section class="card settings-group" style="max-width:820px"><h3>QRIS stan</h3>
      <div class="row wrap" style="align-items:flex-start;gap:18px">${s.qris_image ? `<img src="${esc(s.qris_image)}" alt="QRIS stan" style="width:160px;border-radius:14px;border:1px solid var(--line)">` : '<div class="thumb" style="width:120px;height:120px">' + icon('qr') + '</div>'}
        <form id="qris-form" class="grow" novalidate><p class="small muted" style="margin-bottom:10px">${s.qris_image ? 'QRIS sudah terpasang.' : 'Belum ada QRIS. Pembeli melihat contoh QRIS demo.'} Unggah gambar QRIS statis dari bank atau penyedia pembayaranmu.</p>
          <input class="input" type="file" name="qris" accept="image/png,image/jpeg,image/webp" aria-label="Gambar QRIS"><button class="btn btn-outline" style="margin-top:10px">${icon('upload')}Unggah QRIS</button></form></div></section>
    <section class="card settings-group" style="max-width:820px"><h3>Akun</h3><p class="small muted">${esc(state.user.name)} · ${esc(state.user.email)}</p>
      <div class="row wrap" style="margin-top:12px"><button class="btn btn-ghost btn-sm" data-pw>${icon('shield')}Ganti password</button><button class="btn btn-danger btn-sm" data-logout>${icon('logout')}Keluar</button></div></section>`;
  const f = $('#stall-form', view);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = formValues(f);
    ['is_open', 'accepting_orders', 'prepay_required'].forEach((k) => { v[k] = f[k].checked; });
    withBusy(f.querySelector('[type=submit]'), async () => {
      try {
        await api('/seller/stall', { method: 'PATCH', body: v });
        await refreshMe();
        document.querySelectorAll('[data-stallname]').forEach((el) => { el.textContent = state.stall.name; });
        const t = document.querySelector('[data-open-toggle]');
        if (t) { t.checked = Boolean(state.stall.is_open); document.querySelector('[data-open-label]').textContent = state.stall.is_open ? 'Buka' : 'Tutup'; }
        toast('Pengaturan stan disimpan.', 'success');
      } catch (err) { showFieldError(f, err); }
    });
  });
  $('#qris-form', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (!fd.get('qris') || !fd.get('qris').size) return toast('Pilih gambar QRIS terlebih dahulu.', 'error');
    try { await api('/seller/stall/qris', { method: 'POST', form: fd }); toast('QRIS diperbarui.', 'success'); settings(ctx); } catch (err) { toast(err.message, 'error'); }
  });
  $('[data-logout]', view).addEventListener('click', logout);
  $('[data-pw]', view).addEventListener('click', passwordModal);
  ctx.onEvent = (type, data) => { if (type === 'stall') f.is_open.checked = Boolean(data.is_open); };
}

export const notifications = (ctx) => renderNotifications(ctx, () => '/penjual/pesanan');
