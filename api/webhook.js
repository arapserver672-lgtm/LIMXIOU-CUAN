import { q, withTx } from '../lib/db.js';
import { tg } from '../lib/telegram.js';
import {
  TASK_RATES, calculateTaskBudget, workerPayout, validateTarget,
  rupiah, SERVICE_TAX_RATE, WORKER_TAX_RATE
} from '../lib/task-rates.js';
import {
  calculateDepositFee, MIN_DEPOSIT, MAX_DEPOSIT, FEE_TIERS,
  percentBonus, BONUS_PERCENT, BONUS_MILESTONES
} from '../lib/deposit-fees.js';
import { ensureSchema } from '../lib/schema.js';

// ───────────────────────── Konfigurasi ─────────────────────────
const ADMIN = String(process.env.ADMIN_ID || '');
const CHANNEL = process.env.CHANNEL_ID || '@informasilmxoucuan';
const GROUPS = [
  process.env.GROUP1_ID || '@groupdiskusixiolim',
  process.env.GROUP2_ID || '@backupgroupxio'
];
const BOT_USERNAME = String(process.env.BOT_USERNAME || '').replace(/^@/, '');
const QRIS_MERCHANT = process.env.QRIS_MERCHANT || 'XIOLIM, PULSA & INTERNET';
const ADMIN_TEST_BALANCE = 9_999_000;
const ALLOW_ADMIN_WD = process.env.ALLOW_ADMIN_WD === '1';

const WD_MIN = 5000;
const WD_FEE = 3000;
const WALLETS = {
  dana: 'DANA',
  gopay: 'GoPay',
  ovo: 'OVO',
  shopeepay: 'ShopeePay',
  bank: 'Bank'
};

// ───────────────────────── Helper umum ─────────────────────────
const money = rupiah;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const kb = rows => ({ inline_keyboard: rows });
const isAdmin = id => String(id) === ADMIN;
const pct = r => `${Math.round(r * 100)}%`;
const num = txt => Number(String(txt).replace(/[.\s,]/g, ''));
const fmtTime = d => new Date(d || Date.now()).toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta', hour12: false
});

const maskName = s => {
  const t = String(s || 'User');
  if (t.length <= 2) return t[0] + '*';
  return t.slice(0, 2) + '*'.repeat(Math.min(5, t.length - 3)) + t.slice(-1);
};
const maskAcct = s => {
  const t = String(s || '');
  return t.length <= 7 ? t.slice(0, 2) + '***' : t.slice(0, 4) + '****' + t.slice(-3);
};

// ───────────────────────── Telegram wrapper ─────────────────────────
const send = (chat, text, markup) => tg('sendMessage', {
  chat_id: chat,
  text,
  parse_mode: 'HTML',
  disable_web_page_preview: true,
  ...(markup ? { reply_markup: markup } : {})
});

// Kirim ke user lain tanpa melempar error (user bisa saja memblokir bot).
const dm = (chat, text, markup) =>
  send(chat, text, markup).catch(e => {
    console.error('DM failed', chat, e.message);
    return null;
  });

// Kirim teks + file (foto/dokumen) dengan caption dan tombol sekaligus.
async function sendWithFile(chat, text, markup, fileId, fileType) {
  if (fileId) {
    try {
      const isDoc = fileType === 'document';
      return await tg(isDoc ? 'sendDocument' : 'sendPhoto', {
        chat_id: chat,
        [isDoc ? 'document' : 'photo']: fileId,
        caption: text,
        parse_mode: 'HTML',
        ...(markup ? { reply_markup: markup } : {})
      });
    } catch (e) {
      console.error('File send failed:', e.message);
      text += '\n\n⚠️ File bukti gagal dilampirkan.';
    }
  }
  return send(chat, text, markup);
}

// Edit pesan (teks atau caption) dan hapus tombol bila markup tidak diberikan.
async function edit(chatId, messageId, text, markup, media = false) {
  const body = {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'HTML',
    reply_markup: markup || { inline_keyboard: [] }
  };
  try {
    if (media) {
      await tg('editMessageCaption', { ...body, caption: text });
    } else {
      await tg('editMessageText', { ...body, text, disable_web_page_preview: true });
    }
  } catch (e) {
    if (!/not modified/i.test(e.message || '')) {
      console.error('Edit failed:', e.message);
    }
  }
}

const editCb = (c, text, markup) =>
  edit(
    c.message.chat.id,
    c.message.message_id,
    text,
    markup,
    !!(c.message.photo || c.message.document)
  );

async function adminNotify(text, markup) {
  if (ADMIN) await dm(ADMIN, text, markup);
}

async function channelPost(text, markup) {
  try {
    return await send(CHANNEL, text, markup);
  } catch (e) {
    console.error('Channel post failed:', e.message);
    return null;
  }
}

const channelEdit = (msgId, text, markup) =>
  msgId ? edit(CHANNEL, msgId, text, markup) : Promise.resolve();

async function notifyAll(text, markup) {
  const r = await q('SELECT telegram_id FROM users');
  let ok = 0;
  let failed = 0;
  for (const u of r.rows) {
    try {
      await send(u.telegram_id, text, markup);
      ok++;
    } catch {
      failed++;
    }
  }
  return { ok, failed };
}

// ───────────────────────── Menu ─────────────────────────
const mainRows = [
  [{ text: '📋 Ambil Tugas', callback_data: 'tasks' },
   { text: '🧾 Buat Tugas', callback_data: 'create_task' }],
  [{ text: '💰 Dompet', callback_data: 'wallet' },
   { text: '➕ Deposit', callback_data: 'deposit' }],
  [{ text: '📤 Withdraw', callback_data: 'withdraw' },
   { text: '🎁 Angpao', callback_data: 'angpao' }],
  [{ text: '👥 Referral', callback_data: 'referral' },
   { text: '📜 Riwayat', callback_data: 'history' }],
  [{ text: '🗂 Tugas Saya', callback_data: 'mytasks' },
   { text: '🏆 Leaderboard', callback_data: 'leaderboard' }],
  [{ text: 'ℹ️ Tentang', callback_data: 'about' }]
];

const menu = id => kb([
  ...mainRows,
  ...(isAdmin(id) ? [[{ text: '🛠 Admin Panel', callback_data: 'admin' }]] : [])
]);

const adminMenu = kb([
  [{ text: '💳 Deposit pending', callback_data: 'adm_deposits' },
   { text: '📤 WD pending', callback_data: 'adm_wds' }],
  [{ text: '🧾 Bukti tugas', callback_data: 'adm_proofs' },
   { text: '📋 Kelola tugas', callback_data: 'adm_tasks' }],
  [{ text: '🎁 Buat angpao', callback_data: 'adm_angpao' },
   { text: '📊 Statistik', callback_data: 'adm_stats' }],
  [{ text: '🖼 Atur QRIS', callback_data: 'adm_qris' },
   { text: '📣 Pengumuman', callback_data: 'adm_broadcast' }],
  [{ text: '🏠 Menu utama', callback_data: 'home' }]
]);

const ADMIN_PANEL_TEXT =
  '🛠 <b>Admin Panel LIMXIOCUAN</b>\n\n' +
  'Perintah:\n' +
  '/setqris — pasang gambar QRIS deposit\n' +
  '/setsaldo &lt;id&gt; &lt;nominal&gt; — atur saldo user\n' +
  '/isisaldo — isi ulang saldo uji admin\n' +
  '/unban &lt;id&gt; — buka blokir user';

const cancelRow = [{ text: '❌ Batal', callback_data: 'cancel_flow' }];

const categoryRows = () => [
  ...Object.entries(TASK_RATES).map(([key, r]) => [{
    text: `${r.icon} ${r.label} - ${money(r.reward)}`,
    callback_data: `category:${key}`
  }]),
  [{ text: '❌ BATAL', callback_data: 'cancel_flow' }]
];

// ───────────────────────── State & user ─────────────────────────
async function st(id) {
  const r = await q('SELECT state,data FROM user_states WHERE telegram_id=$1', [id]);
  return r.rows[0] || null;
}

async function setSt(id, state, data = {}) {
  await q(`
    INSERT INTO user_states(telegram_id,state,data)
    VALUES($1,$2,$3::jsonb)
    ON CONFLICT(telegram_id)
    DO UPDATE SET state=$2,data=$3::jsonb,updated_at=NOW()
  `, [id, state, JSON.stringify(data)]);
}

const clearSt = id => q('DELETE FROM user_states WHERE telegram_id=$1', [id]);

async function upsertUser(f) {
  await q(`
    INSERT INTO users(telegram_id,username,first_name)
    VALUES($1,$2,$3)
    ON CONFLICT(telegram_id)
    DO UPDATE SET username=$2,first_name=$3
  `, [f.id, f.username || null, f.first_name || '']);

  // Saldo uji admin: diisi sekali.
  if (isAdmin(f.id)) {
    const r = await q(`
      UPDATE users SET balance=$2,test_seeded=TRUE
      WHERE telegram_id=$1 AND test_seeded=FALSE
      RETURNING telegram_id
    `, [f.id, ADMIN_TEST_BALANCE]);
    if (r.rows.length) {
      await q(
        `INSERT INTO transactions(user_id,type,amount,note) VALUES($1,'admin_test_balance',$2,'Saldo uji admin')`,
        [f.id, ADMIN_TEST_BALANCE]
      );
    }
  }
}

async function displayName(userId) {
  const r = await q('SELECT username,first_name FROM users WHERE telegram_id=$1', [userId]);
  const u = r.rows[0];
  return u?.username || u?.first_name || String(userId).slice(-4);
}

async function balanceOf(id) {
  const r = await q('SELECT balance FROM users WHERE telegram_id=$1', [id]);
  return Number(r.rows[0]?.balance || 0);
}

