const api = () => `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
export async function tg(method, payload = {}) {
  const r = await fetch(`${api()}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
  });
  const data = await r.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || 'unknown error'}`);
  return data.result;
}
export const send = (chat_id, text, reply_markup) => tg('sendMessage', {
  chat_id, text, parse_mode: 'HTML', ...(reply_markup ? { reply_markup } : {})
});
export const answer = (callback_query_id, text) => tg('answerCallbackQuery', {
  callback_query_id, text, show_alert: false
});
