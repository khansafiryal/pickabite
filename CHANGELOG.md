# Catatan Perubahan

Format mengikuti [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) dan penomoran versi mengikuti [Semantic Versioning](https://semver.org/).

## [Unreleased] - 2026-11-12

### Diperbaiki

- Hero merah memenuhi layar dan URL dasar menampilkan halaman sambutan saat sesi aktif.
- Listener halaman SPA dihapus melalui pergantian elemen view sehingga tambah keranjang, pesan ulang, dan dialog penolakan tidak berlipat.
- Kategori beranda mengarahkan ke hasil filter. Informasi antrean dikirim ke seluruh pemirsa dan disegarkan berkala.
- Semua metode pembayaran menunggu verifikasi sebelum masuk antrean. Pesanan lunas tidak dapat dibatalkan.
- Jam operasional WIB berlaku di localhost. Pengabaian jam melalui mode demo dihapus.
- Penolakan pembayaran menyimpan alasan, memberi notifikasi, membersihkan bukti lama, dan menyediakan unggah ulang.
- Pendaftaran pembeli tanpa jenis pembeli dan NIM. Label lokasi global dihapus.
- Pesan ulang memperhitungkan jumlah dalam keranjang terhadap stok dan menggabungkan item serupa.
- Migrasi SQLite menambah alasan penolakan dan memindahkan antrean lama yang belum lunas ke status menunggu pembayaran.
- Folder docs dikecualikan dari Git. Dokumentasi diperbarui dan petunjuk penyiapan repositori contoh dibersihkan.
- 42 pengujian unit dan API lulus.

## [1.0.0] - 2026-11-09

### Ditambahkan

- Registrasi dan login dua peran (pembeli dan penjual) dengan NIM, NIP, atau email serta verifikasi OTP.
- Direktori stan, katalog menu, favorit, dan stok harian yang direset otomatis.
- Keranjang lintas stan dengan catatan dan nama penerima titipan, dipecah menjadi satu pesanan per stan saat checkout.
- Jam ambil secepatnya atau slot 15 menit dengan kapasitas per slot.
- Antrean adil tanpa jalur khusus, nomor dan posisi antrean, serta estimasi waktu siap.
- Kode pesanan acak 3 huruf dan 3 angka beserta QR yang hanya berlaku sekali.
- Pembayaran QRIS dengan bukti, verifikasi penjual, dan batas bayar 15 menit.
- Penalti bertahap dan blokir sementara 24 jam.
- Notifikasi real-time (Server-Sent Events) dan pengingat ambil.
- Dashboard penjual, laporan per periode, ekspor CSV, dan pengaturan stan.
- Mode demo (`DEMO_MODE`) agar fitur pre-order bisa dicoba di localhost kapan saja.
- 38 uji otomatis, 12 skenario E2E, CI GitHub Actions, serta dokumen BA, DEV, QA, dan PM.

### Diperbaiki (pengujian akhir)

- DEF-01: komentar sebaris di `.env` membuat nilai konfigurasi diabaikan.
- DEF-02: pesanan secepatnya diterima di luar jam operasional, sedangkan slot kosong.
- DEF-03: skrip E2E bergantung pada jam saat dijalankan.
- DEF-04: label "ASAP" belum dilokalkan.
- DEF-05: placeholder kolom cek kode terpotong di layar HP.
- DEF-06: kontras teks sekunder dan label status di bawah 4,5:1.

### Dihapus dari lingkup

- Jalur khusus dosen (berdasarkan hasil wawancara pedagang dan mahasiswa).
