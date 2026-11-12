// Halaman pembeli: beranda, stan, detail menu, keranjang, pesanan, notifikasi, profil.
import { api } from '../api.js';
import { icon } from '../icons.js';
import {
  $, $$, esc, rupiah, fmtTime, fmtDateTime, relTime, minutesUntil, initials, foodImg, statusPill, payPill, toast, modal,
  confirmDialog, formValues, showFieldError, withBusy, debounce, emptyState, CATEGORY_IMG,
} from '../ui.js';
import { state, navigate, refreshMe, updateBadges, logout } from '../app.js';

const CATEGORIES = ['Makanan Berat', 'Mie', 'Camilan', 'Minuman'];

/* ------------------------------ Komponen ------------------------------ */
function menuCard(m) {
  return `<article class="card menu-card">
    <button class="fav-btn ${m.is_favorite ? 'on' : ''}" data-fav="${m.id}" aria-label="${m.is_favorite ? 'Hapus dari favorit' : 'Simpan ke favorit'}" aria-pressed="${m.is_favorite ? 'true' : 'false'}">${icon(m.is_favorite ? 'heartFill' : 'heart')}</button>
    <a href="/app/menu/${m.id}" class="menu-img">${foodImg(m.image, m.name)}</a>
    <a href="/app/menu/${m.id}"><h3>${esc(m.name)}</h3></a>
    <div class="stall-name">${esc(m.stall_name)} · ${icon('clock', 'tiny')} ${m.prep_minutes} mnt</div>
    <div class="price-row"><span class="price">${rupiah(m.price)}</span>
      ${m.sold_out || !m.is_available ? '<span class="pill pill-red">Habis</span>' : `<button class="add-btn" data-add="${m.id}" aria-label="Tambah ${esc(m.name)} ke keranjang">${icon('plus')}</button>`}</div>
    ${m.sold_out || !m.is_available ? '<div class="soldout" aria-hidden="true">Habis</div>' : ''}
  </article>`;
}

function stallCard(s) {
  const open = s.state.accepting;
  return `<a href="/app/stan/${s.id}" class="card stall-card">
    <div class="stall-cover">${foodImg(`illust:${s.cover || 'nasi-ayam'}`, '')}</div>
    <div class="grow"><h3>${esc(s.name)}</h3>
      <div class="small muted">${esc(s.open_time)}–${esc(s.close_time)}</div>
      <div class="stall-meta">
        <span class="pill ${open ? 'pill-green' : 'pill-red'}">${esc(s.state.label)}</span>
        <span class="pill pill-blue">${icon('users')}${s.queue.count} antre · ±${s.queue.wait_minutes} mnt</span>
        ${s.prepay_required ? '<span class="pill pill-amber">Bayar di muka</span>' : ''}
      </div></div></a>`;
}

/** Event bersama: favorit dan tambah cepat ke keranjang. */
function bindMenuActions(view) {
  view.addEventListener('click', async (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      e.preventDefault();
      const on = fav.classList.contains('on');
      try {
        await api(`/favorites/${fav.dataset.fav}`, { method: on ? 'DELETE' : 'POST' });
        $$(`[data-fav="${fav.dataset.fav}"]`, view).forEach((b) => {
          b.classList.toggle('on', !on);
          b.innerHTML = icon(!on ? 'heartFill' : 'heart');
          b.setAttribute('aria-pressed', String(!on));
        });
        toast(on ? 'Dihapus dari favorit.' : 'Disimpan ke favorit.', 'success');
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      e.preventDefault();
      await withBusy(add, async () => {
        try {
          const cart = await api('/cart', { method: 'POST', body: { menu_id: Number(add.dataset.add), qty: 1 } });
          state.me.cart_count = cart.count;
          updateBadges();
          toast('Ditambahkan ke keranjang.', 'success');
        } catch (err) { toast(err.message, 'error'); }
      });
    }
  });
}

function accountAlerts() {
  const out = [];
  if (!state.user.is_verified) out.push(`<div class="alert alert-warn" style="margin-bottom:12px">${icon('shield')}<span>Akunmu belum terverifikasi, jadi belum bisa memesan. <a class="link" href="/verifikasi">Verifikasi sekarang</a></span></div>`);
  const p = state.me.penalty;
  if (p && p.blocked_until) out.push(`<div class="alert alert-error" style="margin-bottom:12px">${icon('alert')}<span>Pemesanan diblokir sementara sampai ${esc(fmtDateTime(p.blocked_until))} WIB karena pelanggaran berulang.</span></div>`);
  return out.join('');
}

