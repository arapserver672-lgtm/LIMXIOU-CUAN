
export default async function handler(req, res) {
  const tests = [
    ['db.mjs', () => import('../lib/db.mjs')],
    ['telegram.mjs', () => import('../lib/telegram.mjs')],
    ['task-rates.mjs', () => import('../lib/task-rates.mjs')],
    ['deposit-fees.mjs', () => import('../lib/deposit-fees.mjs')],
    ['webhook.mjs', () => import('./webhook.mjs')]
  ];

  const results = [];

  for (const [name, load] of tests) {
    try {
      await load();
      results.push({ file: name, ok: true });
    } catch (error) {
      results.push({
        file: name,
        ok: false,
        error: error.message,
        stack: error.stack
      });
    }
  }

  res.status(200).json({ results });
}
