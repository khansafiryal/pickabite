// Titik masuk SPA: router, kerangka tampilan (pembeli/penjual), dan event real-time.
import { api } from './api.js';
import { icon } from './icons.js';
import { esc, initials, toast, beep } from './ui.js';
import * as pub from './pages/public.js';
import * as buyer from './pages/buyer.js';
import * as seller from './pages/seller.js';

export const state = { me: null, user: null, stall: null };
let currentPage = null;
let currentShell = null;
let events = null;
let renderVersion = 0;

const routes = [
  ['/', pub.landing, { guest: true, shell: 'bare' }],
  ['/masuk', pub.login, { guest: true, shell: 'bare' }],
  ['/daftar', pub.register, { guest: true, shell: 'bare' }],
  ['/verifikasi', pub.verify, { auth: true, shell: 'bare' }],
  ['/app', buyer.home, { role: 'buyer', nav: 'home' }],
  ['/app/stan/:id', buyer.stall, { role: 'buyer', nav: 'home' }],
  ['/app/menu/:id', buyer.menuDetail, { role: 'buyer', nav: 'home' }],
  ['/app/keranjang', buyer.cart, { role: 'buyer', nav: 'cart' }],
  ['/app/pesanan', buyer.orders, { role: 'buyer', nav: 'orders' }],
  ['/app/pesanan/:id', buyer.orderDetail, { role: 'buyer', nav: 'orders' }],
  ['/app/favorit', buyer.favorites, { role: 'buyer', nav: 'profile' }],
  ['/app/notifikasi', buyer.notifications, { role: 'buyer', nav: 'notif' }],
  ['/app/profil', buyer.profile, { role: 'buyer', nav: 'profile' }],
  ['/penjual', seller.dashboard, { role: 'seller', nav: 'dash' }],
  ['/penjual/pesanan', seller.orders, { role: 'seller', nav: 'orders' }],
  ['/penjual/menu', seller.menus, { role: 'seller', nav: 'menu' }],
  ['/penjual/laporan', seller.reports, { role: 'seller', nav: 'reports' }],
  ['/penjual/pengaturan', seller.settings, { role: 'seller', nav: 'settings' }],
  ['/penjual/notifikasi', seller.notifications, { role: 'seller', nav: 'notif' }],
].map(([path, view, opts]) => {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  return { path, re, keys, view, ...opts };
});

export const homeFor = (user) => (user ? (user.role === 'seller' ? '/penjual' : '/app') : '/');

export async function refreshMe() {
  const me = await api('/auth/me');
  state.me = me;
  state.user = me.user;
  state.stall = me.stall || null;
  updateBadges();
  return me;
}

export function navigate(to, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', to);
  else history.pushState({}, '', to);
  render();
}

