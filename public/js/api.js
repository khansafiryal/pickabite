// Pembungkus fetch ke REST API Pickabite.
export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch (_) {
    const err = new Error('Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.');
    err.status = 0;
    throw err;
  }
  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Permintaan gagal (${res.status}).`);
    err.status = res.status;
    err.data = data || {};
    throw err;
  }
  return data;
}
