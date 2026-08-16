import { pool } from './db.js';

async function run() {
  try {
    const result = await pool.query('SELECT * FROM config');
    console.log("All configurations in DB:");
    for (const row of result.rows) {
      console.log(`Key: ${row.key}`);
      // Mask API keys in console printout
      const val = row.value;
      if (val && typeof val === 'object') {
        const masked = { ...val };
        if (masked.apiKey) masked.apiKey = masked.apiKey.substring(0, 10) + '...';
        if (masked.providers && Array.isArray(masked.providers)) {
          masked.providers = masked.providers.map(p => ({
            ...p,
            apiKey: p.apiKey ? p.apiKey.substring(0, 10) + '...' : undefined
          }));
        }
        console.log(JSON.stringify(masked, null, 2));
      } else {
        console.log(JSON.stringify(val, null, 2));
      }
      console.log("-------------------");
    }
  } catch (err) {
    console.error("Failed to read configs:", err);
  } finally {
    await pool.end();
  }
}

run();