function match(pathname) {
  for (const r of routes) {
    const m = pathname.match(r.re);
    if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

/* ------------------------------ Kerangka ------------------------------ */
function buyerShell() {
  const nav = [
    ['home', '/app', 'home', 'Beranda'],
    ['orders', '/app/pesanan', 'receipt', 'Pesanan'],
    ['cart', '/app/keranjang', 'bag', 'Keranjang'],
    ['notif', '/app/notifikasi', 'bell', 'Notifikasi'],
    ['profile', '/app/profil', 'user', 'Profil'],
  ];
  return `<header class="topbar">
      <a href="/app" class="brand" aria-label="Pickabite beranda"><img src="/img/logo.svg" alt=""><span class="brand-text">Pickabite</span></a>
      <nav class="nav-links" aria-label="Navigasi utama">${nav.slice(0, 4).map(([k, href, ic, label]) => `<a href="${href}" data-nav="${k}">${icon(ic)}${label}<span class="badge-dot hidden" data-badge="${k}"></span></a>`).join('')}</nav>
      <a href="/app/profil" class="avatar" data-avatar aria-label="Profil">${esc(initials(state.user.name))}</a>
    </header>
    <main class="content" id="view" tabindex="-1"></main>
    <nav class="bottom-nav" aria-label="Navigasi bawah">${nav.map(([k, href, ic, label]) => `<a href="${href}" data-nav="${k}">${icon(ic)}<span>${label}</span><span class="badge-dot hidden" data-badge="${k}"></span></a>`).join('')}</nav>`;
}

function sellerShell() {
  const nav = [
    ['dash', '/penjual', 'chart', 'Dashboard'],
    ['orders', '/penjual/pesanan', 'receipt', 'Pesanan'],
    ['menu', '/penjual/menu', 'book', 'Menu'],
    ['reports', '/penjual/laporan', 'calendar', 'Laporan'],
    ['settings', '/penjual/pengaturan', 'store', 'Stan'],
  ];
  return `<aside class="sidebar" aria-label="Navigasi penjual">
      <a href="/penjual" class="brand"><img src="/img/logo-light.svg" alt="">Pickabite</a>
      ${nav.map(([k, href, ic, label]) => `<a href="${href}" data-nav="${k}">${icon(ic)}${label}<span class="badge-dot hidden" data-badge="${k}"></span></a>`).join('')}
      <a href="/penjual/notifikasi" data-nav="notif">${icon('bell')}Notifikasi<span class="badge-dot hidden" data-badge="notif"></span></a>
      <div class="side-foot"><b>${esc(state.stall ? state.stall.name : '')}</b><br><span style="opacity:.8">${esc(state.user.email)}</span></div>
    </aside>
    <div style="min-width:0">
      <header class="topbar">
        <a href="/penjual" class="brand"><img src="/img/logo.svg" alt=""></a>
        <div class="grow" style="min-width:0"><b class="serif" style="font-size:17px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" data-stallname>${esc(state.stall ? state.stall.name : '')}</b><span class="tiny muted">Mode penjual</span></div>
        <label class="store-toggle" title="Buka atau tutup stan"><span class="switch"><input type="checkbox" data-open-toggle ${state.stall && state.stall.is_open ? 'checked' : ''}><span class="track"></span></span><span data-open-label>${state.stall && state.stall.is_open ? 'Buka' : 'Tutup'}</span></label>
        <a href="/penjual/notifikasi" class="icon-btn mobile-only" aria-label="Notifikasi">${icon('bell')}<span class="badge-dot hidden" data-badge="notif"></span></a>
      </header>
      <main class="content" id="view" tabindex="-1"></main>
    </div>
    <nav class="bottom-nav" aria-label="Navigasi bawah">${nav.map(([k, href, ic, label]) => `<a href="${href}" data-nav="${k}">${icon(ic)}<span>${label}</span><span class="badge-dot hidden" data-badge="${k}"></span></a>`).join('')}</nav>`;
}

function mountShell(kind) {
  const app = document.getElementById('app');
  if (currentShell === kind) return document.getElementById('view');
  currentShell = kind;
  app.className = kind === 'seller' ? 'app seller-shell' : 'app';
  if (kind === 'bare') {
    app.innerHTML = '<main id="view"></main>';
  } else if (kind === 'buyer') {
    app.innerHTML = buyerShell();
  } else {
    app.innerHTML = sellerShell();
    const t = app.querySelector('[data-open-toggle]');
    t.addEventListener('change', async () => {
      try {
        const { stall } = await api('/seller/stall', { method: 'PATCH', body: { is_open: t.checked } });
        state.stall = stall;
        app.querySelector('[data-open-label]').textContent = stall.is_open ? 'Buka' : 'Tutup';
        toast(stall.is_open ? 'Stan dibuka. Pembeli bisa memesan.' : 'Stan ditutup. Pesanan baru tidak diterima.', 'success');
        if (currentPage && currentPage.onEvent) currentPage.onEvent('stall', stall);
      } catch (e) { t.checked = !t.checked; toast(e.message, 'error'); }
    });
  }
  updateBadges();
  return document.getElementById('view');
}

export function updateBadges() {
  const me = state.me;
  if (!me || !me.user) return;
  const set = (k, n) => document.querySelectorAll(`[data-badge="${k}"]`).forEach((el) => {
    el.textContent = n > 99 ? '99+' : n;
    el.classList.toggle('hidden', !n);
  });
  set('notif', me.unread_notifications || 0);
  set('cart', me.cart_count || 0);
  set('orders', me.active_orders || 0);
  const av = document.querySelector('[data-avatar]');
  if (av) av.textContent = initials(me.user.name);
}

/* ------------------------------ Render ------------------------------ */
export async function render() {
  const version = ++renderVersion;
  const url = new URL(location.href);
  const found = match(url.pathname);
  if (currentPage && currentPage.cleanup) currentPage.cleanup();
  currentPage = null;
  if (!found) return navigate(homeFor(state.user), { replace: true });
  const { route, params } = found;
  const user = state.user;
  if (route.guest && route.path !== '/' && user) return navigate(homeFor(user), { replace: true });
  if ((route.auth || route.role) && !user) return navigate(`/masuk?next=${encodeURIComponent(url.pathname)}`, { replace: true });
  if (route.role && user.role !== route.role) return navigate(homeFor(user), { replace: true });

  const shell = route.shell || (route.role === 'seller' ? 'seller' : 'buyer');
  let view = mountShell(shell);
  const freshView = view.cloneNode(false);
  view.replaceWith(freshView);
  view = freshView;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === route.nav));
  view.innerHTML = '<div class="spinner" role="status" aria-label="Memuat"></div>';
  window.scrollTo(0, 0);
  const ctx = { params, query: url.searchParams, view, state, navigate, refreshMe, onEvent: null, cleanup: null };
  currentPage = ctx;
  try {
    await route.view(ctx);
    if (version !== renderVersion) { if (ctx.cleanup) ctx.cleanup(); return; }
  } catch (e) {
    if (version !== renderVersion) return;
    if (e.status === 401) { state.user = null; return navigate('/masuk', { replace: true }); }
    view.innerHTML = `<div class="empty"><h3>Gagal memuat halaman</h3><p>${esc(e.message)}</p><button class="btn btn-primary" style="margin-top:16px" data-reload>Muat ulang</button></div>`;
    view.querySelector('[data-reload]').addEventListener('click', () => location.reload());
  }
  connectEvents();
}

