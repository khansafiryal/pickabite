'use strict';
const config = require('./src/config');
const db = require('./src/db');
const { createApp } = require('./src/app');
const { seedIfEmpty, DEMO_ACCOUNTS } = require('./src/seed');
const scheduler = require('./src/services/scheduler');

(async () => {
  await db.init({ file: config.dbFile });
  const seeded = seedIfEmpty();
  const app = createApp();
  scheduler.start();
  app.listen(config.port, () => {
    console.log(`\n  Pickabite berjalan di http://localhost:${config.port}\n`);
    if (seeded) {
      console.log('  Akun demo:');
      for (const a of DEMO_ACCOUNTS) console.log(`   - ${a.peran.padEnd(28)} ${a.login.padEnd(44)} ${a.password}`);
      console.log('');
    }
  });
})().catch((err) => {
  console.error('Gagal menjalankan server:', err);
  process.exit(1);
});