/* ------------------------------ Beranda ------------------------------ */
export async function home(ctx) {
  const { view } = ctx;
  let category = '';
  let q = '';
  let data = {};
  async function load() {
    const [s, m, a] = await Promise.all([api('/stalls'), api('/menus?sort=popular'), api('/orders?scope=active')]);
    data = { stalls: s.stalls, menus: m.menus, active: a.orders };
  }
  function banner() {
    const o = data.active[0];
    if (o) {
      const info = o.queue ? `Posisi ${o.queue.position} · estimasi siap ${fmtTime(o.queue.est_ready_at)}` : o.status_label;
      return `<a href="/app/pesanan/${o.id}" class="banner">
        <span class="small" style="opacity:.85">Pesanan aktif di ${esc(o.stall.name)}</span>
        <span class="banner-code">${esc(o.code)}</span>
        <p style="max-width:65%">${esc(info)}</p>
        <span class="btn btn-light">Lihat pesanan ${icon('arrow')}</span>
        <img class="banner-art" src="/img/food/${o.status === 'siap_diambil' ? 'nasi-ayam' : 'dimsum'}.svg" alt=""></a>`;
    }
    return `<div class="banner"><h2>Lapar di sela kelas?</h2><p>Pesan dulu, pilih jam ambil, lalu ambil tanpa antre panjang.</p>
      <a href="#semua-menu" class="btn btn-light" data-scroll>Pesan Sekarang</a><img class="banner-art" src="/img/food/mie-ayam.svg" alt=""></div>`;
  }
  function filtered() {
    const term = q.toLowerCase();
    return data.menus.filter((m) => (!category || m.category === category)
      && (!term || m.name.toLowerCase().includes(term) || m.stall_name.toLowerCase().includes(term)));
  }
  function renderGrid() {
    const list = filtered();
    $('#menu-grid', view).innerHTML = list.length ? list.map(menuCard).join('') : emptyState('Menu tidak ditemukan', 'Coba kata kunci atau kategori lain.');
    $('#menu-count', view).textContent = `${list.length} menu`;
  }
  function paint() {
    const first = state.user.name.split(' ')[0].replace(/^(Dr|Prof)\.?$/i, state.user.name.split(' ')[1] || '');
    const popular = data.menus.filter((m) => m.sold_7d > 0 && !m.sold_out).slice(0, 4);
    view.innerHTML = `${accountAlerts()}
      <div class="hello"><span class="muted small">Halo, ${esc(first)} 👋</span><h1>Mau makan apa hari ini?</h1></div>
      <div class="home-top">
        <div>${banner()}</div>
        <div><div class="search">${icon('search')}<input type="search" id="q" placeholder="Cari menu atau stan" aria-label="Cari menu atau stan" value="${esc(q)}"></div>
          <div class="card card-pad desktop-only"><b>Antrean saat ini</b>
            ${data.stalls.map((s) => `<div class="row" style="justify-content:space-between;margin-top:10px"><span class="small">${esc(s.name)}</span><span class="pill ${s.state.accepting ? 'pill-blue' : 'pill-red'}">${s.state.accepting ? `${s.queue.count} antre · ±${s.queue.wait_minutes} mnt` : esc(s.state.label)}</span></div>`).join('')}
          </div></div>
      </div>
      <div class="chips" role="tablist" aria-label="Kategori" style="margin-top:14px">
        <button class="chip no-img ${!category ? 'active' : ''}" data-cat="">Semua</button>
        ${CATEGORIES.map((c) => `<button class="chip ${category === c ? 'active' : ''}" data-cat="${esc(c)}"><span class="chip-img"><img src="/img/food/${CATEGORY_IMG[c]}.svg" alt=""></span>${esc(c)}</button>`).join('')}
      </div>
      <section class="section"><div class="section-head"><h2>Stan di Kantin FILKOM</h2><span class="small muted">${data.stalls.length} stan</span></div>
        <div class="hscroll">${data.stalls.map(stallCard).join('')}</div></section>
      ${popular.length ? `<section class="section"><div class="section-head"><h2>Menu Populer</h2><span class="small muted">7 hari terakhir</span></div>
        <div class="menu-grid">${popular.map(menuCard).join('')}</div></section>` : ''}
      <section class="section" id="semua-menu"><div class="section-head"><h2>Semua Menu</h2><span class="small muted" id="menu-count"></span></div>
        <div class="menu-grid" id="menu-grid"></div></section>`;
    renderGrid();
    $('#q', view).addEventListener('input', debounce((e) => { q = e.target.value.trim(); renderGrid(); }, 200));
    $$('[data-cat]', view).forEach((b) => b.addEventListener('click', () => {
      category = b.dataset.cat;
      $$('[data-cat]', view).forEach((x) => x.classList.toggle('active', x === b));
      renderGrid();
      $('#semua-menu', view).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    const sc = $('[data-scroll]', view);
    if (sc) sc.addEventListener('click', (e) => { e.preventDefault(); $('#semua-menu', view).scrollIntoView({ behavior: 'smooth' }); });
  }
  await load();
  paint();
  bindMenuActions(view);
  const refresh = debounce(async () => { const y = window.scrollY; await load(); paint(); window.scrollTo(0, y); }, 400);
  ctx.onEvent = (type) => { if (type === 'order' || type === 'queue') refresh(); };
  const poll = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
  ctx.cleanup = () => clearInterval(poll);
}

/* ------------------------------ Stan ------------------------------ */
export async function stall(ctx) {
  const { view, params } = ctx;
  let { stall: s, menus } = await api(`/stalls/${params.id}`);
  let cat = '';
  const cats = CATEGORIES.filter((c) => menus.some((m) => m.category === c));
  function paint() {
    view.innerHTML = `<a href="/app" class="row small muted" style="margin:6px 0 12px">${icon('back')} Kembali</a>
      <section class="stall-hero"><img class="art" src="/img/food/${esc(s.cover || 'nasi-ayam')}.svg" alt="">
        <h1>${esc(s.name)}</h1><p>${esc(s.description || '')}</p>
        <div class="stall-meta" style="margin-top:14px">
          <span class="pill">${esc(s.state.label)}</span><span class="pill">${icon('clock')}${esc(s.open_time)}–${esc(s.close_time)}</span>
          <span class="pill">${icon('users')}${s.queue.count} antre · ±${s.queue.wait_minutes} mnt</span>
          <span class="pill">${s.prepay_required ? 'Wajib bayar di muka (QRIS)' : 'Bayar sebelum masuk antrean'}</span>
        </div></section>
      ${!s.state.accepting ? `<div class="alert alert-warn" style="margin-top:14px">${icon('info')}<span>${esc(s.name)} sedang ${esc(s.state.label.toLowerCase())}. Kamu tetap bisa melihat menu.</span></div>` : ''}
      <div class="chips" style="margin-top:16px"><button class="chip no-img ${!cat ? 'active' : ''}" data-cat="">Semua</button>
        ${cats.map((c) => `<button class="chip ${cat === c ? 'active' : ''}" data-cat="${esc(c)}"><span class="chip-img"><img src="/img/food/${CATEGORY_IMG[c]}.svg" alt=""></span>${esc(c)}</button>`).join('')}</div>
      <div class="menu-grid" style="margin-top:8px">${menus.filter((m) => !cat || m.category === cat).map(menuCard).join('') || emptyState('Belum ada menu', 'Penjual belum menambahkan menu.')}</div>`;
    $$('[data-cat]', view).forEach((b) => b.addEventListener('click', () => { cat = b.dataset.cat; paint(); }));
  }
  paint();
  bindMenuActions(view);
  const refresh = debounce(async () => {
    ({ stall: s, menus } = await api(`/stalls/${params.id}`));
    paint();
  }, 300);
  ctx.onEvent = (type, data) => { if (type === 'queue' && String(data.stall_id) === String(params.id)) refresh(); };
  const poll = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
  ctx.cleanup = () => clearInterval(poll);
}

/* ------------------------------ Detail menu ------------------------------ */
export async function menuDetail(ctx) {
  const { view, params } = ctx;
  const { menu: m, stall: s } = await api(`/menus/${params.id}`);
  let qty = 1;
  const vertical = (m.name.split(' ')[0] || '').slice(0, 6).toUpperCase();
  const canOrder = s.state.accepting && !m.sold_out && m.is_available;
  view.innerHTML = `<article class="detail">
    <div class="detail-left">
      <div class="detail-top"><button class="icon-btn" data-back aria-label="Kembali">${icon('back')}</button>
        <button class="icon-btn fav-btn ${m.is_favorite ? 'on' : ''}" style="position:static" data-fav="${m.id}" aria-label="Favorit" aria-pressed="${m.is_favorite}">${icon(m.is_favorite ? 'heartFill' : 'heart')}</button></div>
      <div class="detail-art"><span class="detail-watermark" aria-hidden="true">${esc(vertical[0] || '')}</span>${foodImg(m.image, m.name)}<span class="detail-vertical" aria-hidden="true">${esc(vertical)}</span></div>
    </div>
    <div class="detail-body">
      <a class="small muted" href="/app/stan/${s.id}">${icon('store', 'tiny')} ${esc(s.name)}</a>
      <h1>${esc(m.name)}</h1>
      <div class="info-pills">
        <span class="pill pill-gray">${icon('clock')}Siap ±${m.prep_minutes} mnt</span>
        <span class="pill ${m.stock_left > 5 ? 'pill-green' : 'pill-red'}">${icon('box')}Sisa ${m.stock_left} porsi</span>
        <span class="pill pill-blue">${icon('users')}${s.queue.count} antre</span>
        <span class="pill pill-gray">${esc(m.category)}</span>
      </div>
      ${m.ingredients ? `<h4>Komposisi</h4><div class="ingr">${m.ingredients.split(',').map((x) => `<span><i></i>${esc(x.trim())}</span>`).join('')}</div>` : ''}
      <h4>Deskripsi</h4><p class="muted">${esc(m.description || 'Belum ada deskripsi.')}</p>
      ${canOrder ? `<h4>Catatan</h4>
        <div class="grid-2"><div class="field"><label for="note">Untuk penjual (opsional)</label><input class="input" id="note" maxlength="120" placeholder="Contoh: sambal dipisah"></div>
        <div class="field"><label for="recipient">Titipan untuk (opsional)</label><input class="input" id="recipient" maxlength="40" placeholder="Nama teman"></div></div>`
        : `<div class="alert alert-warn" style="margin-top:16px">${icon('info')}<span>${!s.state.accepting ? `${esc(s.name)} sedang ${esc(s.state.label.toLowerCase())}.` : 'Menu ini sedang habis.'}</span></div>`}
      <div class="buy-bar">
        <div class="row"><span class="total" data-total>${rupiah(m.price)}</span>
          <div class="stepper"><button data-dec aria-label="Kurangi">−</button><span data-qty aria-live="polite">1</span><button data-inc aria-label="Tambah">+</button></div></div>
        <button class="btn btn-light" data-addcart ${canOrder ? '' : 'disabled'}>Tambah ke Keranjang ${icon('arrow')}</button>
      </div>
    </div></article>`;
  const upd = () => { $('[data-qty]', view).textContent = qty; $('[data-total]', view).textContent = rupiah(qty * m.price); };
  $('[data-dec]', view).addEventListener('click', () => { qty = Math.max(1, qty - 1); upd(); });
  $('[data-inc]', view).addEventListener('click', () => { qty = Math.min(Math.max(1, m.stock_left), qty + 1); upd(); });
  $('[data-back]', view).addEventListener('click', () => (history.length > 1 ? history.back() : navigate('/app')));
  bindMenuActions(view);
  $('[data-addcart]', view).addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    try {
      const cart = await api('/cart', { method: 'POST', body: { menu_id: m.id, qty, note: $('#note', view)?.value, recipient: $('#recipient', view)?.value } });
      state.me.cart_count = cart.count;
      updateBadges();
      toast(`${qty} porsi ${m.name} masuk keranjang.`, 'success');
      navigate('/app/keranjang');
    } catch (err) { toast(err.message, 'error'); }
  }));
}

