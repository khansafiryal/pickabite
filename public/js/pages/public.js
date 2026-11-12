// Halaman publik: landing, masuk, daftar, verifikasi OTP.
import { api } from '../api.js';
import { icon } from '../icons.js';
import { $, $$, esc, toast, formValues, showFieldError, withBusy } from '../ui.js';
import { state, navigate, refreshMe, homeFor } from '../app.js';

export async function landing({ view }) {
  view.innerHTML = `<div class="landing">
    <section class="hero">
      <div class="hero-pattern" aria-hidden="true"><span style="top:-30px;left:-40px">P</span><span style="top:260px;left:120px">B</span></div>
      <div class="hero-brand"><img src="/img/logo-light.svg" alt="">PICKABITE</div>
      <div class="hero-art"><img class="chopsticks" src="/img/hero-dimsum.svg" alt="Ilustrasi sumpit mengambil dimsum"></div>
      <div class="hero-vertical" aria-hidden="true">KANTIN</div>
      <h1>Pesan dulu,<br>ambil tanpa<br>antre panjang</h1>
      <p>Lihat menu kantin FILKOM, pilih jam ambil, pantau antrean secara langsung, lalu ambil pesanan dengan kode unik.</p>
      <div class="actions">
        <a href="/daftar" class="btn btn-white">Mulai Sekarang ${icon('arrow')}</a>
        <a href="/masuk" class="btn btn-light">Saya sudah punya akun</a>
      </div>
    </section>
    <section class="landing-side">
      <div><span class="pill pill-red">Kantin FILKOM UB</span><h2 style="margin-top:14px">Satu antrean yang adil<br>untuk semua pembeli.</h2>
      <p class="muted" style="margin-top:10px;max-width:560px">Mahasiswa, dosen, tendik, dan tamu memesan lewat antrean yang sama. Penjual menerima pesanan rapi tanpa harus membalas chat satu per satu.</p></div>
      <div class="feature-grid">
        ${[['clock', 'Pilih jam ambil', 'Ambil secepatnya atau pilih slot 15 menit sesuai jadwal kelas.'],
          ['users', 'Posisi antrean langsung', 'Tahu berapa pesanan di depanmu dan estimasi siapnya.'],
          ['ticket', 'Kode unik 3 huruf 3 angka', 'Tunjukkan kode atau QR saat mengambil. Kode hanya berlaku sekali.'],
          ['bell', 'Notifikasi siap diambil', 'Dapat kabar saat pesanan siap dan pengingat bila belum diambil.']]
          .map(([ic, t, d]) => `<div class="card feature"><span class="f-ico">${icon(ic)}</span><b>${t}</b><span class="muted small">${d}</span></div>`).join('')}
      </div>
      <div class="role-cards">
        <a href="/masuk?peran=pembeli" class="card role-card"><img src="/img/food/nasi-ayam.svg" alt=""><div><b>Masuk sebagai Pembeli</b><br><span class="muted small">Mahasiswa, dosen, tendik, dan tamu</span></div></a>
        <a href="/masuk?peran=penjual" class="card role-card"><img src="/img/food/dimsum.svg" alt=""><div><b>Masuk sebagai Penjual</b><br><span class="muted small">Kelola pesanan, menu, dan laporan stan</span></div></a>
      </div>
    </section>
  </div>`;
}

const DEMO = {
  buyer: [['Pembeli', 'alya@student.ub.ac.id', 'pembeli123'], ['Dosen', 'sari.wulandari@ub.ac.id', 'pembeli123']],
  seller: [['Warung Bu Mimin', 'mimin@pickabite.id', 'penjual123'], ['CNC Dimsum Gyoza', 'cnc@pickabite.id', 'penjual123']],
};

