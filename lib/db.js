import { Pool } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
export const q = (text, params = []) => pool.query(text, params);
export async function withTx(fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await fn((text, params=[]) => client.query(text, params)); await client.query('COMMIT'); return result; }
  catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}
