const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  
  try {
    const users = await pool.query('SELECT id, email, role, email_verified, name FROM users ORDER BY id');
    console.log('Users:', JSON.stringify(users.rows, null, 2));
    
    // Verify passwords
    for (const u of users.rows) {
      const pwd = await pool.query('SELECT password FROM users WHERE id = $1', [u.id]);
      const hash = pwd.rows[0].password;
      console.log(`\nUser ${u.email}:`);
      console.log(`  Hash: ${hash.substring(0, 30)}...`);
      console.log(`  admin123: ${bcrypt.compareSync('admin123', hash)}`);
      console.log(`  123456: ${bcrypt.compareSync('123456', hash)}`);
    }
  } catch(e) {
    console.error('Error:', e);
  }
  
  await pool.end();
}

main();