export async function login({ view, query }) {
  let role = query.get('peran') === 'penjual' ? 'seller' : 'buyer';
  view.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <a href="/" class="auth-head brand"><img src="/img/logo.svg" alt="">Pickabite</a>
    <div class="card">
      <h1>Selamat datang kembali</h1>
      <p class="muted">Masuk untuk memesan atau mengelola stan.</p>
      <div class="segmented role-tabs" role="tablist" aria-label="Pilih peran">
        <button type="button" role="tab" data-role="buyer">${icon('user')} Pembeli</button>
        <button type="button" role="tab" data-role="seller">${icon('store')} Penjual</button>
      </div>
      <form id="login-form" novalidate>
        <div class="field"><label for="identifier" data-id-label></label>
          <input class="input" id="identifier" name="identifier" autocomplete="username" required></div>
        <div class="field"><label for="password">Password</label>
          <input class="input" id="password" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn btn-primary btn-block" type="submit">Masuk ${icon('arrow')}</button>
      </form>
      <p class="small muted" style="margin-top:16px;text-align:center">Belum punya akun? <a class="link" href="/daftar" data-reg>Daftar</a></p>
      <div class="demo-box" data-demo></div>
    </div></div></div>`;
  const form = $('#login-form', view);
  function setRole(r) {
    role = r;
    $$('[data-role]', view).forEach((b) => { b.classList.toggle('active', b.dataset.role === r); b.setAttribute('aria-selected', b.dataset.role === r); });
    $('[data-id-label]', view).textContent = r === 'buyer' ? 'Email pembeli' : 'Email penjual';
    $('#identifier', view).placeholder = r === 'buyer' ? 'Contoh: alya@student.ub.ac.id' : 'Contoh: mimin@pickabite.id';
    $('[data-reg]', view).setAttribute('href', `/daftar?peran=${r === 'seller' ? 'penjual' : 'pembeli'}`);
    $('[data-demo]', view).innerHTML = `<b>Akun demo</b> (klik untuk mengisi):<br>${DEMO[r].map(([l, id, pw]) => `<button type="button" data-fill="${esc(id)}|${esc(pw)}">${esc(l)}: ${esc(id)}</button>`).join('<br>')}`;
  }
  setRole(role);
  $$('[data-role]', view).forEach((b) => b.addEventListener('click', () => setRole(b.dataset.role)));
  view.addEventListener('click', (e) => {
    const f = e.target.closest('[data-fill]');
    if (!f) return;
    const [id, pw] = f.dataset.fill.split('|');
    form.identifier.value = id;
    form.password.value = pw;
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(form.querySelector('button[type=submit]'), async () => {
      try {
        await api('/auth/login', { method: 'POST', body: { ...formValues(form), role } });
        await refreshMe();
        const next = query.get('next');
        navigate(next && next.startsWith(role === 'seller' ? '/penjual' : '/app') ? next : homeFor(state.user), { replace: true });
      } catch (err) {
        if (err.data && err.data.code === 'ROLE_MISMATCH') setRole(role === 'buyer' ? 'seller' : 'buyer');
        toast(err.message, 'error');
      }
    });
  });
}

export async function register({ view, query }) {
  let role = query.get('peran') === 'penjual' ? 'seller' : 'buyer';
  view.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <a href="/" class="auth-head brand"><img src="/img/logo.svg" alt="">Pickabite</a>
    <div class="card">
      <h1>Buat akun</h1>
      <p class="muted">Gunakan email aktif untuk membuat akun.</p>
      <div class="segmented role-tabs" role="tablist">
        <button type="button" data-role="buyer">${icon('user')} Pembeli</button>
        <button type="button" data-role="seller">${icon('store')} Penjual</button>
      </div>
      <form id="reg-form" novalidate>
        <div class="field"><label for="name">Nama lengkap</label><input class="input" id="name" name="name" autocomplete="name" required></div>
        <div data-seller class="hidden">
          <div class="field"><label for="stall_name">Nama stan</label><input class="input" id="stall_name" name="stall_name" placeholder="Contoh: Warung Bu Mimin"></div>
          <div class="field"><label for="stall_location">Lokasi stan</label><input class="input" id="stall_location" name="stall_location" placeholder="Kantin FILKOM, stan 2"></div>
        </div>
        <div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="email" required placeholder="nama@student.ub.ac.id"></div>
        <div class="field"><label for="phone">No. HP (opsional)</label><input class="input" id="phone" name="phone" inputmode="tel" placeholder="081234567890"></div>
        <div class="field"><label for="password">Password</label><input class="input" id="password" name="password" type="password" autocomplete="new-password" required><span class="hint">Minimal 8 karakter dengan huruf dan angka.</span></div>
        <button class="btn btn-primary btn-block" type="submit">Daftar ${icon('arrow')}</button>
      </form>
      <p class="small muted" style="margin-top:16px;text-align:center">Sudah punya akun? <a class="link" href="/masuk">Masuk</a></p>
    </div></div></div>`;
  const form = $('#reg-form', view);
  function setRole(r) {
    role = r;
    $$('[data-role]', view).forEach((b) => b.classList.toggle('active', b.dataset.role === r));
    $('[data-seller]', view).classList.toggle('hidden', r !== 'seller');
    form.email.placeholder = r === 'buyer' ? 'nama@student.ub.ac.id' : 'stan@email.com';
  }
  setRole(role);
  $$('[data-role]', view).forEach((b) => b.addEventListener('click', () => setRole(b.dataset.role)));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(form.querySelector('button[type=submit]'), async () => {
      try {
        const res = await api('/auth/register', { method: 'POST', body: { ...formValues(form), role } });
        await refreshMe();
        sessionStorage.setItem('pb_dev_otp', res.dev_otp || '');
        navigate('/verifikasi', { replace: true });
      } catch (err) { showFieldError(form, err); }
    });
  });
}

