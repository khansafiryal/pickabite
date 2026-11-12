# Pickabite

**Pesan dulu, ambil tanpa antre panjang.** Pickabite adalah aplikasi web pre-order untuk kantin Fakultas Ilmu Komputer (FILKOM) Universitas Brawijaya. Pembeli memilih menu dan jam ambil, memantau antrean secara langsung, lalu mengambil pesanan dengan kode unik. Penjual mendapat papan pesanan yang ringkas dan dashboard penjualan.

## Fitur utama

**Pembeli**

- Daftar dengan nama, email, dan password, lalu verifikasi OTP.
- Direktori stan, kategori, pencarian, sisa stok, panjang antrean, dan menu terlaris.
- Keranjang lintas stan dengan catatan dan nama penerima titipan.
- Jam ambil **secepatnya** atau **slot 15 menit** dengan kapasitas per slot.
- Kode pesanan acak **3 huruf + 3 angka** (contoh `KTB482`) beserta QR, hanya berlaku sekali.
- Pembayaran QRIS dengan bukti atau pembayaran di kasir bila stan mengizinkan. Semua pesanan masuk antrean setelah pembayaran diverifikasi penjual.
- Nomor dan posisi antrean, estimasi siap, serta notifikasi real-time saat pesanan siap.
- Riwayat dan pesan ulang, menu favorit, serta status pelanggaran di profil.

**Penjual (kantin)**

- Dashboard: pendapatan, porsi terjual, pesanan diproses, siap diambil, menunggu bayar, grafik 7 hari, jam ramai, menu terlaris, dan stok menipis.
- Papan pesanan per status, verifikasi bukti bayar, cek kode saat serah terima, dan tandai tidak diambil.
- Kelola menu, foto, waktu siap, dan stok harian yang direset otomatis.
- Pengaturan stan: buka atau tutup, jeda pesanan online, wajib bayar di muka, jam operasional, kapasitas slot, dan gambar QRIS.
- Laporan per periode dan ekspor CSV.

**Aturan yang ditegakkan sistem:** satu antrean adil tanpa jalur khusus, maksimal 3 pesanan aktif per akun, batas bayar QRIS 15 menit, toleransi ambil 30 menit, serta blokir sementara 24 jam setelah 3 pelanggaran dalam 7 hari dengan dua peringatan lebih dulu. Tidak ada fitur promo.

## Teknologi

Node.js, Express, SQLite (sql.js/WebAssembly, tanpa kompilasi native), HTML, CSS, dan JavaScript ES Modules tanpa build step, Server-Sent Events, serta pengujian node:test, supertest, dan Playwright.

## Lingkungan lokal

Node.js 18.17 atau lebih baru beserta npm. Alamat bawaan aplikasi adalah `http://localhost:3000`. Basis data `data/pickabite.db` dibuat otomatis dengan data contoh tiga stan, menu, dan riwayat penjualan tujuh hari.

### Akun demo

| Peran | Login | Password |
| --- | --- | --- |
| Pembeli (mahasiswa) | `alya@student.ub.ac.id` | `pembeli123` |
| Pembeli (dosen) | `sari.wulandari@ub.ac.id` | `pembeli123` |
| Penjual (Warung Bu Mimin) | `mimin@pickabite.id` | `penjual123` |
| Penjual (CNC Dimsum Gyoza) | `cnc@pickabite.id` | `penjual123` |

Halaman masuk menyediakan tab **Pembeli** dan **Penjual**.

### Perintah npm

| Perintah | Fungsi |
| --- | --- |
| `npm start` | Menjalankan server di port 3000 |
| `npm run dev` | Server restart otomatis saat kode berubah |
| `npm run seed` | Mengosongkan basis data lalu mengisi ulang data demo |
| `npm test` | Menjalankan 42 uji otomatis (unit dan API) |

### Konfigurasi

Konfigurasi opsional tersedia melalui `.env`, dengan daftar variabel bawaan di `.env.example`.

- Jam operasional penjual selalu berlaku dalam WIB, termasuk di localhost.
- `SHOW_OTP=true` menampilkan OTP di layar dan log karena belum ada server email.
- `MAX_ACTIVE_ORDERS`, `PAYMENT_WINDOW_MIN`, `NO_SHOW_GRACE_MIN`, `VIOLATIONS_TO_BLOCK`, dan `BLOCK_HOURS` mengatur aturan bisnis.

## Struktur proyek

```text
src/        server: rute API, layanan domain, basis data, middleware
public/     antarmuka web responsif (HP dan desktop)
tests/      uji unit dan API (node:test + supertest)
scripts/    reset data demo
docs/       dokumen BA, DEV, QA, PM (.docx dan .md), WBS v2 (.xlsx), diagram, hasil uji
```

## Lisensi

MIT. Lihat berkas [LICENSE](LICENSE).