/* ------------------------------ Real-time ------------------------------ */
function connectEvents() {
  if (!state.user) { if (events) { events.close(); events = null; } return; }
  if (events) return;
  events = new EventSource('/api/events');
  events.addEventListener('notification', (e) => {
    const n = JSON.parse(e.data);
    if (state.me) state.me.unread_notifications = (state.me.unread_notifications || 0) + 1;
    updateBadges();
    toast(n.body, n.type === 'siap' || n.type === 'selesai' ? 'success' : n.type === 'blokir' || n.type === 'dibatalkan' ? 'error' : 'info', n.title);
    if (state.user && state.user.role === 'seller' && (n.type === 'pesanan_baru' || n.type === 'bukti_bayar')) beep();
    showBrowserNotification(n);
    if (currentPage && currentPage.onEvent) currentPage.onEvent('notification', n);
  });
  for (const type of ['order', 'queue']) {
    events.addEventListener(type, (e) => {
      const data = JSON.parse(e.data);
      if (type === 'order') refreshMe().catch(() => {});
      if (currentPage && currentPage.onEvent) currentPage.onEvent(type, data);
    });
  }
  events.onerror = () => { /* EventSource menyambung ulang otomatis */ };
}

function showBrowserNotification(n) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && !['siap', 'pengingat', 'pesanan_baru', 'blokir'].includes(n.type)) return;
  try {
    const notif = new Notification(n.title, { body: n.body, icon: '/favicon.svg', tag: `pickabite-${n.id}` });
    notif.onclick = () => {
      window.focus();
      if (n.order_id) navigate(state.user.role === 'seller' ? '/penjual/pesanan' : `/app/pesanan/${n.order_id}`);
    };
  } catch (_) { /* beberapa browser HP butuh service worker */ }
}

export function closeEvents() {
  if (events) events.close();
  events = null;
}

export async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  closeEvents();
  state.me = null; state.user = null; state.stall = null;
  currentShell = null;
  navigate('/', { replace: true });
}

/* ------------------------------ Boot ------------------------------ */
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.target === '_blank' || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/') || href.startsWith('/api') || href.startsWith('/uploads')) return;
  e.preventDefault();
  if (href !== location.pathname + location.search) navigate(href);
});
window.addEventListener('popstate', render);

(async () => {
  try { await refreshMe(); } catch (_) { state.user = null; }
  render();
})();