/* ------------------------------ Keranjang ------------------------------ */
export async function cart(ctx) {
  const { view } = ctx;
  const opts = {};
  let data;
  async function load() {
    data = await api('/cart');
    await Promise.all(data.groups.map(async (g) => {
      const { slots } = await api(`/stalls/${g.stall.id}/slots?prep=${g.prep_minutes}`);
      g.slots = slots;
      const o = opts[g.stall.id] || { pickup_type: 'asap', pickup_time: '', payment_method: g.stall.prepay_required ? 'qris' : 'kasir', note: '' };
      if (o.pickup_time && !slots.some((s) => s.time === o.pickup_time && s.available)) o.pickup_time = '';
      opts[g.stall.id] = o;
    }));
  }
  function groupHtml(g) {
    const o = opts[g.stall.id];
    const sid = g.stall.id;
    return `<section class="card cart-group" data-group="${sid}">
      <div class="cart-group-head"><div class="stall-cover" style="width:46px;height:46px;border-radius:14px">${icon('store')}</div>
        <div class="grow"><h3>${esc(g.stall.name)}</h3><span class="small muted">${g.stall.queue.count} pesanan dalam antrean · ±${g.stall.queue.wait_minutes} mnt</span></div>
        <span class="pill ${g.stall.state.accepting ? 'pill-green' : 'pill-red'}">${esc(g.stall.state.label)}</span></div>
      ${g.items.map((it) => `<div class="cart-item">
        <div class="thumb">${foodImg(it.image, it.name)}</div>
        <div class="grow"><h4>${esc(it.name)}</h4>
          <div class="small muted">${rupiah(it.price)}${it.recipient ? ` · <span style="color:var(--violet)">untuk ${esc(it.recipient)}</span>` : ''}${it.note ? ` · ${esc(it.note)}` : ''}</div>
          ${it.unavailable ? '<span class="pill pill-red" style="margin-top:4px">Stok tidak cukup atau habis</span>' : ''}</div>
        <div class="stepper dark"><button data-dec="${it.id}" data-q="${it.qty}" aria-label="Kurangi">−</button><span>${it.qty}</span><button data-inc="${it.id}" data-q="${it.qty}" aria-label="Tambah">+</button></div>
        <button class="icon-btn flat" data-del="${it.id}" aria-label="Hapus ${esc(it.name)}">${icon('trash')}</button></div>`).join('')}
      <div class="divider"></div>
      <b class="small">Jam ambil</b>
      <div class="segmented" style="margin-top:8px"><button type="button" class="${o.pickup_type === 'asap' ? 'active' : ''}" data-pt="asap" data-sid="${sid}">Secepatnya (±${g.stall.queue.wait_minutes + g.prep_minutes} mnt)</button>
        <button type="button" class="${o.pickup_type === 'slot' ? 'active' : ''}" data-pt="slot" data-sid="${sid}">Pilih jam</button></div>
      ${o.pickup_type === 'slot' ? (g.slots.length ? `<div class="slot-grid">${g.slots.slice(0, 24).map((s) => `<button type="button" class="slot ${o.pickup_time === s.time ? 'active' : ''}" data-slot="${s.time}" data-sid="${sid}" ${s.available ? '' : 'disabled'}>${s.time}<small>${s.available ? `${s.capacity - s.used} sisa` : 'penuh'}</small></button>`).join('')}</div>`
        : '<p class="small muted" style="margin-top:8px">Slot terjadwal tidak tersedia di luar jam operasional. Pilih secepatnya.</p>')
               : ''}
      <b class="small" style="display:block;margin-top:16px">Pembayaran</b>
      <label class="pay-opt"><input type="radio" name="pay-${sid}" value="qris" data-pay data-sid="${sid}" ${o.payment_method === 'qris' ? 'checked' : ''}><span class="grow"><b>QRIS</b><br><span class="small muted">Bayar sekarang lalu unggah bukti${g.stall.prepay_required ? ' dalam 15 menit' : ''}</span></span>${icon('qr')}</label>
      <label class="pay-opt ${g.stall.prepay_required ? 'disabled' : ''}"><input type="radio" name="pay-${sid}" value="kasir" data-pay data-sid="${sid}" ${o.payment_method === 'kasir' ? 'checked' : ''} ${g.stall.prepay_required ? 'disabled' : ''}><span class="grow"><b>Bayar di kasir sebelum masuk antrean</b><br><span class="small muted">${g.stall.prepay_required ? 'Stan ini mewajibkan bayar di muka' : 'Tunai atau QRIS di tempat'}</span></span>${icon('wallet')}</label>
      <div class="field" style="margin:14px 0 0"><label for="note-${sid}">Catatan untuk stan (opsional)</label><input class="input" id="note-${sid}" data-note data-sid="${sid}" maxlength="200" value="${esc(o.note)}" placeholder="Contoh: dibungkus terpisah"></div>
      <div class="row" style="justify-content:space-between;margin-top:14px"><span class="muted small">${g.portions} porsi</span><b>${rupiah(g.subtotal)}</b></div>
    </section>`;
  }
  function paint() {
    if (!data.groups.length) {
      view.innerHTML = `<h1 style="margin:8px 0 16px">Keranjang</h1>${emptyState('Keranjangmu masih kosong', 'Pilih menu dari stan favoritmu, lalu pesan sekaligus.', '<a href="/app" class="btn btn-primary">Lihat menu</a>')}`;
      return;
    }
    const me = state.me;
    const willBe = (me.active_orders || 0) + data.groups.length;
    const blockers = [];
    if (!state.user.is_verified) blockers.push('Verifikasi akun dulu sebelum memesan.');
    if (me.penalty && me.penalty.blocked_until) blockers.push(`Akun diblokir sampai ${fmtDateTime(me.penalty.blocked_until)} WIB.`);
    if (willBe > me.max_active_orders) blockers.push(`Checkout ini membuat ${data.groups.length} pesanan, padahal kamu sudah punya ${me.active_orders} pesanan aktif (maksimal ${me.max_active_orders}).`);
    view.innerHTML = `<div class="row" style="justify-content:space-between;margin:8px 0 16px"><h1>Keranjang</h1><button class="link" data-clear>Kosongkan</button></div>
      <div class="cart-layout"><div>${data.groups.map(groupHtml).join('')}</div>
      <aside class="card summary">
        <div class="total-row"><span class="muted">Total ${data.count} porsi</span><strong>${rupiah(data.total)}</strong></div>
        ${data.groups.length > 1 ? `<div class="alert alert-info" style="margin-bottom:12px">${icon('info')}<span>Pesanan dipecah menjadi ${data.groups.length} pesanan (satu per stan), masing-masing dengan kode unik sendiri.</span></div>` : ''}
        <p class="small muted" style="margin-bottom:12px">Pesanan aktif: ${me.active_orders}/${me.max_active_orders}. Semua pembeli berada di antrean yang sama tanpa jalur prioritas.</p>
        ${blockers.map((b) => `<div class="alert alert-error" style="margin-bottom:10px">${icon('alert')}<span>${esc(b)}</span></div>`).join('')}
        <button class="btn btn-primary btn-block" data-checkout ${blockers.length ? 'disabled' : ''}>Pesan Sekarang ${icon('arrow')}</button>
      </aside></div>`;
  }
  await load();
  paint();
  const reload = async () => { await load(); paint(); state.me.cart_count = data.count; updateBadges(); };
  view.addEventListener('click', async (e) => {
    const t = e.target.closest('button, input');
    if (!t) return;
    try {
      if (t.dataset.inc || t.dataset.dec) {
        const id = t.dataset.inc || t.dataset.dec;
        const q = Number(t.dataset.q) + (t.dataset.inc ? 1 : -1);
        if (q < 1) await api(`/cart/${id}`, { method: 'DELETE' });
        else await api(`/cart/${id}`, { method: 'PATCH', body: { qty: q } });
        await reload();
      } else if (t.dataset.del) {
        await api(`/cart/${t.dataset.del}`, { method: 'DELETE' });
        await reload();
      } else if (t.dataset.pt) {
        opts[t.dataset.sid].pickup_type = t.dataset.pt;
        paint();
      } else if (t.dataset.slot) {
        opts[t.dataset.sid].pickup_time = t.dataset.slot;
        paint();
      } else if (t.hasAttribute('data-pay')) {
        opts[t.dataset.sid].payment_method = t.value;
      } else if (t.hasAttribute('data-clear')) {
        if (await confirmDialog({ title: 'Kosongkan keranjang?', message: 'Semua item di keranjang akan dihapus.', okText: 'Kosongkan', danger: true })) {
          await api('/cart', { method: 'DELETE' });
          await reload();
        }
      } else if (t.hasAttribute('data-checkout')) {
        const groups = data.groups.map((g) => ({ stall_id: g.stall.id, ...opts[g.stall.id] }));
        const missing = groups.find((g) => g.pickup_type === 'slot' && !g.pickup_time);
        if (missing) { toast('Pilih slot jam ambil terlebih dahulu.', 'error'); return; }
        await withBusy(t, async () => {
          const { orders } = await api('/orders/checkout', { method: 'POST', body: { groups } });
          await refreshMe();
          toast(`${orders.length} pesanan dibuat: ${orders.map((o) => o.code).join(', ')}`, 'success', 'Pesanan berhasil');
          navigate(orders.length === 1 ? `/app/pesanan/${orders[0].id}` : '/app/pesanan');
        });
      }
    } catch (err) { toast(err.message, 'error'); if (err.status === 409) reload(); }
  });
  view.addEventListener('input', (e) => { if (e.target.dataset.note !== undefined) opts[e.target.dataset.sid].note = e.target.value; });
}

