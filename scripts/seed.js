'use strict';
/** Mengosongkan basis data lalu mengisi ulang data demo: npm run seed */
const config = require('../src/config');
const db = require('../src/db');
const { seed, DEMO_ACCOUNTS } = require('../src/seed');

(async () => {
  await db.init({ file: config.dbFile, reset: true });
  seed();
  console.log('Basis data direset di', config.dbFile);
  console.table(DEMO_ACCOUNTS);
})();
