const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const users = await pool.query('SELECT id, email, role FROM users');
  for (const row of users.rows) {
    const pwd = await pool.query('SELECT password FROM users WHERE id = $1', [row.id]);
    const hash = pwd.rows[0].password;
    console.log(`${row.email} [${row.role}]:`);
    console.log(`  hash: ${hash.substring(0, 40)}...`);
    console.log(`  admin123 match: ${bcrypt.compareSync('admin123', hash)}`);
    console.log(`  123456 match: ${bcrypt.compareSync('123456', hash)}`);
  }
  pool.end();
}

main().catch(e => { console.error(e); pool.end(); });