/* ------------------------------ Daftar pesanan ------------------------------ */
function orderCard(o) {
  return `<a href="/app/pesanan/${o.id}" class="card order-card">
    <div class="row" style="justify-content:space-between"><span class="code">${esc(o.code)}</span>${statusPill(o)}</div>
    <div class="row" style="justify-content:space-between"><span class="small"><b>${esc(o.stall.name)}</b> · ${o.item_count} porsi</span><b>${rupiah(o.total)}</b></div>
    <div class="small muted">${esc(o.items.map((i) => `${i.qty}× ${i.name}`).join(', '))}</div>
    ${o.queue ? `<div class="row small" style="gap:8px"><span class="pill pill-blue">${icon('users')}No. ${o.queue_number} · posisi ${o.queue.position}</span><span class="pill pill-gray">${icon('clock')}Siap ±${fmtTime(o.queue.est_ready_at)}</span></div>` : ''}
    ${o.status === 'menunggu_pembayaran' ? `<span class="pill pill-amber">${o.payment_status === 'menunggu_verifikasi' ? 'Bukti terkirim, menunggu verifikasi' : `Bayar sebelum ${fmtTime(o.payment_deadline)}`}</span>` : ''}
    <div class="row" style="justify-content:space-between"><span class="tiny muted">${esc(fmtDateTime(o.created_at))}</span>
      ${['selesai', 'dibatalkan', 'tidak_diambil'].includes(o.status) ? `<button class="btn btn-outline btn-sm" data-reorder="${o.id}">${icon('repeat')}Pesan lagi</button>` : `<span class="link small">Detail ${icon('chevron', 'tiny')}</span>`}</div>
  </a>`;
}

