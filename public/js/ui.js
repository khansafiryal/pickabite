// Utilitas antarmuka: format, escape, toast, modal, gambar menu.
import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const rupiah = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
const TZ = 'Asia/Jakarta';
export const fmtTime = (d) => (d ? new Intl.DateTimeFormat('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(d)) : '-');
export const fmtDate = (d) => new Intl.DateTimeFormat('id-ID', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d));
export const fmtShortDate = (d) => new Intl.DateTimeFormat('id-ID', { timeZone: TZ, day: 'numeric', month: 'short' }).format(new Date(d));
export const fmtDateTime = (d) => (d ? new Intl.DateTimeFormat('id-ID', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d)) : '-');
export function relTime(d) {
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return 'baru saja';
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return fmtDateTime(d);
}
export const minutesUntil = (d) => Math.max(0, Math.round((new Date(d).getTime() - Date.now()) / 60000));
export const initials = (name) => String(name || '?').replace(/^(dr|prof)\.?\s+/i, '').split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
export const BUYER_TYPES = { mahasiswa: 'Mahasiswa', dosen: 'Dosen', tendik: 'Tendik', umum: 'Umum' };
export const CATEGORY_IMG = { 'Makanan Berat': 'nasi-ayam', Mie: 'mie-ayam', Camilan: 'dimsum', Minuman: 'es-teh' };

export function foodSrc(image) {
  if (!image) return '/img/food/nasi-ayam.svg';
  if (image.startsWith('illust:')) return `/img/food/${image.slice(7)}.svg`;
  return image;
}
export function foodImg(image, alt = '') {
  const src = foodSrc(image);
  const photo = !src.startsWith('/img/');
  return `<img src="${esc(src)}" alt="${esc(alt)}" class="${photo ? 'photo' : ''}" loading="lazy">`;
}

export function statusPill(o) {
  return `<span class="pill status-${esc(o.status)}">${esc(o.status_label)}</span>`;
}
export function payPill(o) {
  const map = { lunas: ['pill-green', 'Lunas'], belum_bayar: ['pill-amber', 'Belum bayar'], menunggu_verifikasi: ['pill-blue', 'Menunggu verifikasi'], dikembalikan: ['pill-gray', 'Dana dikembalikan'] };
  const [cls, label] = map[o.payment_status] || ['pill-gray', o.payment_status];
  return `<span class="pill ${cls}">${icon('wallet')}${label}${o.payment_method === 'kasir' ? ' · kasir' : ' · QRIS'}</span>`;
}

/* ---------------- Toast ---------------- */
export function toast(message, type = 'info', title = '') {
  const box = document.getElementById('toasts');
  if ([...box.children].some((el) => el.dataset.message === `${type}|${title}|${message}`)) return;
  while (box.children.length >= 3) box.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.dataset.message = `${type}|${title}|${message}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const ico = type === 'error' ? 'alert' : type === 'success' ? 'check' : 'bell';
  el.innerHTML = `${icon(ico)}<div>${title ? `<b>${esc(title)}</b>` : ''}${esc(message)}</div>`;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 4200);
  setTimeout(() => el.remove(), 4600);
}

/* ---------------- Modal ---------------- */
export function modal({ title, body, wide = false, onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn flat" data-close aria-label="Tutup">${icon('x')}</button></div>
    <div class="modal-body">${body}</div></div>`;
  document.body.appendChild(wrap);
  document.body.style.overflow = 'hidden';
  const close = () => {
    wrap.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  const first = wrap.querySelector('input, select, textarea, button:not([data-close])');
  if (first) setTimeout(() => first.focus(), 50);
  return { el: wrap.querySelector('.modal'), close };
}

export function confirmDialog({ title, message, okText = 'Ya, lanjutkan', danger = false, input = null }) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title,
      body: `<p class="muted" style="margin-bottom:16px">${esc(message)}</p>
        ${input ? `<div class="field"><label for="dlg-input">${esc(input.label)}</label><input id="dlg-input" class="input" value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}" maxlength="200"></div>` : ''}
        <div class="row" style="justify-content:flex-end"><button class="btn btn-ghost" data-close>Batal</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(okText)}</button></div>`,
      onClose: () => { if (!done) resolve(null); },
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      const val = input ? m.el.querySelector('#dlg-input').value.trim() : true;
      if (input && input.required && !val) { m.el.querySelector('#dlg-input').focus(); return; }
      done = true;
      m.close();
      resolve(val);
    });
  });
}

/* ---------------- Form ---------------- */
export function formValues(form) {
  const out = {};
  for (const [k, v] of new FormData(form).entries()) if (!(v instanceof File)) out[k] = v;
  return out;
}
export function showFieldError(form, err) {
  $$('.field.invalid', form).forEach((f) => f.classList.remove('invalid'));
  $$('.field-error', form).forEach((f) => f.remove());
  const field = err && err.data && err.data.field;
  const input = field && form.querySelector(`[name="${field}"]`);
  if (input) {
    const wrap = input.closest('.field');
    wrap.classList.add('invalid');
    wrap.insertAdjacentHTML('beforeend', `<span class="field-error">${esc(err.message)}</span>`);
    input.focus();
  } else {
    toast(err.message, 'error');
  }
}
export async function withBusy(btn, fn) {
  if (btn.disabled) return;
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="margin:0;width:18px;height:18px;border-width:2px"></span>';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
}
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function emptyState(title, text, action = '') {
  return `<div class="empty"><img src="/img/empty-plate.svg" alt=""><h3>${esc(title)}</h3><p>${esc(text)}</p>${action ? `<div style="margin-top:16px">${action}</div>` : ''}</div>`;
}

/** Bunyi pendek untuk pesanan baru (penjual). */
export function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.08;
    o.start(); o.frequency.setValueAtTime(1175, ctx.currentTime + 0.12);
    o.stop(ctx.currentTime + 0.25);
  } catch (_) { /* audio tidak tersedia */ }
}
