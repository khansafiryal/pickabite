'use strict';
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const config = require('./config');
const { HttpError } = require('./utils');
const { loadUser } = require('./middleware/auth');

function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  next();
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(securityHeaders);
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());
  app.use(loadUser);

  // Berkas statis: aplikasi, font lokal, dan gambar publik unggahan penjual.
  app.use(express.static(config.publicDir, { index: false, maxAge: '1h' }));
  app.use('/fonts/poppins', express.static(path.join(config.root, 'node_modules/@fontsource/poppins/files'), { maxAge: '7d' }));
  app.use('/fonts/playfair', express.static(path.join(config.root, 'node_modules/@fontsource/playfair-display/files'), { maxAge: '7d' }));
  app.use('/uploads/public', express.static(path.join(config.uploadDir, 'public'), { maxAge: '1d' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'pickabite', time: new Date().toISOString() }));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api', require('./routes/catalog'));
  app.use('/api/seller', require('./routes/seller'));
  app.use('/api', require('./routes/common'));
  app.use('/api', require('./routes/buyer'));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Endpoint tidak ditemukan.')));

  // Fallback SPA: semua rute non-API dilayani index.html.
  app.get('*', (_req, res) => res.sendFile(path.join(config.publicDir, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran gambar maksimal 2 MB.' : 'Unggahan gagal diproses.';
      return res.status(400).json({ error: msg });
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Format data tidak valid.' });
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan di server. Coba lagi beberapa saat.' });
  });
  return app;
}

module.exports = { createApp };
