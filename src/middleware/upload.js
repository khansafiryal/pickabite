'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { HttpError } = require('../utils');

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

/** Membuat uploader gambar ke subfolder tertentu (public untuk menu/QRIS, proofs untuk bukti bayar). */
function imageUpload(sub) {
  const dir = path.join(config.uploadDir, sub);
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${EXT[file.mimetype]}`),
  });
  return multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!EXT[file.mimetype]) return cb(new HttpError(400, 'File harus berupa gambar JPG, PNG, atau WEBP.'));
      cb(null, true);
    },
  });
}

module.exports = { imageUpload };