export async function verify({ view }) {
  if (state.user.is_verified) return navigate(homeFor(state.user), { replace: true });
  const devOtp = sessionStorage.getItem('pb_dev_otp');
  view.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <a href="/" class="auth-head brand"><img src="/img/logo.svg" alt="">Pickabite</a>
    <div class="card">
      <h1>Verifikasi akun</h1>
      <p class="muted">Masukkan 6 digit kode OTP yang dikirim ke <b>${esc(state.user.email)}</b>. Akun yang belum terverifikasi bisa melihat menu, tetapi belum bisa memesan.</p>
      <div class="alert alert-info" style="margin:16px 0" data-devotp>${icon('info')}<span>Mode lokal: kode OTP tampil di sini dan di terminal server${devOtp ? `: <b class="mono">${esc(devOtp)}</b>` : '.'}</span></div>
      <form id="otp-form" novalidate>
        <div class="field"><label for="otp">Kode OTP</label><input class="input otp-input" id="otp" name="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required></div>
        <button class="btn btn-primary btn-block" type="submit">Verifikasi</button>
      </form>
      <div class="row" style="justify-content:space-between;margin-top:14px">
        <button class="link" data-resend type="button">Kirim ulang kode</button>
        <a class="link" href="${homeFor(state.user)}">Lewati dulu</a>
      </div>
    </div></div></div>`;
  const form = $('#otp-form', view);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(form.querySelector('button'), async () => {
      try {
        await api('/auth/verify', { method: 'POST', body: { otp: form.otp.value.trim() } });
        sessionStorage.removeItem('pb_dev_otp');
        await refreshMe();
        toast('Akun terverifikasi. Selamat memesan!', 'success');
        navigate(homeFor(state.user), { replace: true });
      } catch (err) { toast(err.message, 'error'); }
    });
  });
  $('[data-resend]', view).addEventListener('click', async () => {
    try {
      const r = await api('/auth/resend-otp', { method: 'POST' });
      sessionStorage.setItem('pb_dev_otp', r.dev_otp || '');
      $('[data-devotp] span', view).innerHTML = `Mode lokal: kode OTP baru${r.dev_otp ? `: <b class="mono">${esc(r.dev_otp)}</b>` : ' ada di terminal server.'}`;
      toast('Kode OTP baru sudah dikirim.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
}