export async function orders(ctx) {
  const { view, query } = ctx;
  let scope = query.get('tab') === 'riwayat' ? 'history' : 'active';
  async function paint() {
    const { orders: list } = await api(`/orders?scope=${scope}`);
    view.innerHTML = `<h1 style="margin:8px 0 14px">Pesanan Saya</h1>
      <div class="segmented" style="max-width:420px;margin-bottom:16px"><button class="${scope === 'active' ? 'active' : ''}" data-scope="active">Aktif</button><button class="${scope === 'history' ? 'active' : ''}" data-scope="history">Riwayat</button></div>
      ${list.length ? `<div class="orders-layout">${list.map(orderCard).join('')}</div>` : emptyState(scope === 'active' ? 'Belum ada pesanan aktif' : 'Riwayat masih kosong', scope === 'active' ? 'Pesanan yang sedang berjalan akan muncul di sini.' : 'Pesanan yang selesai atau batal tercatat di sini.', '<a href="/app" class="btn btn-primary">Pesan menu</a>')}`;
  }
  await paint();
  view.addEventListener('click', async (e) => {
    const s = e.target.closest('[data-scope]');
    if (s) { scope = s.dataset.scope; history.replaceState({}, '', scope === 'history' ? '/app/pesanan?tab=riwayat' : '/app/pesanan'); return paint(); }
    const r = e.target.closest('[data-reorder]');
    if (r) {
      e.preventDefault();
      e.stopPropagation();
      await withBusy(r, async () => {
        try {
          const res = await api(`/orders/${r.dataset.reorder}/reorder`, { method: 'POST' });
          state.me.cart_count = res.cart.count;
          updateBadges();
          if (res.added.length) toast(`${res.added.join(', ')} masuk keranjang.${res.skipped.length ? ` ${res.skipped.join(', ')} sedang habis.` : ''}`, 'success');
          else toast('Menu pada pesanan ini sedang habis.', 'error');
          if (res.added.length) navigate('/app/keranjang');
        } catch (err) { toast(err.message, 'error'); }
      });
    }
  });
  ctx.onEvent = (type) => { if (type === 'order' || type === 'queue') paint(); };
}

