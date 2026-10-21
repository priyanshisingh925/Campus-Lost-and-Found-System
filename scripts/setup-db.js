// One-command database setup:
//   node scripts/setup-db.js      (or: npm run setup)
//
// Runs the four SQL scripts in order, then sets bcrypt passwords for the
// seeded admin accounts and does an initial SP_REFRESH_MATCHES() run.
//
// Note: mysql2 does not understand the mysql-client `DELIMITER` directive,
// so this script includes a tiny parser that splits the SQL files into
// individual statements while honouring DELIMITER blocks.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const SQL_DIR = path.join(__dirname, '..', 'sql');
const FILES = ['01_schema.sql', '02_programmability.sql', '04_seed.sql', '03_queries.sql'];
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

/** Split a .sql file into statements, honouring custom DELIMITER blocks. */
function splitSqlStatements(raw) {
  const statements = [];
  let delimiter = ';';
  let current = '';

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine;

    const delimMatch = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (delimMatch) {
      if (current.trim()) statements.push({ sql: current.trim(), delimiter });
      current = '';
      delimiter = delimMatch[1];
      continue;
    }

    current += line + '\n';

    // count occurrences of the current delimiter at line ends
    if (delimiter !== ';') {
      while (current.trimEnd().endsWith(delimiter)) {
        const idx = current.lastIndexOf(delimiter);
        const stmt = current.slice(0, idx).trim();
        if (stmt) statements.push({ sql: stmt, delimiter: ';' });
        current = '';
      }
    } else {
      // simple split on ';' at end of statement — handle multi-line
      if (/;\s*$/.test(line.trimEnd())) {
        const stmt = current.trim();
        if (stmt) statements.push({ sql: stmt, delimiter: ';' });
        current = '';
      }
    }
  }
  if (current.trim()) statements.push({ sql: current.trim(), delimiter });
  return statements;
}

/** Strip full-line comments for execution decisions only (keeps statement text intact). */
function isExecutable(stmt) {
  const noComments = stmt.sql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
    .trim();
  if (!noComments) return false;
  // skip pure SELECT demo blocks from 03_queries.sql (no side effects anyway,
  // but avoids noisy result printing during setup)
  return !/^SELECT\b/i.test(noComments);
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    multipleStatements: true,
  });

  console.log('→ Connected to MySQL.');

  for (const file of FILES) {
    const full = path.join(SQL_DIR, file);
    if (!fs.existsSync(full)) {
      console.error(`  ✗ missing file: ${file}`);
      process.exit(1);
    }
    console.log(`→ Running ${file} ...`);
    const raw = fs.readFileSync(full, 'utf8');

    for (const stmt of splitSqlStatements(raw)) {
      if (!isExecutable(stmt)) continue;
      try {
        await conn.query(stmt.sql);
      } catch (err) {
        console.error(`\n✗ Error in ${file}:\n---\n${stmt.sql.slice(0, 400)}\n---`);
        console.error(err.message);
        process.exit(1);
      }
    }
    console.log(`  ✓ ${file} done`);
  }

  // ---- admin passwords -------------------------------------------------
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  const [res] = await conn.query(
    "UPDATE campus_lost_found.users SET password_hash = ? WHERE role = 'ADMIN'",
    [hash]
  );
  console.log(`→ Admin passwords set (${res.affectedRows} admin(s), password: "${ADMIN_PASSWORD}").`);

  // ---- initial match generation ----------------------------------------
  await conn.query('CALL campus_lost_found.SP_REFRESH_MATCHES()');
  const [mrows] = await conn.query(
    'SELECT COUNT(*) AS n FROM campus_lost_found.matches'
  );
  console.log(`→ SP_REFRESH_MATCHES() run; matches in table: ${mrows[0].n}`);

  // ---- quick sanity output ----------------------------------------------
  const [counts] = await conn.query(`
    SELECT
      (SELECT COUNT(*) FROM campus_lost_found.users)        AS users,
      (SELECT COUNT(*) FROM campus_lost_found.items)        AS items,
      (SELECT COUNT(*) FROM campus_lost_found.lost_reports) AS lost,
      (SELECT COUNT(*) FROM campus_lost_found.found_reports) AS found,
      (SELECT COUNT(*) FROM campus_lost_found.matches)      AS matches
  `);
  console.log('→ Seed summary:', counts[0]);
  console.log('\nSetup complete ✔  Now start the app with:  npm start');
  await conn.end();
}

main().catch((err) => {
  console.error('\n✗ Setup failed:', err.message);
  console.error('  Is MySQL running, and are DB_USER/DB_PASS in .env correct?');
  process.exit(1);
});
