// Migrasi otomatis (idempotent). Aman dijalankan berulang kali.
// Menambah kolom/tabel yang dibutuhkan webhook baru.
import { q } from './db.js';

const STATEMENTS = [
  // users
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS blacklisted BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS test_seeded BOOLEAN NOT NULL DEFAULT FALSE`,

  // deposits (kolom lama dipastikan ada + kolom baru)
  `ALTER TABLE deposits ADD COLUMN IF NOT EXISTS fee BIGINT NOT NULL DEFAULT 0`,
  `ALTER TABLE deposits ADD COLUMN IF NOT EXISTS total_paid BIGINT`,
  `ALTER TABLE deposits ADD COLUMN IF NOT EXISTS method TEXT`,
  `ALTER TABLE deposits ADD COLUMN IF NOT EXISTS proof_file_id TEXT`,
  `ALTER TABLE deposits ADD COLUMN IF NOT EXISTS proof_text TEXT`,
  `ALTER TABLE deposits ADD COLUMN IF NOT EXISTS proof_file_type TEXT`,
  `ALTER TABLE deposits ADD COLUMN IF NOT EXISTS proof_file_unique_id TEXT`,
  `ALTER TABLE deposits ADD COLUMN IF NOT EXISTS unique_code INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE deposits ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`,
  `ALTER TABLE deposits ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,

  // withdrawals
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS method TEXT`,
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS account_number TEXT`,
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS account_name TEXT`,
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS channel_msg_id BIGINT`,
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`,
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,

  // angpao
  `ALTER TABLE angpaos ADD COLUMN IF NOT EXISTS channel_msg_id BIGINT`,

  // tabel baru
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS deposit_proofs (
     file_unique_id TEXT PRIMARY KEY,
     user_id BIGINT NOT NULL,
     deposit_id INTEGER,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE TABLE IF NOT EXISTS deposit_bonuses (
     id SERIAL PRIMARY KEY,
     user_id BIGINT NOT NULL,
     kind TEXT NOT NULL,
     amount BIGINT NOT NULL,
     deposit_id INTEGER,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (user_id, kind)
   )`
];

let running = null;

export function ensureSchema() {
  if (!running) {
    running = (async () => {
      for (const sql of STATEMENTS) {
        try {
          await q(sql);
        } catch (e) {
          console.error('Schema step failed:', e.message, '\n', sql.slice(0, 80));
        }
      }
    })();
  }
  return running;
}