/* ------------------------------ Detail pesanan ------------------------------ */
export async function orderDetail(ctx) {
  const { view, params } = ctx;
  let timer = null;
  async function paint() {
    const { order: o } = await api(`/orders/${params.id}`);
    const failed = ['dibatalkan', 'tidak_diambil'].includes(o.status);
    const steps = [
      ['Pesanan dibuat', o.created_at, true],
      ...(o.payment_method === 'qris' ? [[o.payment_status === 'lunas' ? 'Pembayaran terverifikasi' : o.payment_status === 'menunggu_verifikasi' ? 'Bukti bayar menunggu verifikasi' : 'Menunggu pembayaran QRIS', o.paid_at, o.payment_status === 'lunas']] : []),
      [`Masuk antrean${o.queue_number ? ` (No. ${o.queue_number})` : ''}`, o.queued_at, Boolean(o.queued_at)],
      ['Sedang dibuat', o.processing_at, Boolean(o.processing_at)],
      ['Siap diambil', o.ready_at, Boolean(o.ready_at)],
      ['Selesai diambil', o.completed_at, Boolean(o.completed_at)],
    ];
    const currentIdx = failed ? -1 : steps.findIndex((s) => !s[2]);
    const showPay = o.payment_method === 'qris' && o.payment_status === 'belum_bayar' && !failed && o.status !== 'selesai';
    view.innerHTML = `<a href="/app/pesanan" class="row small muted" style="margin:6px 0 12px">${icon('back')} Pesanan saya</a>
    ${o.payment_rejection_reason && o.payment_status === 'belum_bayar' ? `<div class="alert alert-error" style="margin-bottom:14px">${icon('alert')}<span><b>Bukti pembayaran ditolak.</b> ${esc(o.payment_rejection_reason)} Unggah bukti pembayaran baru dalam 10 menit.</span></div>` : ''}
    <div class="order-detail">
      <div>
        <section class="ticket">
          <div class="row" style="justify-content:space-between;align-items:flex-start">
            <div><span class="small" style="opacity:.8">Kode pengambilan</span><div class="ticket-code" aria-label="Kode ${esc(o.code.split('').join(' '))}">${esc(o.code)}</div>
              <span class="small" style="opacity:.85">${esc(o.stall.name)}</span></div>
            <div class="qr"><img src="${o.qr}" alt="QR kode pesanan ${esc(o.code)}"></div></div>
          <div class="sep"></div>
          <div class="row" style="justify-content:space-between">
            <div><span class="small" style="opacity:.8">Nomor antrean</span><div class="queue-no">${o.queue_number ? `#${o.queue_number}` : '–'}</div></div>
            <div style="text-align:right"><span class="pill" style="background:rgba(255,255,255,.2);color:#fff">${esc(o.status_label)}</span>
              <div class="small" style="opacity:.85;margin-top:6px">${o.pickup_type === 'slot' ? `Ambil jam ${fmtTime(o.pickup_time)}` : 'Ambil secepatnya'}</div></div></div>
          <p class="tiny" style="opacity:.75;margin-top:14px">Tunjukkan kode atau QR ini ke penjual. Kode hanya berlaku sekali.</p>
        </section>
        ${o.queue ? `<section class="card card-pad" style="margin-top:14px"><b>Posisi antrean</b>
          <div class="queue-box" style="margin-top:10px"><div class="stat"><b>${o.queue.ahead}</b><span class="small muted">pesanan di depanmu</span></div>
          <div class="stat"><b>${fmtTime(o.queue.est_ready_at)}</b><span class="small muted">estimasi siap (±${minutesUntil(o.queue.est_ready_at)} mnt)</span></div></div>
          <p class="tiny muted" style="margin-top:8px">Diperbarui otomatis. Antrean berlaku sama untuk semua pembeli.</p></section>` : ''}
        ${o.status === 'siap_diambil' ? `<div class="alert alert-success" style="margin-top:14px">${icon('check')}<span><b>Pesanan siap diambil!</b> Datang ke ${esc(o.stall.name)} dan tunjukkan kode ${esc(o.code)}.${o.payment_status !== 'lunas' ? ` Siapkan pembayaran ${rupiah(o.total)}.` : ''}</span></div>` : ''}
        ${failed ? `<div class="alert alert-error" style="margin-top:14px">${icon('alert')}<span><b>${esc(o.status_label)}</b>. ${esc(o.cancel_reason || '')}${o.payment_status === 'dikembalikan' ? ' Dana dikembalikan oleh penjual.' : ''}</span></div>` : ''}
      </div>
      <div>
        ${showPay ? `<section class="card card-pad" style="margin-bottom:14px"><h3>Bayar dengan QRIS</h3>
          <div class="qris-box" style="margin-top:12px">${o.qris.demo ? '<span class="pill pill-amber">Contoh QRIS (demo lokal)</span>' : ''}
            <img src="${esc(o.qris.image)}" alt="QRIS ${esc(o.stall.name)}"><b style="font-size:22px">${rupiah(o.total)}</b>
            ${o.payment_deadline && o.status === 'menunggu_pembayaran' ? `<p class="small">Bayar dalam <span class="countdown" data-deadline="${esc(o.payment_deadline)}">--:--</span> agar pesanan masuk antrean.</p>` : '<p class="small muted">Bayar sebelum masuk antrean.</p>'}</div>
          <form id="pay-form" style="margin-top:14px" novalidate>
            <div class="field"><label for="payment_ref">Nomor referensi transaksi</label><input class="input" id="payment_ref" name="payment_ref" maxlength="60" placeholder="Contoh: 2026110912345"></div>
            <div class="field"><label for="proof">Bukti pembayaran (gambar, maks. 2 MB)</label><input class="input" id="proof" name="proof" type="file" accept="image/png,image/jpeg,image/webp"></div>
            <button class="btn btn-primary btn-block" type="submit">${icon('upload')}Kirim bukti bayar</button></form></section>` : ''}
        ${o.payment_status === 'menunggu_verifikasi' ? `<div class="alert alert-info" style="margin-bottom:14px">${icon('clock')}<span>Bukti bayar terkirim${o.payment_ref ? ` (ref. ${esc(o.payment_ref)})` : ''}. Penjual sedang memverifikasi.${o.payment_proof_url ? ` <a class="link" href="${o.payment_proof_url}" target="_blank" rel="noopener">Lihat bukti</a>` : ''}</span></div>` : ''}
        ${o.payment_method === 'kasir' && o.payment_status !== 'lunas' && !failed ? `<div class="alert alert-warn" style="margin-bottom:14px">${icon('wallet')}<span>Bayar ${rupiah(o.total)} di kasir, lalu minta penjual memverifikasi pembayaran agar pesanan masuk antrean.</span></div>` : ''}
        <section class="card card-pad"><h3 style="margin-bottom:14px">Status pesanan</h3>
          <ol class="timeline">${steps.map((s, i) => `<li class="${s[2] ? 'done' : i === currentIdx ? 'current' : ''}"><span class="dot">${s[2] ? icon('check') : ''}</span><strong>${esc(s[0])}</strong><span class="tiny muted">${s[1] ? esc(fmtDateTime(s[1])) : i === currentIdx ? 'Menunggu' : ''}</span></li>`).join('')}
          ${failed ? `<li class="failed"><span class="dot">${icon('x')}</span><strong>${esc(o.status_label)}</strong><span class="tiny muted">${esc(fmtDateTime(o.cancelled_at))}</span></li>` : ''}</ol></section>
        <section class="card card-pad" style="margin-top:14px"><div class="row" style="justify-content:space-between;margin-bottom:6px"><h3>Rincian</h3>${payPill(o)}</div>
          ${o.items.map((i) => `<div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px dashed var(--line)"><span><b>${i.qty}×</b> ${esc(i.name)}${i.recipient ? `<br><span class="tiny" style="color:var(--violet)">untuk ${esc(i.recipient)}</span>` : ''}${i.note ? `<br><span class="tiny muted">${esc(i.note)}</span>` : ''}</span><span>${rupiah(i.qty * i.price)}</span></div>`).join('')}
          ${o.note ? `<p class="small muted" style="margin-top:8px">Catatan: ${esc(o.note)}</p>` : ''}
          <div class="row" style="justify-content:space-between;margin-top:12px"><b>Total</b><b style="font-size:18px">${rupiah(o.total)}</b></div></section>
        ${o.can_cancel ? `<button class="btn btn-danger btn-block" style="margin-top:14px" data-cancel>${icon('x')}Batalkan pesanan</button>` : ''}
      </div></div>`;
    bind(o);
  }
  function bind(o) {
    clearInterval(timer);
    const cd = $('[data-deadline]', view);
    if (cd) {
      const tick = () => {
        const s = Math.max(0, Math.floor((new Date(cd.dataset.deadline).getTime() - Date.now()) / 1000));
        cd.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      };
      tick();
      timer = setInterval(tick, 1000);
    }
    const form = $('#pay-form', view);
    if (form) form.addEventListener('submit', (e) => {
      e.preventDefault();
      withBusy(form.querySelector('button'), async () => {
        const fd = new FormData(form);
        if (!fd.get('payment_ref') && !(fd.get('proof') && fd.get('proof').size)) { toast('Isi nomor referensi atau unggah bukti pembayaran.', 'error'); return; }
        if (fd.get('proof') && !fd.get('proof').size) fd.delete('proof');
        try {
          await api(`/orders/${o.id}/payment`, { method: 'POST', form: fd });
          toast('Bukti bayar terkirim. Tunggu verifikasi penjual.', 'success');
          paint();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
    const c = $('[data-cancel]', view);
    if (c) c.addEventListener('click', async () => {
      const reason = await confirmDialog({ title: 'Batalkan pesanan?', message: 'Pesanan yang belum diproses bisa dibatalkan tanpa pelanggaran.', okText: 'Batalkan', danger: true, input: { label: 'Alasan (opsional)', placeholder: 'Contoh: jadwal kelas berubah' } });
      if (reason === null) return;
      try {
        await api(`/orders/${o.id}/cancel`, { method: 'POST', body: { reason: reason || 'Dibatalkan pembeli' } });
        await refreshMe();
        toast('Pesanan dibatalkan.', 'success');
        paint();
      } catch (err) { toast(err.message, 'error'); }
    });
  }
  await paint();
  const refresh = debounce(paint, 300);
  ctx.onEvent = (type, d) => { if (type === 'queue' || (type === 'order' && String(d.id) === String(params.id))) refresh(); };
  const poll = setInterval(() => { if (document.visibilityState === 'visible') paint().catch(() => {}); }, 60000);
  ctx.cleanup = () => { clearInterval(timer); clearInterval(poll); };
}

/* ------------------------------ Favorit ------------------------------ */
export async function favorites({ view }) {
  const { menus } = await api('/favorites');
  view.innerHTML = `<a href="/app/profil" class="row small muted" style="margin:6px 0 12px">${icon('back')} Profil</a><h1 style="margin-bottom:16px">Menu Favorit</h1>
    ${menus.length ? `<div class="menu-grid">${menus.map(menuCard).join('')}</div>` : emptyState('Belum ada favorit', 'Ketuk ikon hati pada menu untuk menyimpannya di sini.', '<a href="/app" class="btn btn-primary">Jelajahi menu</a>')}`;
  bindMenuActions(view);
}

/* ------------------------------ Notifikasi ------------------------------ */
const NOTIF_ICON = { siap: 'check', selesai: 'check', antrean: 'users', diproses: 'flame', pembayaran: 'wallet', bukti_bayar: 'wallet', peringatan: 'alert', blokir: 'shield', dibatalkan: 'x', tidak_diambil: 'x', pengingat: 'clock', pesanan_baru: 'receipt', info: 'info' };

export async function renderNotifications(ctx, orderPath) {
  const { view } = ctx;
  async function paint() {
    const { notifications } = await api('/notifications');
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    view.innerHTML = `<div class="row" style="justify-content:space-between;margin:8px 0 14px"><h1>Notifikasi</h1><button class="link" data-readall>Tandai semua dibaca</button></div>
      ${perm === 'default' ? `<div class="alert alert-info" style="margin-bottom:14px">${icon('bell')}<span class="grow">Aktifkan notifikasi browser agar tahu saat pesanan siap meski tab tidak dibuka.</span><button class="btn btn-sm btn-primary" data-perm>Aktifkan</button></div>` : ''}
      <div style="max-width:760px">${notifications.length ? notifications.map((n) => `<a href="${n.order_id ? orderPath(n.order_id) : '#'}" class="notif ${n.is_read ? '' : 'unread'}" data-nid="${n.id}">
        <span class="notif-ico ${esc(n.type)}">${icon(NOTIF_ICON[n.type] || 'bell')}</span>
        <span class="grow"><b>${esc(n.title)}</b><br><span class="small muted">${esc(n.body)}</span><br><span class="tiny muted">${esc(relTime(n.created_at))}</span></span></a>`).join('') : emptyState('Belum ada notifikasi', 'Kabar tentang pesananmu akan muncul di sini.')}</div>`;
  }
  await paint();
  view.addEventListener('click', async (e) => {
    if (e.target.closest('[data-readall]')) {
      await api('/notifications/read-all', { method: 'POST' });
      await refreshMe();
      return paint();
    }
    if (e.target.closest('[data-perm]')) {
      const p = await Notification.requestPermission();
      toast(p === 'granted' ? 'Notifikasi browser aktif.' : 'Izin notifikasi tidak diberikan.', p === 'granted' ? 'success' : 'error');
      return paint();
    }
    const n = e.target.closest('[data-nid]');
    if (n) {
      if (n.getAttribute('href') === '#') e.preventDefault();
      api(`/notifications/${n.dataset.nid}/read`, { method: 'POST' }).then(refreshMe).catch(() => {});
    }
  });
  ctx.onEvent = (type) => { if (type === 'notification') paint(); };
}
export const notifications = (ctx) => renderNotifications(ctx, (id) => `/app/pesanan/${id}`);

/* ------------------------------ Profil ------------------------------ */
export async function profile(ctx) {
  const { view } = ctx;
  await refreshMe();
  const u = state.user;
  const p = state.me.penalty;
  view.innerHTML = `<h1 style="margin:8px 0 16px">Profil</h1>
    <div style="display:grid;gap:14px;max-width:760px">
    <section class="card profile-head"><span class="avatar lg">${esc(initials(u.name))}</span>
      <div class="grow"><h2>${esc(u.name)}</h2><div class="row wrap" style="gap:6px;margin-top:6px"><span class="pill pill-red">Pembeli</span>
      ${u.is_verified ? `<span class="pill pill-green">${icon('shield')}Terverifikasi</span>` : '<a href="/verifikasi" class="pill pill-amber">Belum terverifikasi</a>'}</div></div></section>
    <section class="card card-pad"><dl class="kv">
      <dt>Email</dt><dd>${esc(u.email)}</dd><dt>No. HP</dt><dd>${esc(u.phone || '-')}</dd></dl>
      <div class="row wrap" style="margin-top:16px"><button class="btn btn-ghost btn-sm" data-edit>${icon('edit')}Ubah profil</button><button class="btn btn-ghost btn-sm" data-pw>${icon('shield')}Ganti password</button><a href="/app/favorit" class="btn btn-ghost btn-sm">${icon('heart')}Menu favorit</a></div></section>
    <section class="card card-pad"><div class="row" style="justify-content:space-between"><h3>Catatan pelanggaran</h3><span class="pill ${p.violations ? 'pill-amber' : 'pill-green'}">${p.violations}/${p.limit}</span></div>
      <div class="meter" aria-hidden="true"><i style="width:${Math.min(100, (p.violations / p.limit) * 100)}%"></i></div>
      <p class="small muted">Pelanggaran dihitung saat pesanan QRIS tidak dibayar dalam 15 menit atau pesanan belum lunas tidak diambil 30 menit setelah siap. Kamu menerima peringatan pada pelanggaran ke-1 dan ke-2. Pelanggaran ke-${p.limit} dalam ${p.window_days} hari memblokir pemesanan selama 24 jam.</p>
      ${p.blocked_until ? `<div class="alert alert-error" style="margin-top:12px">${icon('alert')}<span>Diblokir sampai ${esc(fmtDateTime(p.blocked_until))} WIB.</span></div>` : ''}</section>
    <button class="btn btn-danger" data-logout>${icon('logout')}Keluar</button></div>`;
  $('[data-logout]', view).addEventListener('click', logout);
  $('[data-edit]', view).addEventListener('click', () => {
    const m = modal({ title: 'Ubah profil', body: `<form id="pf" novalidate><div class="field"><label for="pf-name">Nama</label><input class="input" id="pf-name" name="name" value="${esc(u.name)}"></div>
      <div class="field"><label for="pf-phone">No. HP</label><input class="input" id="pf-phone" name="phone" value="${esc(u.phone || '')}"></div><button class="btn btn-primary btn-block">Simpan</button></form>` });
    const f = m.el.querySelector('form');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/auth/profile', { method: 'PATCH', body: formValues(f) }); m.close(); toast('Profil diperbarui.', 'success'); profile(ctx); } catch (err) { showFieldError(f, err); }
    });
  });
  $('[data-pw]', view).addEventListener('click', () => passwordModal());
}

export function passwordModal() {
  const m = modal({ title: 'Ganti password', body: `<form novalidate><div class="field"><label for="pw-c">Password lama</label><input class="input" id="pw-c" name="current" type="password" autocomplete="current-password"></div>
    <div class="field"><label for="pw-n">Password baru</label><input class="input" id="pw-n" name="next" type="password" autocomplete="new-password"><span class="hint">Minimal 8 karakter dengan huruf dan angka.</span></div><button class="btn btn-primary btn-block">Simpan</button></form>` });
  const f = m.el.querySelector('form');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/auth/password', { method: 'POST', body: formValues(f) }); m.close(); toast('Password diganti.', 'success'); } catch (err) { showFieldError(f, err); }
  });
}
