// MySQL connection pool + small helpers.
require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'campus_lost_found',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: false,
  dateStrings: true, // keep DATE/TIME as strings, avoids TZ surprises
});

/** Run a query, return rows (or result info for DML). */
async function q(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/** Run a set of queries inside one transaction. fn gets a connection. */
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function getMatchThreshold() {
  const rows = await q(
    'SELECT env_value FROM app_settings WHERE env_key = ?',
    ['MATCH_THRESHOLD']
  );
  return rows.length ? Number(rows[0].env_value) : 50;
}

module.exports = { pool, q, withTransaction, getMatchThreshold };
