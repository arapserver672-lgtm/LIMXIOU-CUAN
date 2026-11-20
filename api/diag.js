export default async function handler(req, res) {
  const tests = [
    ['db.js', () => import('../lib/db.js')],
    ['telegram.js', () => import('../lib/telegram.js')],
    ['task-rates.js', () => import('../lib/task-rates.js')],
    ['deposit-fees.js', () => import('../lib/deposit-fees.js')]
  ];

  for (const [name, run] of tests) {
    try {
      await run();
    } catch (e) {
      return res.status(500).json({
        failed_file: name,
        error: e.message,
        stack: e.stack
      });
    }
  }

  return res.status(200).json({
    ok: true,
    message: 'Semua modul berhasil dimuat'
  });
}
