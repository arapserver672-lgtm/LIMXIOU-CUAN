
import { tg } from '../lib/telegram.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false });
  }

  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const secret = String(process.env.WEBHOOK_SECRET || '');

  if (!base || !secret) {
    return res.status(400).json({ ok: false, error: 'Missing configuration' });
  }

  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    return res.status(400).json({ ok: false, error: 'Invalid secret format' });
  }

  try {
    const result = await tg('setWebhook', {
      url: `${base}/api/webhook`,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false
    });

    return res.status(200).json({
      ok: true,
      message: 'Webhook berhasil dipasang',
      result,
      webhook: `${base}/api/webhook`
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
