-- Skema basis data Pickabite (SQLite)
CREATE TABLE IF NOT EXISTS users (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  role               TEXT NOT NULL CHECK (role IN ('buyer', 'seller')),
  name               TEXT NOT NULL,
  email              TEXT NOT NULL UNIQUE,
  buyer_type         TEXT CHECK (buyer_type IN ('mahasiswa', 'dosen', 'tendik', 'umum')),
  identity_number    TEXT UNIQUE,
  phone              TEXT,
  password_hash      TEXT NOT NULL,
  is_verified        INTEGER NOT NULL DEFAULT 0,
  otp_code           TEXT,
  otp_expires_at     TEXT,
  blocked_until      TEXT,
  violation_reset_at TEXT,
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stalls (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id         INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  location         TEXT,
  open_time        TEXT NOT NULL DEFAULT '07:00',
  close_time       TEXT NOT NULL DEFAULT '16:00',
  is_open          INTEGER NOT NULL DEFAULT 1,
  accepting_orders INTEGER NOT NULL DEFAULT 1,
  prepay_required  INTEGER NOT NULL DEFAULT 0,
  slot_capacity    INTEGER NOT NULL DEFAULT 10 CHECK (slot_capacity BETWEEN 1 AND 100),
  qris_image       TEXT,
  cover            TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS menus (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  stall_id     INTEGER NOT NULL REFERENCES stalls(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  ingredients  TEXT,
  category     TEXT NOT NULL CHECK (category IN ('Makanan Berat', 'Mie', 'Camilan', 'Minuman')),
  price        INTEGER NOT NULL CHECK (price >= 0),
  prep_minutes INTEGER NOT NULL DEFAULT 5 CHECK (prep_minutes BETWEEN 1 AND 120),
  daily_stock  INTEGER NOT NULL DEFAULT 0 CHECK (daily_stock >= 0),
  stock_left   INTEGER NOT NULL DEFAULT 0 CHECK (stock_left >= 0),
  stock_date   TEXT,
  image        TEXT,
  is_available INTEGER NOT NULL DEFAULT 1,
  is_deleted   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  menu_id    INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, menu_id)
);

CREATE TABLE IF NOT EXISTS cart_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  menu_id    INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  qty        INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 99),
  note       TEXT,
  recipient  TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  code             TEXT NOT NULL UNIQUE,
  checkout_id      TEXT NOT NULL,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  stall_id         INTEGER NOT NULL REFERENCES stalls(id),
  status           TEXT NOT NULL CHECK (status IN ('menunggu_pembayaran', 'dalam_antrean', 'diproses',
                                                   'siap_diambil', 'selesai', 'dibatalkan', 'tidak_diambil')),
  queue_number     INTEGER,
  queue_date       TEXT,
  pickup_type      TEXT NOT NULL CHECK (pickup_type IN ('asap', 'slot')),
  pickup_time      TEXT,
  target_ready_at  TEXT,
  payment_method   TEXT NOT NULL CHECK (payment_method IN ('qris', 'kasir')),
  payment_status   TEXT NOT NULL CHECK (payment_status IN ('belum_bayar', 'menunggu_verifikasi', 'lunas', 'dikembalikan')),
  payment_rejection_reason TEXT,
  payment_ref      TEXT,
  payment_proof    TEXT,
  payment_deadline TEXT,
  total            INTEGER NOT NULL,
  item_count       INTEGER NOT NULL,
  prep_minutes     INTEGER NOT NULL,
  note             TEXT,
  cancel_reason    TEXT,
  cancelled_by     TEXT,
  order_date       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  paid_at          TEXT,
  queued_at        TEXT,
  processing_at    TEXT,
  ready_at         TEXT,
  completed_at     TEXT,
  cancelled_at     TEXT,
  reminded_at      TEXT,
  code_used_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_stall_status ON orders (stall_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders (user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders (order_date);

CREATE TABLE IF NOT EXISTS order_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_id      INTEGER NOT NULL REFERENCES menus(id),
  name         TEXT NOT NULL,
  price        INTEGER NOT NULL,
  qty          INTEGER NOT NULL CHECK (qty > 0),
  note         TEXT,
  recipient    TEXT,
  prep_minutes INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  order_id   INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications (user_id, is_read);

CREATE TABLE IF NOT EXISTS violations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id   INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  reason     TEXT NOT NULL CHECK (reason IN ('tidak_bayar', 'tidak_diambil')),
  created_at TEXT NOT NULL
);