async function getSetting(key) {
  const r = await q('SELECT value FROM settings WHERE key=$1', [key]);
  return r.rows[0]?.value || null;
}

const setSetting = (key, value) => q(`
  INSERT INTO settings(key,value) VALUES($1,$2)
  ON CONFLICT(key) DO UPDATE SET value=$2
`, [key, value]);

async function txLog(tx, user, type, amount, note) {
  await tx(
    'INSERT INTO transactions(user_id,type,amount,note) VALUES($1,$2,$3,$4)',
    [user, type, amount, note]
  );
}

// ───────────────────────── Akses & keanggotaan ─────────────────────────
async function member(id) {
  for (const chat of [CHANNEL, ...GROUPS]) {
    try {
      const m = await tg('getChatMember', { chat_id: chat, user_id: id });
      if (
        !['creator', 'administrator', 'member'].includes(m.status) &&
        !(m.status === 'restricted' && m.is_member)
      ) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function isBlacklisted(id) {
  const r = await q('SELECT blacklisted FROM users WHERE telegram_id=$1', [id]);
  return !!r.rows[0]?.blacklisted;
}

async function gate(chat, id) {
  if (isAdmin(id)) return true;

  if (await isBlacklisted(id)) {
    await dm(chat, '🚫 Akun lu diblokir. Hubungi admin kalau ini kesalahan.');
    return false;
  }

  if (await member(id)) return true;

  await dm(
    chat,
    '🔒 <b>Akses terkunci.</b>\nGabung ke channel dan kedua grup, lalu tekan cek keanggotaan.',
    kb([
      [{ text: '📢 Channel', url: process.env.CHANNEL_URL || 'https://t.me/informasilmxoucuan' }],
      [{ text: '👥 Grup 1', url: process.env.GROUP1_URL || 'https://t.me/groupdiskusixiolim' },
       { text: '👥 Grup 2', url: process.env.GROUP2_URL || 'https://t.me/backupgroupxio' }],
      [{ text: '✅ Cek keanggotaan', callback_data: 'check_join' }]
    ])
  );
  return false;
}

// ───────────────────────── Bukti (foto/dokumen) ─────────────────────────
function getProof(m, { imageOnly = false } = {}) {
  if (m.photo?.length) {
    const p = m.photo[m.photo.length - 1];
    return { fileId: p.file_id, uniqueId: p.file_unique_id, type: 'photo' };
  }
  if (m.document && (!imageOnly || String(m.document.mime_type || '').startsWith('image/'))) {
    return {
      fileId: m.document.file_id,
      uniqueId: m.document.file_unique_id,
      type: 'document'
    };
  }
  return null;
}

// ───────────────────────── Teks status (admin & channel) ─────────────────────────
const depText = (x, status = '') =>
  `💳 <b>Deposit #${x.id}</b>${status ? ' — ' + status : ''}\n` +
  `User: <code>${x.user_id}</code>\n` +
  `Saldo masuk: ${money(x.amount)}\n` +
  `Biaya admin: ${money(x.fee)}\n` +
  `Kode unik: ${Number(x.unique_code || 0)}\n` +
  `<b>Harus masuk di mutasi: ${money(x.total_paid)}</b>\n` +
  `Waktu: ${fmtTime(x.created_at)}`;

const wdText = (x, status = '') =>
  `📤 <b>WD #${x.id}</b>${status ? ' — ' + status : ''}\n` +
  `User: <code>${x.user_id}</code>\n` +
  (x.account_number
    ? `Metode: ${esc(x.method)}\nNomor: <code>${esc(x.account_number)}</code>\nNama: ${esc(x.account_name)}\n`
    : `Tujuan: ${esc(x.destination)}\n`) +
  `Nominal ditahan: ${money(x.amount)}\n` +
  `Fee: ${money(x.fee)}\n` +
  `<b>Transfer bersih: ${money(x.net_amount)}</b>`;

const wdChannelText = (x, name, status) =>
  `📤 <b>WITHDRAW BARU</b>\n\n` +
  `User: ${esc(maskName(name))}\n` +
  `Nominal: ${money(x.net_amount)}\n` +
  `Metode: ${esc(x.method || 'Transfer')}${x.account_number ? ` (${esc(maskAcct(x.account_number))})` : ''}\n` +
  `Status: ${status}`;

const depButtons = id => kb([[
  { text: '✅ Setujui', callback_data: `dep_ok:${id}` },
  { text: '❌ Tolak', callback_data: `dep_no:${id}` }
]]);

const wdPendingButtons = id => kb([[
  { text: '✅ Setujui untuk transfer', callback_data: `wd_ok:${id}` },
  { text: '❌ Tolak & refund', callback_data: `wd_no:${id}` }
]]);

const wdApprovedButtons = id => kb([[
  { text: '✅ Transfer sudah dilakukan', callback_data: `wd_done:${id}` },
  { text: '❌ Tolak & refund', callback_data: `wd_no:${id}` }
]]);

const proofButtons = id => kb([[
  { text: '✅ Approve', callback_data: `proof_ok:${id}` },
  { text: '❌ Reject', callback_data: `proof_no:${id}` }
]]);

const proofText = (x, status = '') =>
  `🧾 <b>Bukti tugas #${x.id}</b>${status ? ' — ' + status : ''}\n` +
  `Task: #${x.task_id}${x.title ? ' ' + esc(x.title) : ''}\n` +
  `User: <code>${x.user_id}</code>\n` +
  `${esc(x.proof_text || 'Bukti file terlampir')}`;

// ───────────────────────── Tugas ─────────────────────────
function taskCard(t) {
  const price = Number(t.reward || t.worker_reward || 0);
  const net = Number(t.worker_reward || Math.floor(price * 0.95));
  const rewardLine = net === price
    ? money(price)
    : `${money(price)} (masuk saldo ${money(net)} setelah pajak ${pct(WORKER_TAX_RATE)})`;
  return (
    `📋 <b>#${t.id} ${esc(t.title)}</b>\n` +
    `Kategori: ${esc(t.category)}\n` +
    `Bayaran: ${rewardLine}\n` +
    `Slot tersisa: ${Math.max(0, Number(t.slots) - Number(t.claimed))}`
  );
}

const taskTargetLabel = c => ({
  whatsapp: 'nomor WhatsApp tujuan (contoh: 628123456789)',
  telegram: 'link Telegram (t.me/...)',
  channel: 'link channel Telegram (t.me/...)',
  group: 'link grup Telegram (t.me/...)',
  follow: 'link profil TikTok'
}[c] || 'link video TikTok');

async function showTask(chat, tid) {
  const r = await q(`
    SELECT id,title,category,reward,worker_reward,slots,claimed,status
    FROM tasks WHERE id=$1
  `, [tid]);
  const t = r.rows[0];
  if (!t || t.status !== 'open' || Number(t.claimed) >= Number(t.slots)) {
    await send(chat, 'Tugas tidak tersedia atau slot sudah habis.');
    return;
  }
  await send(chat, taskCard(t), kb([[
    { text: '📥 Ambil Tugas', callback_data: `take:${t.id}` }
  ]]));
}

async function publishTask(task, rate) {
  const button = BOT_USERNAME
    ? { text: '📥 Ambil Tugas di Bot', url: `https://t.me/${BOT_USERNAME}?start=task_${task.id}` }
    : { text: '📥 Ambil Tugas', callback_data: `take:${task.id}` };

  const targetLine = rate.platform === 'whatsapp'
    ? `Nomor: ${esc(maskAcct(task.target_url))}`
    : `Link: ${esc(task.target_url)}`;

  await channelPost(
    `🔔 <b>TUGAS BARU TERSEDIA!</b> 🔔\n\n` +
    `Kategori: ${rate.icon} ${esc(rate.label)}\n` +
    `Bayaran: ${money(rate.reward)}\n` +
    `Slot: ${task.slots}\n` +
    `${targetLine}\n\n` +
    `Tap 📥 AMBIL TUGAS untuk mulai kerja!`,
    kb([[button]])
  );
}

async function createTask(chat, id, d) {
  const rate = TASK_RATES[d.category];
  if (!rate) {
    await clearSt(id);
    await send(chat, 'Kategori tidak valid.', menu(id));
    return;
  }

  const { net } = workerPayout(rate.reward);

  const created = await withTx(async tx => {
    const user = await tx(
      'SELECT balance FROM users WHERE telegram_id=$1 FOR UPDATE',
      [id]
    );
    if (!user.rows.length || Number(user.rows[0].balance) < Number(d.total_budget)) {
      throw new Error('SALDO');
    }

    await tx(
      'UPDATE users SET balance=balance-$1 WHERE telegram_id=$2',
      [d.total_budget, id]
    );

    const task = await tx(`
      INSERT INTO tasks(
        title,description,category,reward,worker_reward,
        funding_per_slot,slots,claimed,status,created_by,
        budget_locked,service_fee,total_budget,
        target_url,target_text,instructions
      )
      VALUES($1,$2,$3,$4,$5,$4,$6,0,'open',$7,$8,$9,$10,$11,$12,$2)
      RETURNING id
    `, [
      rate.title, rate.instructions, rate.label, rate.reward, net,
      d.slots, id, d.subtotal, d.service_fee, d.total_budget,
      d.target_url, d.target_text || null
    ]);

    await txLog(
      tx, id, 'task_budget', -Number(d.total_budget),
      `Anggaran tugas #${task.rows[0].id}, termasuk pajak ${pct(SERVICE_TAX_RATE)}`
    );
    return task.rows[0].id;
  }).catch(e => {
    if (e.message === 'SALDO') return null;
    throw e;
  });

  await clearSt(id);

  if (!created) {
    await send(chat, `❌ Saldo tidak cukup untuk membayar ${money(d.total_budget)}.`, menu(id));
    return;
  }

  await send(
    chat,
    `✅ <b>Tugas #${created} berhasil dibuat.</b>\n` +
    `Kategori: ${rate.icon} ${esc(rate.label)}\n` +
    `Slot: ${d.slots}\n` +
    `Biaya: ${money(d.subtotal)} + pajak ${pct(SERVICE_TAX_RATE)} ${money(d.service_fee)} = <b>${money(d.total_budget)}</b>`,
    menu(id)
  );

  await publishTask(
    { id: created, slots: d.slots, target_url: d.target_url },
    rate
  );
}

// ───────────────────────── Deposit ─────────────────────────
async function totalDeposit(id) {
  const r = await q(
    `SELECT COALESCE(SUM(amount),0) t FROM deposits WHERE user_id=$1 AND status='approved'`,
    [id]
  );
  return Number(r.rows[0].t);
}

async function depositScreen(id) {
  const [bal, total] = await Promise.all([balanceOf(id), totalDeposit(id)]);

  const fees = FEE_TIERS
    .map(t => `• ${money(t.min)} – ${money(t.max)} → ${money(t.fee)}`)
    .join('\n');

  const milestones = BONUS_MILESTONES
    .map(m => `• Total deposit ${money(m.totalDeposit)} → bonus saldo ${money(m.amount)} (${total >= m.totalDeposit ? 'sudah' : 'belum'})`)
    .join('\n');

  return (
    `💳 <b>DEPOSIT SALDO</b>\n\n` +
    `Saldo: ${money(bal)}\n` +
    `Minimal: ${money(MIN_DEPOSIT)} • Maksimal: ${money(MAX_DEPOSIT)}\n\n` +
    `Biaya admin:\n${fees}\n\n` +
    `🎁 <b>BONUS DEPOSIT</b> (otomatis)\n` +
    `• Setiap deposit minimal ${money(BONUS_PERCENT.minDeposit)} → bonus saldo ${BONUS_PERCENT.percent}% ` +
    `(contoh: deposit ${money(100000)} → bonus ${money(percentBonus(100000))})\n` +
    `${milestones}\n` +
    `Total deposit Anda: ${money(total)}\n\n` +
    `Ketik nominal deposit (angka saja, kelipatan Rp1.000, contoh: 50000).`
  );
}

async function pickUniqueCode(base) {
  const r = await q(`SELECT total_paid FROM deposits WHERE status='pending'`);
  const used = new Set(r.rows.map(x => Number(x.total_paid)));
  for (let i = 0; i < 60; i++) {
    const code = 1 + Math.floor(Math.random() * 99);
    if (!used.has(base + code)) return code;
  }
  return 1 + Math.floor(Math.random() * 99);
}

// ───────────────────────── Dompet / WD ─────────────────────────
async function walletScreen(chat, id) {
  const bal = await balanceOf(id);
  const testOnly = isAdmin(id) && !ALLOW_ADMIN_WD;

  const rows = testOnly ? [] : [
    [{ text: 'DANA', callback_data: 'wdm:dana' },
     { text: 'GoPay', callback_data: 'wdm:gopay' }],
    [{ text: 'OVO', callback_data: 'wdm:ovo' },
     { text: 'ShopeePay', callback_data: 'wdm:shopeepay' }],
    [{ text: '🏦 Bank', callback_data: 'wdm:bank' }]
  ];
  rows.push(cancelRow);

  await send(
    chat,
    `💰 <b>DOMPET SAYA</b>\n\n` +
    `Saldo: <b>${money(bal)}</b>${testOnly ? ' (saldo uji admin, tidak bisa ditarik)' : ''}\n\n` +
    `Penarikan:\n` +
    `• Minimal: ${money(WD_MIN)}\n` +
    `• Biaya admin: ${money(WD_FEE)} per transaksi\n` +
    `• Proses: disetujui admin, lalu ditransfer manual\n\n` +
    (testOnly ? '' : 'Pilih metode penarikan:'),
    kb(rows)
  );
}

// ───────────────────────── Pesan masuk ─────────────────────────
async function onMessage(m) {
  if (m.chat.type !== 'private') return;

  const f = m.from;
  const chat = m.chat.id;
  const id = f.id;
  const txt = (m.text || '').trim();

  await upsertUser(f);

  if (txt === '/cancel') {
    await clearSt(id);
    await send(chat, 'Proses dibatalkan.', menu(id));
    return;
  }

  if (txt.startsWith('/start')) {
    const param = txt.split(/\s+/)[1] || '';

    if (/^task_\d+$/.test(param)) {
      if (!(await gate(chat, id))) return;
      await showTask(chat, Number(param.slice(5)));
      return;
    }

    const ref = Number(param);
    if (ref && ref !== id) {
      await q(`
        UPDATE users SET referrer_id=$1
        WHERE telegram_id=$2 AND referrer_id IS NULL
      `, [ref, id]);
    }

    if (!(await gate(chat, id))) return;

    await send(
      chat,
      '👋 <b>Selamat datang di LIMXIOCUAN</b>\n\nPilih layanan dari menu. Gunakan /cancel untuk membatalkan input.',
      menu(id)
    );
    return;
  }

  // ── Perintah admin ──
  if (isAdmin(id)) {
    if (txt === '/admin') {
      await send(chat, ADMIN_PANEL_TEXT, adminMenu);
      return;
    }

    if (txt === '/setqris') {
      await setSt(id, 'set_qris');
      await send(chat, 'Kirim gambar QRIS sebagai <b>foto</b>. Gambar ini dipakai untuk semua deposit.');
      return;
    }

    if (txt === '/isisaldo') {
      await q('UPDATE users SET balance=$2 WHERE telegram_id=$1', [id, ADMIN_TEST_BALANCE]);
      await send(chat, `Saldo uji admin diisi ulang ke ${money(ADMIN_TEST_BALANCE)}.`);
      return;
    }

    if (txt.startsWith('/setsaldo')) {
      const [, uid, nominal] = txt.split(/\s+/);
      const user = Number(uid);
      const amount = Number(nominal);
      if (!Number.isSafeInteger(user) || !Number.isSafeInteger(amount) || amount < 0) {
        await send(chat, 'Format: /setsaldo &lt;id user&gt; &lt;nominal&gt;');
        return;
      }
      const old = await withTx(async tx => {
        const r = await tx('SELECT balance FROM users WHERE telegram_id=$1 FOR UPDATE', [user]);
        if (!r.rows.length) return null;
        const before = Number(r.rows[0].balance);
        await tx('UPDATE users SET balance=$1 WHERE telegram_id=$2', [amount, user]);
        await txLog(tx, user, 'admin_adjust', amount - before, `Admin set saldo ${money(before)} → ${money(amount)}`);
        return before;
      });
      await send(
        chat,
        old === null ? 'User tidak ditemukan.' : `Saldo ${user}: ${money(old)} → ${money(amount)}`
      );
      return;
    }

    if (txt.startsWith('/unban')) {
      const user = Number(txt.split(/\s+/)[1]);
      if (!Number.isSafeInteger(user)) {
        await send(chat, 'Format: /unban &lt;id user&gt;');
        return;
      }
      await q('UPDATE users SET blacklisted=FALSE WHERE telegram_id=$1', [user]);
      await send(chat, `User ${user} dibuka blokirnya.`);
      return;
    }
  }

  if (!(await gate(chat, id))) return;

  const s = await st(id);
  if (!s) {
    await send(chat, 'Pilih menu lewat /start.', menu(id));
    return;
  }

  const d = s.data || {};

  // ── Admin: pasang QRIS ──
  if (s.state === 'set_qris' && isAdmin(id)) {
    const file = getProof(m, { imageOnly: true });
    if (!file) {
      await send(chat, 'Kirim gambar QRIS sebagai foto.');
      return;
    }
    await setSetting('qris_file_id', file.fileId);
    await clearSt(id);
    await send(chat, '✅ QRIS tersimpan. Gambar ini yang dipakai saat user deposit.');
    return;
  }

  // ── Buat tugas: jumlah slot ──
  if (s.state === 'task_slots') {
    const rate = TASK_RATES[d.category];
    if (!rate) {
      await clearSt(id);
      await send(chat, 'Sesi tidak valid. Mulai lagi dari menu.', menu(id));
      return;
    }

    let budget;
    try {
      budget = calculateTaskBudget(rate.reward, num(txt), rate);
    } catch (e) {
      await send(chat, e.message);
      return;
    }

    const slots = num(txt);
    const bal = await balanceOf(id);
    const line = `Biaya: ${money(budget.subtotal)} + pajak ${pct(SERVICE_TAX_RATE)} ${money(budget.serviceFee)} = ${money(budget.total)}`;

    if (bal < budget.total) {
      await clearSt(id);
      await send(
        chat,
        `❌ Saldo kurang. ${line}\nSaldo ${money(bal)}\nIsi saldo lewat menu ➕ Deposit.`,
        kb([[{ text: '➕ Deposit', callback_data: 'deposit' }]])
      );
      return;
    }

    await setSt(id, 'task_target', {
      category: d.category,
      slots,
      subtotal: budget.subtotal,
      service_fee: budget.serviceFee,
      total_budget: budget.total
    });
    await send(chat, `${line}\nKirim ${taskTargetLabel(d.category)}:`, kb([cancelRow]));
    return;
  }

  // ── Buat tugas: link/nomor tujuan ──
  if (s.state === 'task_target') {
    const rate = TASK_RATES[d.category];
    if (!rate) {
      await clearSt(id);
      await send(chat, 'Sesi tidak valid. Mulai lagi dari menu.', menu(id));
      return;
    }

    const v = validateTarget(d.category, txt);
    if (!v.ok) {
      await send(chat, v.error);
      return;
    }

    if (rate.fields.includes('target_text')) {
      await setSt(id, 'task_target_text', { ...d, target_url: v.value });
      await send(
        chat,
        d.category === 'comment'
          ? 'Kirim teks komentar yang harus ditulis worker.'
          : 'Kirim pesan yang harus dikirim worker lewat WhatsApp.',
        kb([cancelRow])
      );
      return;
    }

    await createTask(chat, id, { ...d, target_url: v.value, target_text: null });
    return;
  }

  // ── Buat tugas: teks wajib ──
  if (s.state === 'task_target_text') {
    if (txt.length < 1 || txt.length > 1000) {
      await send(chat, 'Teks harus 1–1.000 karakter.');
      return;
    }
    await createTask(chat, id, { ...d, target_text: txt });
    return;
  }

  // ── Bukti tugas ──
  if (s.state === 'proof') {
    const file = getProof(m);

    if (!txt && !file) {
      await send(chat, 'Kirim screenshot foto atau dokumen sebagai bukti.');
      return;
    }

    if (file?.uniqueId) {
      const inserted = await q(`
        INSERT INTO proof_blacklist(file_unique_id,first_user_id,first_task_id)
        VALUES($1,$2,$3)
        ON CONFLICT(file_unique_id) DO NOTHING
        RETURNING id
      `, [file.uniqueId, id, d.task_id]);

      if (!inserted.rows.length) {
        const first = (await q(
          'SELECT first_user_id,first_task_id FROM proof_blacklist WHERE file_unique_id=$1',
          [file.uniqueId]
        )).rows[0];

        const sameSpot = first &&
          String(first.first_user_id) === String(id) &&
          String(first.first_task_id) === String(d.task_id);

        // Orang yang sama mengirim ulang file yang sama di tugas yang sama: tolak saja.
        // File dipakai user/tugas lain: auto-blacklist (kecuali admin).
        if (sameSpot || isAdmin(id)) {
          await send(chat, '❌ File bukti ini pernah digunakan. Kirim screenshot bukti yang berbeda.');
          return;
        }

        await q('UPDATE users SET blacklisted=TRUE WHERE telegram_id=$1', [id]);
        await withTx(async tx => {
          const c = await tx(`
            UPDATE task_claims SET status='rejected',reviewed_at=NOW()
            WHERE id=$1 AND user_id=$2 AND status='claimed'
            RETURNING task_id
          `, [d.claim, id]);
          if (c.rows.length) {
            await tx(
              `UPDATE tasks SET claimed=GREATEST(0,claimed-1) WHERE id=$1 AND status='open'`,
              [c.rows[0].task_id]
            );
          }
        });
        await clearSt(id);

        const name = await displayName(id);
        await channelPost(
          `🚫 <b>Auto-blacklist</b> ${esc(maskName(name))} (<code>${maskAcct(id)}</code>): bukti screenshot sama.`
        );
        await adminNotify(`🚫 Auto-blacklist user <code>${id}</code> (${esc(name)}): bukti screenshot sama. Buka blokir dengan /unban ${id}`);
        await dm(chat, '🚫 Akun lu diblokir karena memakai bukti screenshot yang sudah pernah dipakai. Hubungi admin kalau ini kesalahan.');
        return;
      }
    }

    const r = await q(`
      UPDATE task_claims
      SET proof_text=$1,
          proof_file_id=$2,
          proof_file_unique_id=$3,
          proof_file_type=$4,
          status='pending'
      WHERE id=$5 AND user_id=$6 AND status='claimed'
      RETURNING id,task_id,user_id,proof_text
    `, [
      txt || null, file?.fileId || null, file?.uniqueId || null,
      file?.type || null, d.claim, id
    ]);

    await clearSt(id);

    if (!r.rows.length) {
      await send(chat, 'Klaim tidak ditemukan atau bukti sudah dikirim.');
      return;
    }

    const claim = r.rows[0];
    const title = (await q('SELECT title FROM tasks WHERE id=$1', [claim.task_id])).rows[0]?.title;

    await sendWithFile(
      ADMIN,
      proofText({ ...claim, title }, 'MENUNGGU'),
      proofButtons(claim.id),
      file?.fileId,
      file?.type
    ).catch(e => console.error('Proof to admin failed:', e.message));

    await send(chat, '✅ Bukti terkirim ke admin. Reward masuk setelah admin menyetujui.', menu(id));
    return;
  }

  // ── Deposit: nominal ──
  if (s.state === 'deposit_amount') {
    const n = num(txt);
    let fee;
    try {
      fee = calculateDepositFee(n);
    } catch (e) {
      await send(chat, e.message);
      return;
    }

    const qris = (await getSetting('qris_file_id')) || process.env.QRIS_FILE_ID;
    if (!qris) {
      await clearSt(id);
      await send(chat, '⚠️ QRIS belum diatur admin. Coba lagi nanti.', menu(id));
      await adminNotify(`⚠️ User <code>${id}</code> mau deposit tapi QRIS belum diatur. Kirim /setqris.`);
      return;
    }

    const code = await pickUniqueCode(n + fee);
    const total = n + fee + code;

    await setSt(id, 'deposit_proof', { amount: n, fee, code, total });

    try {
      await tg('sendPhoto', {
        chat_id: chat,
        photo: qris,
        parse_mode: 'HTML',
        caption:
          `💳 <b>DEPOSIT ${money(n)}</b>\n\n` +
          `Saldo masuk: ${money(n)}\n` +
          `Biaya admin: ${money(fee)}\n` +
          `Kode unik: ${code}\n` +
          `<b>Total transfer: ${money(total)}</b>\n\n` +
          `⚠️ Transfer <b>persis ${money(total)}</b> (termasuk kode unik) supaya mudah dicocokkan admin.\n` +
          `Scan QRIS di atas (nama penerima: ${esc(QRIS_MERCHANT)}).\n\n` +
          `Setelah bayar, kirim <b>foto bukti transfer</b> di chat ini.`,
        reply_markup: kb([cancelRow])
      });
    } catch (e) {
      console.error('QRIS send failed:', e.message);
      await clearSt(id);
      await send(chat, '⚠️ Gambar QRIS gagal dikirim. Coba lagi nanti.', menu(id));
      await adminNotify(`⚠️ Gagal kirim QRIS ke user <code>${id}</code>: ${esc(e.message)}. Pasang ulang dengan /setqris.`);
    }
    return;
  }

  // ── Deposit: bukti ──
  if (s.state === 'deposit_proof') {
    const file = getProof(m, { imageOnly: true });
    if (!file) {
      await send(chat, 'Kirim <b>foto</b> bukti transfer (bukan teks). Atau tekan Batal / ketik /cancel.', kb([cancelRow]));
      return;
    }

    const dup = await q(`
      INSERT INTO deposit_proofs(file_unique_id,user_id) VALUES($1,$2)
      ON CONFLICT DO NOTHING RETURNING file_unique_id
    `, [file.uniqueId, id]);

    if (!dup.rows.length) {
      await send(chat, '❌ Foto bukti ini pernah dipakai. Kirim bukti transfer yang baru.');
      await adminNotify(`⚠️ User <code>${id}</code> mengirim foto bukti deposit yang sudah pernah dipakai.`);
      return;
    }

    let dep;
    try {
      const r = await q(`
        INSERT INTO deposits(
          user_id,amount,fee,total_paid,unique_code,method,
          proof_file_id,proof_file_unique_id,proof_file_type
        )
        VALUES($1,$2,$3,$4,$5,'QRIS',$6,$7,$8)
        RETURNING *
      `, [id, d.amount, d.fee, d.total, d.code, file.fileId, file.uniqueId, file.type]);
      dep = r.rows[0];
    } catch (e) {
      await q('DELETE FROM deposit_proofs WHERE file_unique_id=$1', [file.uniqueId]);
      throw e;
    }

    await q('UPDATE deposit_proofs SET deposit_id=$1 WHERE file_unique_id=$2', [dep.id, file.uniqueId]);
    await clearSt(id);

    await send(
      chat,
      `✅ Bukti diterima. Deposit #${dep.id} menunggu verifikasi admin.\n` +
      `Total transfer: ${money(dep.total_paid)}\nKami kabari di sini setelah diproses.`,
      menu(id)
    );

    await sendWithFile(
      ADMIN,
      depText(dep, 'MENUNGGU'),
      depButtons(dep.id),
      file.fileId,
      file.type
    ).catch(e => console.error('Deposit to admin failed:', e.message));
    return;
  }

  // ── WD: nominal ──
  if (s.state === 'wd_amount') {
    const n = num(txt);
    if (!Number.isSafeInteger(n) || n < WD_MIN) {
      await send(chat, `Nominal WD minimal ${money(WD_MIN)}.`);
      return;
    }
    if ((await balanceOf(id)) < n) {
      await send(chat, 'Saldo tidak cukup.');
      return;
    }

    const label = WALLETS[d.method];
    const summary =
      `Nominal WD: ${money(n)}\nFee admin: ${money(WD_FEE)}\nDiterima: ${money(n - WD_FEE)}\n\n`;

    if (d.method === 'bank') {
      await setSt(id, 'wd_bank', { ...d, amount: n });
      await send(chat, `${summary}Kirim nama bank (contoh: BCA).`, kb([cancelRow]));
    } else {
      await setSt(id, 'wd_number', { ...d, amount: n });
      await send(chat, `${summary}Kirim nomor ${label} tujuan (angka saja).`, kb([cancelRow]));
    }
    return;
  }

  if (s.state === 'wd_bank') {
    if (txt.length < 2 || txt.length > 30) {
      await send(chat, 'Nama bank tidak valid.');
      return;
    }
    await setSt(id, 'wd_number', { ...d, bank_name: txt });
    await send(chat, 'Kirim nomor rekening (angka saja).', kb([cancelRow]));
    return;
  }

  if (s.state === 'wd_number') {
    const digits = txt.replace(/[\s\-.]/g, '');
    const isBank = d.method === 'bank';
    const ok = isBank ? /^\d{5,20}$/.test(digits) : /^\d{8,15}$/.test(digits);
    if (!ok) {
      await send(chat, isBank
        ? 'Nomor rekening tidak valid (5–20 digit).'
        : 'Nomor tidak valid (8–15 digit), contoh: 081234567890.');
      return;
    }
    await setSt(id, 'wd_name', { ...d, number: digits });
    await send(chat, 'Kirim nama pemilik akun (sesuai akun tujuan).', kb([cancelRow]));
    return;
  }

  if (s.state === 'wd_name') {
    if (txt.length < 2 || txt.length > 60) {
      await send(chat, 'Nama tidak valid (2–60 karakter).');
      return;
    }

    const methodLabel = d.method === 'bank' ? `Bank ${d.bank_name}` : WALLETS[d.method];
    await setSt(id, 'wd_confirm', { ...d, name: txt, method_label: methodLabel });

    await send(
      chat,
      `📤 <b>Konfirmasi Withdraw</b>\n\n` +
      `Metode: ${esc(methodLabel)}\n` +
      `Nomor: <code>${esc(d.number)}</code>\n` +
      `Nama: ${esc(txt)}\n` +
      `Nominal: ${money(d.amount)}\n` +
      `Fee admin: ${money(WD_FEE)}\n` +
      `<b>Diterima: ${money(d.amount - WD_FEE)}</b>\n\n` +
      `Periksa nomor sebelum konfirmasi. Saldo ditahan setelah lu menekan Konfirmasi.`,
      kb([
        [{ text: '✅ Konfirmasi', callback_data: 'wdsubmit' }],
        cancelRow
      ])
    );
    return;
  }

  // ── Angpao admin ──
  if (s.state === 'angpao_amount' && isAdmin(id)) {
    const n = num(txt);
    if (!Number.isSafeInteger(n) || n < 1000) {
      await send(chat, 'Total angpao minimal Rp1.000.');
      return;
    }
    await setSt(id, 'angpao_winners', { amount: n });
    await send(chat, 'Kirim jumlah pemenang angpao.');
    return;
  }

  if (s.state === 'angpao_winners' && isAdmin(id)) {
    const n = Number(txt);
    if (!Number.isInteger(n) || n < 1 || n > d.amount) {
      await send(chat, 'Jumlah pemenang tidak valid.');
      return;
    }

    const a = await q(`
      INSERT INTO angpaos(total_amount,winners,remaining_amount,remaining_winners,created_by)
      VALUES($1,$2,$1,$2,$3)
      RETURNING id
    `, [d.amount, n, id]);

    await clearSt(id);
    const aid = a.rows[0].id;

    const post = await channelPost(
      `🎁 <b>ANGPAO LIMXIOCUAN</b>\n` +
      `Total: ${money(d.amount)}\n` +
      `Jumlah pemenang: ${n}\n\n` +
      `Klik untuk klaim!`,
      kb([[{ text: '🎁 Ambil Angpao', callback_data: `claim_angpao:${aid}` }]])
    );
    if (post?.message_id) {
      await q('UPDATE angpaos SET channel_msg_id=$1 WHERE id=$2', [post.message_id, aid]);
    }

    await send(chat, `Angpao #${aid} dipublikasikan ke channel. Saldo admin tidak dipotong.`);
    return;
  }

  // ── Broadcast admin ──
  if (s.state === 'broadcast' && isAdmin(id)) {
    await clearSt(id);
    const text = `📣 <b>Pengumuman LIMXIOCUAN</b>\n\n${esc(txt)}`;
    const result = await notifyAll(text);
    await channelPost(text);
    await send(chat, `Broadcast selesai.\nTerkirim: ${result.ok}\nGagal: ${result.failed}`);
    return;
  }

  await send(chat, 'Input tidak dikenali. Gunakan /cancel lalu mulai lagi.', menu(id));
}

// ───────────────────────── Callback ─────────────────────────
async function onCallback(c) {
  let acked = false;
  const ack = (text, alert = false) => {
    if (acked) return Promise.resolve();
    acked = true;
    return tg('answerCallbackQuery', {
      callback_query_id: c.id,
      ...(text ? { text: String(text).slice(0, 190), show_alert: alert } : {})
    }).catch(() => {});
  };

  try {
    await handleCallback(c, ack);
  } finally {
    await ack();
  }
}

async function handleCallback(c, ack) {
  const id = c.from.id;
  const chat = id; // semua balasan ke DM user
  const data = c.data || '';
  const inPrivate = c.message?.chat?.type === 'private';

  await upsertUser(c.from);

  // Dari channel/grup: hanya klaim angpao & ambil tugas yang boleh.
  if (!inPrivate && !/^(claim_angpao|take):/.test(data)) return;
  if (inPrivate) await ack();

  // Pesan hasil: di DM kirim pesan, di channel pakai pop-up alert.
  const notice = text => inPrivate
    ? send(chat, text)
    : ack(text.replace(/<[^>]+>/g, ''), true);

  if (data === 'check_join') {
    if (await member(id)) {
      await send(chat, '✅ Keanggotaan terverifikasi.', menu(id));
    } else {
      await gate(chat, id);
    }
    return;
  }

  // Klaim angpao & ambil tugas dari channel: cek akses tanpa spam ke channel.
  if (!inPrivate) {
    if (!isAdmin(id)) {
      if (await isBlacklisted(id)) {
        await ack('Akun lu diblokir.', true);
        return;
      }
      if (!(await member(id))) {
        await ack('Gabung channel dan kedua grup dulu, lalu /start bot.', true);
        return;
      }
    }
  } else if (!(await gate(chat, id))) {
    return;
  }

  if (data === 'home') {
    await send(chat, 'Menu utama:', menu(id));
    return;
  }

  if (data === 'cancel_flow' || data === 'create_cancel') {
    await clearSt(id);
    await send(chat, 'Proses dibatalkan.', menu(id));
    return;
  }

  // ── Buat tugas ──
  if (data === 'create_task') {
    await setSt(id, 'task_category');
    await send(
      chat,
      `📥 <b>BUAT TUGAS BARU</b> 📥\n\nPilih kategori tugas:\n` +
      `Bayar per slot, saldo dipotong harga × jumlah slot + pajak ${pct(SERVICE_TAX_RATE)}.`,
      kb(categoryRows())
    );
    return;
  }

  if (data.startsWith('category:')) {
    const key = data.split(':')[1];
    const rate = TASK_RATES[key];
    if (!rate) {
      await send(chat, 'Kategori tidak dikenal.');
      return;
    }
    const s = await st(id);
    if (!s || s.state !== 'task_category') {
      await send(chat, 'Sesi pembuatan tugas tidak ditemukan. Mulai lagi dari menu.', menu(id));
      return;
    }
    await setSt(id, 'task_slots', { category: key });
    await send(
      chat,
      `${rate.icon} <b>${esc(rate.label)}</b> - ${money(rate.reward)}/slot\n\nBerapa slot? (${rate.min}-${rate.max})`,
      kb([cancelRow])
    );
    return;
  }

  // ── Lihat tugas ──
  if (data === 'tasks') {
    const r = await q(`
      SELECT id,title,category,worker_reward,reward,slots,claimed
      FROM tasks
      WHERE status='open' AND claimed<slots
      ORDER BY id DESC
      LIMIT 15
    `);
    if (!r.rows.length) {
      await send(chat, '😔 Belum ada tugas tersedia. Coba lagi nanti.');
      return;
    }
    for (const t of r.rows) {
      await send(chat, taskCard(t), kb([[{ text: '📥 Ambil Tugas', callback_data: `take:${t.id}` }]]));
    }
    return;
  }

  // ── Dompet & WD ──
  if (data === 'wallet' || data === 'withdraw') {
    await walletScreen(chat, id);
    return;
  }

  if (data.startsWith('wdm:')) {
    const key = data.split(':')[1];
    if (!WALLETS[key]) return;

    if (isAdmin(id) && !ALLOW_ADMIN_WD) {
      await send(chat, 'Saldo admin adalah saldo uji dan tidak bisa ditarik.');
      return;
    }

    await setSt(id, 'wd_amount', { method: key });
    await send(
      chat,
      `Metode: <b>${WALLETS[key]}</b>\nKirim nominal WD (minimal ${money(WD_MIN)}, biaya admin ${money(WD_FEE)}).`,
      kb([cancelRow])
    );
    return;
  }

  if (data === 'wdsubmit') {
    const s = await st(id);
    if (!s || s.state !== 'wd_confirm') {
      await send(chat, 'Sesi WD tidak ditemukan. Mulai lagi dari menu Dompet.', menu(id));
      return;
    }
    const d = s.data;
    const dest = `${d.method_label} ${d.number} a.n. ${d.name}`;

    const wd = await withTx(async tx => {
      const u = await tx(`
        UPDATE users SET balance=balance-$1
        WHERE telegram_id=$2 AND balance >= $1
        RETURNING telegram_id
      `, [d.amount, id]);
      if (!u.rows.length) throw new Error('SALDO');

      const w = await tx(`
        INSERT INTO withdrawals(
          user_id,amount,fee,net_amount,destination,
          method,account_number,account_name
        )
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *
      `, [id, d.amount, WD_FEE, d.amount - WD_FEE, dest, d.method_label, d.number, d.name]);

      await txLog(tx, id, 'withdraw_hold', -d.amount, `WD #${w.rows[0].id}`);
      return w.rows[0];
    }).catch(e => {
      if (e.message === 'SALDO') return null;
      throw e;
    });

    await clearSt(id);

    if (!wd) {
      await send(chat, 'Saldo tidak cukup.', menu(id));
      return;
    }

    await send(
      chat,
      `⏳ <b>WD #${wd.id}</b> masuk antrean.\nSaldo ${money(wd.amount)} ditahan sampai admin memprosesnya. Kami kabari di sini.`,
      menu(id)
    );

    await adminNotify(wdText(wd, 'MENUNGGU'), wdPendingButtons(wd.id));
    return;
  }

  // ── Deposit ──
  if (data === 'deposit') {
    await setSt(id, 'deposit_amount');
    await send(chat, await depositScreen(id), kb([cancelRow]));
    return;
  }

  // ── Angpao (daftar di DM) ──
  if (data === 'angpao') {
    const r = await q(`
      SELECT id,remaining_amount,remaining_winners
      FROM angpaos
      WHERE status='open' AND remaining_winners>0
      ORDER BY id DESC
      LIMIT 10
    `);
    if (!r.rows.length) {
      await send(chat, 'Belum ada Angpao aktif.');
      return;
    }
    for (const a of r.rows) {
      await send(
        chat,
        `🎁 Angpao #${a.id}\nSisa hadiah: ${money(a.remaining_amount)}\nPemenang tersisa: ${a.remaining_winners}`,
        kb([[{ text: '🎁 Ambil Angpao', callback_data: `claim_angpao:${a.id}` }]])
      );
    }
    return;
  }

  if (data === 'referral') {
    const uname = BOT_USERNAME || 'YOUR_BOT_USERNAME';
    await send(
      chat,
      `🔗 <b>Link referral lu</b>\n` +
      `https://t.me/${uname}?start=${id}\n\n` +
      `Bonus Rp1.000 diberikan setelah teman yang lu undang menyelesaikan misi pertamanya dan bukti disetujui admin.`,
      menu(id)
    );
    return;
  }

  if (data === 'history') {
    const r = await q(`
      SELECT type,amount,note,created_at
      FROM transactions
      WHERE user_id=$1
      ORDER BY id DESC
      LIMIT 15
    `, [id]);
    await send(
      chat,
      r.rows.length
        ? r.rows.map(x => `${esc(x.type)}: ${money(x.amount)} — ${esc(x.note || '')}`).join('\n')
        : 'Belum ada riwayat transaksi.'
    );
    return;
  }

  if (data === 'mytasks') {
    const r = await q(`
      SELECT c.id,c.status,t.title
      FROM task_claims c
      JOIN tasks t ON t.id=c.task_id
      WHERE c.user_id=$1
      ORDER BY c.id DESC
      LIMIT 15
    `, [id]);
    await send(
      chat,
      r.rows.length
        ? r.rows.map(x => `#${x.id} ${esc(x.title)} — ${esc(x.status)}`).join('\n')
        : 'Belum ada tugas yang diambil.'
    );
    return;
  }

  if (data === 'leaderboard') {
    const r = await q(`
      SELECT username,first_name,balance
      FROM users
      WHERE telegram_id <> $1 AND blacklisted=FALSE AND balance>0
      ORDER BY balance DESC
      LIMIT 10
    `, [Number(ADMIN) || 0]);
    await send(
      chat,
      '🏆 <b>Leaderboard saldo</b>\n' +
      (r.rows.length
        ? r.rows.map((x, i) =>
            `${i + 1}. ${esc(x.username ? '@' + x.username : x.first_name || 'User')} — ${money(x.balance)}`
          ).join('\n')
        : 'Belum ada data.')
    );
    return;
  }

  if (data === 'about') {
    await send(
      chat,
      'LIMXIOCUAN adalah platform tugas dan reward.\n\n' +
      'Developer: xiolim\n' +
      'Deposit dan WD diperiksa admin secara manual.\n' +
      `Pembuat tugas membayar harga × slot + pajak ${pct(SERVICE_TAX_RATE)}; worker menerima bayaran dikurangi pajak ${pct(WORKER_TAX_RATE)}.\n` +
      'Pajak ini biaya layanan platform, bukan pajak pemerintah.'
    );
    return;
  }

  if (data === 'admin' && isAdmin(id)) {
    await send(chat, ADMIN_PANEL_TEXT, adminMenu);
    return;
  }

  // ── Ambil tugas ──
  if (data.startsWith('take:')) {
    const tid = Number(data.split(':')[1]);

    const result = await withTx(async tx => {
      const t = await tx(
        `SELECT * FROM tasks WHERE id=$1 AND status='open' FOR UPDATE`,
        [tid]
      );
      if (!t.rows.length) return null;
      const task = t.rows[0];

      // Admin boleh ambil tugasnya sendiri (untuk uji alur).
      if (String(task.created_by) === String(id) && !isAdmin(id)) {
        throw new Error('OWN_TASK');
      }
      if (Number(task.claimed) >= Number(task.slots)) return null;

      const ins = await tx(`
        INSERT INTO task_claims(task_id,user_id)
        VALUES($1,$2)
        ON CONFLICT(task_id,user_id) DO NOTHING
        RETURNING id
      `, [tid, id]);
      if (!ins.rows.length) throw new Error('DUPLICATE');

      await tx('UPDATE tasks SET claimed=claimed+1 WHERE id=$1', [tid]);

      return {
        claim: ins.rows[0].id,
        title: task.title,
        category: task.category,
        instructions: task.instructions || task.description,
        target_url: task.target_url,
        target_text: task.target_text,
        price: Number(task.reward),
        reward: Number(task.worker_reward || Math.floor(Number(task.reward) * 0.95))
      };
    }).catch(e => {
      if (['OWN_TASK', 'DUPLICATE'].includes(e.message)) return { error: e.message };
      throw e;
    });

    if (!result) {
      await notice('Tugas tidak tersedia atau slot sudah habis.');
      return;
    }
    if (result.error === 'OWN_TASK') {
      await notice('Lu tidak bisa mengambil tugas yang lu buat sendiri.');
      return;
    }
    if (result.error === 'DUPLICATE') {
      await notice('Lu sudah pernah mengambil tugas ini. Satu akun hanya boleh mengerjakan tugas yang sama satu kali.');
      return;
    }

    await setSt(id, 'proof', { claim: result.claim, task_id: tid });

    const rewardLine = result.reward === result.price
      ? money(result.reward)
      : `${money(result.price)} − pajak ${pct(WORKER_TAX_RATE)} = ${money(result.reward)} masuk saldo`;

    try {
      await send(
        chat,
        `📋 <b>Tugas #${result.claim}</b>\n` +
        `${esc(result.title)}\n` +
        `Kategori: ${esc(result.category)}\n` +
        `Bayaran: ${rewardLine}\n\n` +
        `Instruksi:\n${esc(result.instructions || '-')}\n\n` +
        `Target:\n${esc(result.target_url || '-')}\n\n` +
        `${result.target_text ? `Teks wajib:\n${esc(result.target_text)}\n\n` : ''}` +
        `Setelah selesai, kirim screenshot bukti di chat ini. Admin akan memeriksa secara manual.`
      );
      if (!inPrivate) await ack('✅ Tugas diambil. Cek chat dengan bot.', true);
    } catch {
      await ack('Buka bot dulu (/start), lalu ambil tugasnya lagi.', true);
    }
    return;
  }

  // ── Klaim angpao ──
  if (data.startsWith('claim_angpao:')) {
    const aid = Number(data.split(':')[1]);

    try {
      const out = await withTx(async tx => {
        const a = await tx(`
          SELECT * FROM angpaos
          WHERE id=$1 AND status='open' AND remaining_winners>0
          FOR UPDATE
        `, [aid]);
        if (!a.rows.length) throw new Error('HABIS');
        const row = a.rows[0];

        const dupe = await tx(
          'SELECT 1 FROM angpao_claims WHERE angpao_id=$1 AND user_id=$2',
          [aid, id]
        );
        if (dupe.rows.length) throw new Error('DUP');

        const value = Number(row.remaining_winners) === 1
          ? Number(row.remaining_amount)
          : Math.floor(Number(row.remaining_amount) / Number(row.remaining_winners));
        if (value < 1) throw new Error('HABIS');

        await tx(
          'INSERT INTO angpao_claims(angpao_id,user_id,amount) VALUES($1,$2,$3)',
          [aid, id, value]
        );
        await tx(`
          UPDATE angpaos
          SET remaining_amount=remaining_amount-$1,
              remaining_winners=remaining_winners-1,
              status=CASE WHEN remaining_winners=1 THEN 'closed' ELSE status END
          WHERE id=$2
        `, [value, aid]);
        await tx('UPDATE users SET balance=balance+$1 WHERE telegram_id=$2', [value, id]);
        await txLog(tx, id, 'angpao', value, `Angpao #${aid}`);

        return { value, last: Number(row.remaining_winners) === 1, row };
      });

      const name = await displayName(id);
      await ack(`🎉 Berhasil klaim ${money(out.value)}! Saldo bertambah.`, true);
      if (inPrivate) await send(chat, `🎉 Berhasil klaim ${money(out.value)}!`);
      else await dm(chat, `🎉 Berhasil klaim Angpao #${aid}: ${money(out.value)}.`);

      await channelPost(`🎉 Angpao #${aid} berhasil diklaim oleh ${esc(maskName(name))}. Selamat!`);

      if (out.last) {
        await channelEdit(
          out.row.channel_msg_id,
          `🎁 <b>ANGPAO LIMXIOCUAN</b>\n` +
          `Total: ${money(out.row.total_amount)}\n` +
          `Jumlah pemenang: ${out.row.winners}\n\n` +
          `✅ Angpao sudah habis.`
        );
      }
    } catch (e) {
      if (e.message === 'HABIS') {
        await ack('Angpao sudah habis.', true);
        if (c.message) {
          await tg('editMessageReplyMarkup', {
            chat_id: c.message.chat.id,
            message_id: c.message.message_id,
            reply_markup: { inline_keyboard: [] }
          }).catch(() => {});
        }
      } else if (e.message === 'DUP') {
        await ack('Lu sudah klaim Angpao ini.', true);
      } else {
        console.error('Angpao claim failed:', e);
        await ack('Klaim gagal. Coba lagi.', true);
      }
    }
    return;
  }

  // ── Semua aksi berikut khusus admin ──
  if (
    /^(dep_ok|dep_no|wd_ok|wd_no|wd_done|proof_ok|proof_no|task_close|adm_)/.test(data) &&
    !isAdmin(id)
  ) {
    await send(chat, 'Aksi ini khusus admin.');
    return;
  }

  if (data === 'adm_qris') {
    await setSt(id, 'set_qris');
    await send(chat, 'Kirim gambar QRIS sebagai <b>foto</b>. Gambar ini dipakai untuk semua deposit.');
    return;
  }

  if (data === 'adm_deposits') {
    const r = await q(`
      SELECT * FROM deposits WHERE status='pending' ORDER BY id LIMIT 15
    `);
    for (const x of r.rows) {
      await sendWithFile(chat, depText(x, 'MENUNGGU'), depButtons(x.id), x.proof_file_id, x.proof_file_type);
    }
    if (!r.rows.length) await send(chat, 'Tidak ada deposit pending.');
    return;
  }

  if (data === 'adm_wds') {
    const r = await q(`
      SELECT * FROM withdrawals
      WHERE status IN ('pending','approved')
      ORDER BY id LIMIT 15
    `);
    for (const x of r.rows) {
      await send(
        chat,
        wdText(x, x.status === 'pending' ? 'MENUNGGU' : 'DISETUJUI, MENUNGGU TRANSFER'),
        x.status === 'pending' ? wdPendingButtons(x.id) : wdApprovedButtons(x.id)
      );
    }
    if (!r.rows.length) await send(chat, 'Tidak ada WD aktif.');
    return;
  }

  if (data === 'adm_proofs') {
    const r = await q(`
      SELECT c.id,c.user_id,c.task_id,c.proof_text,
             c.proof_file_id,c.proof_file_type,t.title
      FROM task_claims c
      JOIN tasks t ON t.id=c.task_id
      WHERE c.status='pending'
      ORDER BY c.id LIMIT 15
    `);
    for (const x of r.rows) {
      await sendWithFile(chat, proofText(x, 'MENUNGGU'), proofButtons(x.id), x.proof_file_id, x.proof_file_type);
    }
    if (!r.rows.length) await send(chat, 'Tidak ada bukti pending.');
    return;
  }

  if (data === 'adm_tasks') {
    const r = await q(`
      SELECT id,title,status,claimed,slots,budget_locked,service_fee
      FROM tasks ORDER BY id DESC LIMIT 15
    `);
    for (const x of r.rows) {
      await send(
        chat,
        `Task #${x.id} ${esc(x.title)}\n` +
        `Status: ${x.status}\n` +
        `Slot terisi: ${x.claimed}/${x.slots}\n` +
        `Sisa anggaran worker: ${money(x.budget_locked)}\n` +
        `Pajak awal: ${money(x.service_fee)}`,
        kb([[{ text: 'Tutup tugas & refund sisa anggaran', callback_data: `task_close:${x.id}` }]])
      );
    }
    if (!r.rows.length) await send(chat, 'Belum ada tugas.');
    return;
  }

  if (data === 'adm_stats') {
    const r = await q(`
      SELECT
        (SELECT count(*) FROM users) users,
        (SELECT count(*) FROM tasks) tasks,
        (SELECT count(*) FROM deposits WHERE status='pending') deposits,
        (SELECT count(*) FROM withdrawals WHERE status IN ('pending','approved')) wds,
        (SELECT count(*) FROM task_claims WHERE status='pending') proofs,
        (SELECT COALESCE(sum(balance),0) FROM users WHERE telegram_id <> $1) balance
    `, [Number(ADMIN) || 0]);
    const x = r.rows[0];
    await send(
      chat,
      `📊 <b>Statistik LIMXIOCUAN</b>\n` +
      `User: ${x.users}\n` +
      `Total tugas: ${x.tasks}\n` +
      `Deposit pending: ${x.deposits}\n` +
      `WD aktif: ${x.wds}\n` +
      `Bukti tugas pending: ${x.proofs}\n` +
      `Total saldo user (tanpa saldo uji admin): ${money(x.balance)}`
    );
    return;
  }

  if (data === 'adm_angpao') {
    await setSt(id, 'angpao_amount');
    await send(chat, 'Kirim total nominal hadiah Angpao. Saldo admin tidak dipotong.');
    return;
  }

  if (data === 'adm_broadcast') {
    await setSt(id, 'broadcast');
    await send(chat, 'Kirim isi pengumuman untuk semua pengguna bot dan channel.');
    return;
  }

  // ── Deposit: setujui ──
  if (data.startsWith('dep_ok:')) {
    const n = Number(data.split(':')[1]);

    const out = await withTx(async tx => {
      const r = await tx(`
        UPDATE deposits SET status='approved',reviewed_at=NOW()
        WHERE id=$1 AND status='pending'
        RETURNING *
      `, [n]);
      if (!r.rows.length) return null;
      const x = r.rows[0];

      await tx('UPDATE users SET balance=balance+$1 WHERE telegram_id=$2', [x.amount, x.user_id]);
      await txLog(tx, x.user_id, 'deposit', Number(x.amount), `Deposit #${n} disetujui`);

      const bonuses = [];

      const pb = percentBonus(Number(x.amount));
      if (pb > 0) {
        const ins = await tx(`
          INSERT INTO deposit_bonuses(user_id,kind,amount,deposit_id)
          VALUES($1,$2,$3,$4)
          ON CONFLICT(user_id,kind) DO NOTHING RETURNING id
        `, [x.user_id, `pct:${n}`, pb, n]);
        if (ins.rows.length) bonuses.push({ label: `Bonus ${BONUS_PERCENT.percent}%`, amount: pb });
      }

      const tot = await tx(
        `SELECT COALESCE(SUM(amount),0) t FROM deposits WHERE user_id=$1 AND status='approved'`,
        [x.user_id]
      );
      for (const ms of BONUS_MILESTONES) {
        if (Number(tot.rows[0].t) >= ms.totalDeposit) {
          const ins = await tx(`
            INSERT INTO deposit_bonuses(user_id,kind,amount,deposit_id)
            VALUES($1,$2,$3,$4)
            ON CONFLICT(user_id,kind) DO NOTHING RETURNING id
          `, [x.user_id, ms.key, ms.amount, n]);
          if (ins.rows.length) {
            bonuses.push({ label: `Bonus total deposit ${money(ms.totalDeposit)}`, amount: ms.amount });
          }
        }
      }

      const bonusTotal = bonuses.reduce((a, b) => a + b.amount, 0);
      if (bonusTotal > 0) {
        await tx('UPDATE users SET balance=balance+$1 WHERE telegram_id=$2', [bonusTotal, x.user_id]);
        await txLog(tx, x.user_id, 'deposit_bonus', bonusTotal, `Bonus deposit #${n}`);
      }

      return { ...x, bonuses, bonusTotal };
    });

    if (!out) {
      await editCb(c, '⚠️ Deposit sudah diproses atau tidak ditemukan.');
      return;
    }

    const bonusLines = out.bonuses.map(b => `\n🎁 ${b.label}: ${money(b.amount)}`).join('');

    await editCb(c, depText(out, '✅ DISETUJUI') + (out.bonusTotal ? `\nBonus: ${money(out.bonusTotal)}` : ''));

    await dm(
      out.user_id,
      `✅ <b>Deposit #${n} disetujui.</b>\nSaldo bertambah ${money(out.amount)}.${bonusLines}`,
      menu(out.user_id)
    );

    const name = await displayName(out.user_id);
    await channelPost(
      `➕ <b>DEPOSIT BARU</b>\n\n` +
      `User: ${esc(maskName(name))}\n` +
      `Nominal: ${money(out.amount)}\n` +
      `Status: ✅ Disetujui`
    );
    return;
  }

  if (data.startsWith('dep_no:')) {
    const n = Number(data.split(':')[1]);
    const r = await q(`
      UPDATE deposits SET status='rejected',reviewed_at=NOW()
      WHERE id=$1 AND status='pending'
      RETURNING *
    `, [n]);

    if (!r.rows.length) {
      await editCb(c, '⚠️ Deposit sudah diproses atau tidak ditemukan.');
      return;
    }
    await editCb(c, depText(r.rows[0], '❌ DITOLAK'));
    await dm(r.rows[0].user_id, `❌ Deposit #${n} ditolak admin. Hubungi admin kalau lu sudah transfer.`);
    return;
  }

  // ── WD: setujui ──
  if (data.startsWith('wd_ok:')) {
    const n = Number(data.split(':')[1]);
    const r = await q(`
      UPDATE withdrawals SET status='approved',reviewed_at=NOW()
      WHERE id=$1 AND status='pending'
      RETURNING *
    `, [n]);

    if (!r.rows.length) {
      await editCb(c, '⚠️ WD sudah diproses atau tidak ditemukan.');
      return;
    }
    const x = r.rows[0];

    await editCb(
      c,
      wdText(x, '✅ DISETUJUI — transfer manual, lalu tekan "Transfer sudah dilakukan"'),
      wdApprovedButtons(n)
    );

    await dm(x.user_id, `✅ <b>WD #${n} disetujui.</b> Sedang ditransfer ${money(x.net_amount)}. Kami kabari lagi setelah selesai.`);

    const name = await displayName(x.user_id);
    const post = await channelPost(wdChannelText(x, name, '✅ Disetujui, sedang ditransfer'));
    if (post?.message_id) {
      await q('UPDATE withdrawals SET channel_msg_id=$1 WHERE id=$2', [post.message_id, n]);
    }
    return;
  }

  // ── WD: transfer selesai ──
  if (data.startsWith('wd_done:')) {
    const n = Number(data.split(':')[1]);
    const r = await q(`
      UPDATE withdrawals SET status='completed',completed_at=NOW()
      WHERE id=$1 AND status='approved'
      RETURNING *
    `, [n]);

    if (!r.rows.length) {
      await editCb(c, '⚠️ WD belum disetujui atau sudah selesai.');
      return;
    }
    const x = r.rows[0];

    await editCb(c, wdText(x, '✅ SELESAI'));
    await dm(x.user_id, `✅ <b>WD #${n} selesai.</b> Transfer ${money(x.net_amount)} sudah dilakukan admin.`);

    const name = await displayName(x.user_id);
    await channelEdit(x.channel_msg_id, wdChannelText(x, name, '✅ Selesai ditransfer'));
    return;
  }

  // ── WD: tolak & refund ──
  if (data.startsWith('wd_no:')) {
    const n = Number(data.split(':')[1]);

    const out = await withTx(async tx => {
      const w = await tx(`
        UPDATE withdrawals SET status='rejected',reviewed_at=NOW()
        WHERE id=$1 AND status IN ('pending','approved')
        RETURNING *
      `, [n]);
      if (!w.rows.length) return null;
      const x = w.rows[0];

      await tx('UPDATE users SET balance=balance+$1 WHERE telegram_id=$2', [x.amount, x.user_id]);
      await txLog(tx, x.user_id, 'withdraw_refund', Number(x.amount), `Refund WD #${n}`);
      return x;
    });

    if (!out) {
      await editCb(c, '⚠️ WD sudah diproses atau tidak ditemukan.');
      return;
    }

    await editCb(c, wdText(out, '❌ DITOLAK, saldo dikembalikan'));
    await dm(out.user_id, `❌ <b>WD #${n} ditolak.</b> Saldo ${money(out.amount)} dikembalikan.`);

    if (out.channel_msg_id) {
      const name = await displayName(out.user_id);
      await channelEdit(out.channel_msg_id, wdChannelText(out, name, '❌ Dibatalkan'));
    }
    return;
  }

  // ── Bukti tugas: setujui ──
  if (data.startsWith('proof_ok:')) {
    const n = Number(data.split(':')[1]);

    const out = await withTx(async tx => {
      const cl = await tx(`
        SELECT id,user_id,task_id,proof_text
        FROM task_claims WHERE id=$1 AND status='pending' FOR UPDATE
      `, [n]);
      if (!cl.rows.length) return null;
      const claim = cl.rows[0];

      const t = await tx(`
        SELECT title,worker_reward,reward,funding_per_slot
        FROM tasks WHERE id=$1 FOR UPDATE
      `, [claim.task_id]);
      if (!t.rows.length) throw new Error('TASK_NOT_FOUND');

      const reward = Number(
        t.rows[0].worker_reward || Math.floor(Number(t.rows[0].reward) * 0.95)
      );
      const funding = Number(t.rows[0].funding_per_slot || t.rows[0].reward);

      await tx(`UPDATE task_claims SET status='approved',reviewed_at=NOW() WHERE id=$1`, [n]);
      await tx('UPDATE users SET balance=balance+$1 WHERE telegram_id=$2', [reward, claim.user_id]);
      await tx(`
        UPDATE tasks
        SET budget_locked=GREATEST(0,budget_locked-$1),
            status=CASE WHEN claimed>=slots THEN 'completed' ELSE status END
        WHERE id=$2
      `, [funding, claim.task_id]);
      await txLog(tx, claim.user_id, 'task_reward', reward, `Reward task #${claim.task_id}`);

      // Referral dibayar hanya setelah misi pertama disetujui.
      const ref = await tx(`
        SELECT referrer_id,referral_reward_paid
        FROM users WHERE telegram_id=$1 FOR UPDATE
      `, [claim.user_id]);

      let referral = null;
      if (ref.rows[0]?.referrer_id && !ref.rows[0].referral_reward_paid) {
        const referrerId = ref.rows[0].referrer_id;
        const paid = await tx(`
          INSERT INTO referral_rewards(referrer_id,referred_id,amount)
          VALUES($1,$2,1000)
          ON CONFLICT(referred_id) DO NOTHING
          RETURNING id
        `, [referrerId, claim.user_id]);

        if (paid.rows.length) {
          await tx('UPDATE users SET balance=balance+1000 WHERE telegram_id=$1', [referrerId]);
          await tx('UPDATE users SET referral_reward_paid=TRUE WHERE telegram_id=$1', [claim.user_id]);
          await txLog(tx, referrerId, 'referral', 1000, `Bonus referral misi pertama user ${claim.user_id}`);
          referral = referrerId;
        }
      }

      return { ...claim, title: t.rows[0].title, reward, referral };
    });

    if (!out) {
      await editCb(c, '⚠️ Bukti sudah diproses atau tidak ditemukan.');
      return;
    }

    await editCb(c, proofText(out, `✅ DISETUJUI (reward ${money(out.reward)})`));
    await dm(out.user_id, `✅ Bukti tugas disetujui. Saldo bertambah ${money(out.reward)}.`);
    if (out.referral) {
      await dm(out.referral, '🎉 Bonus referral Rp1.000 masuk karena teman yang lu undang menyelesaikan misi pertamanya.');
    }
    return;
  }

  // ── Bukti tugas: tolak ──
  if (data.startsWith('proof_no:')) {
    const n = Number(data.split(':')[1]);

    const out = await withTx(async tx => {
      const r = await tx(`
        UPDATE task_claims SET status='rejected',reviewed_at=NOW()
        WHERE id=$1 AND status='pending'
        RETURNING id,user_id,task_id,proof_text
      `, [n]);
      if (!r.rows.length) return null;

      await tx(`
        UPDATE tasks SET claimed=GREATEST(0,claimed-1)
        WHERE id=$1 AND status='open'
      `, [r.rows[0].task_id]);
      return r.rows[0];
    });

    if (!out) {
      await editCb(c, '⚠️ Bukti sudah diproses atau tidak ditemukan.');
      return;
    }

    await editCb(c, proofText(out, '❌ DITOLAK'));
    await dm(out.user_id, '❌ Bukti tugas ditolak admin. Slot dibuka kembali untuk pengguna lain.');
    return;
  }

  // ── Tutup tugas & refund ──
  if (data.startsWith('task_close:')) {
    const n = Number(data.split(':')[1]);

    const out = await withTx(async tx => {
      const t = await tx(`
        UPDATE tasks SET status='closed'
        WHERE id=$1 AND status='open'
        RETURNING created_by,budget_locked
      `, [n]);
      if (!t.rows.length) return null;

      await tx(`
        UPDATE task_claims SET status='rejected',reviewed_at=NOW()
        WHERE task_id=$1 AND status IN ('claimed','pending')
      `, [n]);

      const refund = Math.max(0, Number(t.rows[0].budget_locked));
      if (refund > 0) {
        await tx('UPDATE users SET balance=balance+$1 WHERE telegram_id=$2', [refund, t.rows[0].created_by]);
        await txLog(tx, t.rows[0].created_by, 'task_refund', refund, `Refund penutupan task #${n}`);
      }
      return { owner: t.rows[0].created_by, refund };
    });

    if (!out) {
      await editCb(c, '⚠️ Task sudah ditutup atau tidak ditemukan.');
      return;
    }

    await editCb(c, `Task #${n} ditutup. Refund: ${money(out.refund)}. Pajak ${pct(SERVICE_TAX_RATE)} tidak dikembalikan.`);
    await dm(out.owner, `Task #${n} ditutup. Refund sisa anggaran worker: ${money(out.refund)}.`);
    return;
  }
}

// ───────────────────────── Entry point ─────────────────────────
export default async function handler(req, res) {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, service: 'LIMXIOCUAN webhook' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, method: 'POST required' });
    return;
  }

  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    res.status(401).json({ ok: false });
    return;
  }

  const update = req.body;

  try {
    await ensureSchema();

    if (update?.message) await onMessage(update.message);
    if (update?.callback_query) await onCallback(update.callback_query);

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Webhook error:', e);

    // Jangan diam saja: kabari user dan admin.
    const uid = update?.message?.from?.id || update?.callback_query?.from?.id;
    if (uid) await dm(uid, '⚠️ Terjadi kesalahan di server. Coba lagi sebentar lagi.');
    if (ADMIN && String(uid) !== ADMIN) {
      await dm(ADMIN, `⚠️ <b>Error bot</b>\nUser: <code>${uid || '-'}</code>\n<code>${esc(String(e.message).slice(0, 500))}</code>`);
    } else if (ADMIN) {
      await dm(ADMIN, `⚠️ <b>Error bot</b>\n<code>${esc(String(e.message).slice(0, 500))}</code>`);
    }

    res.status(200).json({ ok: false, error: 'update_failed' });
  }
}
