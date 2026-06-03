const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') console.log('PostgreSQL 연결됨');
});

pool.on('error', (err) => {
  console.error('PostgreSQL 오류:', err);
  process.exit(-1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
