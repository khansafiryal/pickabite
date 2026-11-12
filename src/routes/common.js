'use strict';
/** Rute bersama: notifikasi, Server-Sent Events, dan berkas bukti bayar terlindungi. */
const path = require('path');
const fs = require('fs');
const express = require('express');
const db = require('../db');
const config = require('../config');
const { HttpError, int } = require('../utils');
const { requireAuth } = require('../middleware/auth');
const notifyHub = require('../services/notify');

const router = express.Router();
router.use(requireAuth);

router.get('/notifications', (req, res) => {
  const rows = db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 60', [req.user.id]);
  const unread = db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]).n;
  res.json({ notifications: rows, unread });
});
router.post('/notifications/read-all', (req, res) => {
  db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.user.id]);
  res.json({ ok: true });
});
router.post('/notifications/:id/read', (req, res) => {
  db.run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [int(req.params.id), req.user.id]);
  res.json({ ok: true });
});

router.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(`event: hello\ndata: {"user_id":${req.user.id}}\n\n`);
  const off = notifyHub.subscribe(req.user.id, res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); off(); });
});

router.get('/files/proof/:orderId', (req, res) => {
  const o = db.get('SELECT o.payment_proof, o.user_id, s.owner_id FROM orders o JOIN stalls s ON s.id = o.stall_id WHERE o.id = ?', [int(req.params.orderId)]);
  if (!o || !o.payment_proof || (o.user_id !== req.user.id && o.owner_id !== req.user.id)) throw new HttpError(404, 'Bukti tidak ditemukan.');
  const file = path.join(config.uploadDir, o.payment_proof);
  if (!file.startsWith(path.join(config.uploadDir, 'proofs')) || !fs.existsSync(file)) throw new HttpError(404, 'Bukti tidak ditemukan.');
  res.sendFile(file);
});

module.exports = router;
