
import { tg } from '../lib/telegram.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, method: 'POST required' });
  }

  if (
    !process.env.SETUP_SECRET ||
    req.headers['x-setup-secret'] !== process.env.SETUP_SECRET
  ) {
    return res.status(401).json({ ok: false });
  }

  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const secret = String(process.env.WEBHOOK_SECRET || '');

  if (!base || !secret) {
    return res.status(400).json({
      ok: false,
      error: 'PUBLIC_BASE_URL and WEBHOOK_SECRET are required'
    });
  }

  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    return res.status(400).json({
      ok: false,
      error: 'WEBHOOK_SECRET format is invalid'
    });
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
      result,
      webhook: `${base}/api/webhook`
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      ok: false,
      error: e.message
    });
  }
}
