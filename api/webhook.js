
import { q, withTx } from '../lib/db.js';
import { tg, send, answer } from '../lib/telegram.js';
import { TASK_RATES, calculateTaskBudget, rupiah } from '../lib/task-rates.js';
import { calculateDepositFee } from '../lib/deposit-fees.js';

const ADMIN = String(process.env.ADMIN_ID || '');
const CHANNEL = process.env.CHANNEL_ID || '@informasilmxoucuan';
const GROUPS = [
  process.env.GROUP1_ID || '@groupdiskusixiolim',
  process.env.GROUP2_ID || '@backupgroupxio'
];

const money = rupiah;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;',
  '"': '&quot;', "'": '&#39;'
}[c]));

const kb = rows => ({ inline_keyboard: rows });
const isAdmin = id => String(id) === ADMIN;

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
  ...(isAdmin(id)
    ? [[{ text: '🛠 Admin Panel', callback_data: 'admin' }]]
    : [])
]);

const adminMenu = kb([
  [{ text: '💳 Deposit pending', callback_data: 'adm_deposits' },
   { text: '📤 WD pending', callback_data: 'adm_wds' }],
  [{ text: '🧾 Bukti tugas', callback_data: 'adm_proofs' },
   { text: '📋 Kelola tugas', callback_data: 'adm_tasks' }],
  [{ text: '🎁 Buat angpao', callback_data: 'adm_angpao' },
   { text: '📊 Statistik', callback_data: 'adm_stats' }],
  [{ text: '📣 Pengumuman', callback_data: 'adm_broadcast' }],
  [{ text: '🏠 Menu utama', callback_data: 'home' }]
]);

const categoryRows = [
  [{ text: '❤️ Like', callback_data: 'category:like' },
   { text: '🔁 Posting Ulang', callback_data: 'category:repost' }],
  [{ text: '➕ Follow', callback_data: 'category:follow' },
   { text: '💬 Komentar', callback_data: 'category:comment' }],
  [{ text: '⭐ Favorite', callback_data: 'category:favorite' },
   { text: '🔗 Salin Tautan 10x', callback_data: 'category:copy_link' }],
  [{ text: '📤 Bagikan 10 Teman', callback_data: 'category:share' }],
  [{ text: '✈️ Telegram', callback_data: 'category:telegram' },
   { text: '📢 Channel', callback_data: 'category:channel' }],
  [{ text: '👥 Group', callback_data: 'category:group' },
   { text: '🟢 WhatsApp', callback_data: 'category:whatsapp' }],
  [{ text: '❌ Batal', callback_data: 'create_cancel' }]
];

async function st(id) {
  const r = await q(
    'SELECT state,data FROM user_states WHERE telegram_id=$1',
    [id]
  );
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

async function clearSt(id) {
  await q('DELETE FROM user_states WHERE telegram_id=$1', [id]);
}

async function upsertUser(f) {
  await q(`
    INSERT INTO users(telegram_id,username,first_name)
    VALUES($1,$2,$3)
    ON CONFLICT(telegram_id)
    DO UPDATE SET username=$2,first_name=$3
  `, [f.id, f.username || null, f.first_name || '']);
}

async function member(id) {
  for (const chat of [CHANNEL, ...GROUPS]) {
    try {
      const m = await tg('getChatMember', {
        chat_id: chat,
        user_id: id
      });
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

async function gate(chat, id) {
  if (isAdmin(id) || await member(id)) return true;

  await send(
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

async function adminNotify(text, markup) {
  if (ADMIN) await send(ADMIN, text, markup);
}

async function channelPost(text, markup) {
  try {
    await send(CHANNEL, text, markup);
  } catch (e) {
    console.error('Channel post failed:', e.message);
  }
}

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

async function txLog(tx, user, type, amount, note) {
  await tx(
    'INSERT INTO transactions(user_id,type,amount,note) VALUES($1,$2,$3,$4)',
    [user, type, amount, note]
  );
}

async function sendProofFile(chat, fileId, fileType, caption) {
  if (!fileId) return;

  if (fileType === 'photo') {
    await tg('sendPhoto', {
      chat_id: chat,
      photo: fileId,
      caption
    });
  } else {
    await tg('sendDocument', {
      chat_id: chat,
      document: fileId,
      caption
    });
  }
}

function getProof(m) {
  if (m.photo?.length) {
    const p = m.photo[m.photo.length - 1];
    return {
      fileId: p.file_id,
      uniqueId: p.file_unique_id,
      type: 'photo'
    };
  }

  if (m.document) {
    return {
      fileId: m.document.file_id,
      uniqueId: m.document.file_unique_id,
      type: 'document'
    };
  }

  return null;
}

function depositMethods() {
  const methods = [];

  if (process.env.PAYMENT_BANK) {
    methods.push(`Bank: ${process.env.PAYMENT_BANK}`);
  }

  methods.push('GoPay: 085188727786');
  methods.push('Nama penerima GoPay: Abdul Halim');
  methods.push('QRIS: BELUM AKTIF — placeholder, bukan QR pembayaran.');

  return methods.join('\n');
}

function taskTargetLabel(category) {
  if (category === 'whatsapp') return 'nomor WhatsApp tujuan';
  if (category === 'telegram') return 'link grup/channel Telegram atau instruksi tujuan';
  if (category === 'channel') return 'link channel';
  if (category === 'group') return 'link grup';
  if (category === 'follow') return 'link profil TikTok';
  return 'link video TikTok';
}

async function publishTask(task) {
  const markup = kb([[
    { text: '📋 Ambil Tugas', callback_data: `take:${task.id}` }
  ]]);

  const notice =
    `📢 <b>TUGAS BARU #${task.id}</b>\n` +
    `${esc(task.title)}\n` +
    `Kategori: ${esc(task.category)}\n` +
    `Reward worker: ${money(task.worker_reward)}\n` +
    `Slot: ${task.slots}\n\n` +
    `Tekan tombol untuk melihat dan mengambil tugas.`;

  await channelPost(notice, markup);
  await notifyAll(notice, markup);
}

async function onMessage(m) {
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
    const ref = Number(txt.split(/\s+/)[1]);

    if (ref && ref !== id) {
      await q(`
        UPDATE users
        SET referrer_id=$1
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

  if (txt === '/admin' && isAdmin(id)) {
    await send(chat, '🛠 <b>Admin Panel LIMXIOCUAN</b>', adminMenu);
    return;
  }

  if (!(await gate(chat, id))) return;

  const s = await st(id);
  if (!s) {
    await send(chat, 'Pilih menu lewat /start.', menu(id));
    return;
  }

  const d = s.data || {};

  // Buat tugas: judul
  if (s.state === 'task_title') {
    if (txt.length < 4 || txt.length > 100) {
      await send(chat, 'Judul harus 4–100 karakter.');
      return;
    }

    await setSt(id, 'task_category', { title: txt });
    await send(chat, 'Pilih kategori tugas:', kb(categoryRows));
    return;
  }

  // Buat tugas: instruksi
  if (s.state === 'task_desc') {
    if (txt.length < 3 || txt.length > 1500) {
      await send(chat, 'Instruksi harus 3–1.500 karakter.');
      return;
    }

    await setSt(id, 'task_target', {
      ...d,
      instructions: txt
    });

    await send(
      chat,
      `Kirim ${taskTargetLabel(d.category)}.`
    );
    return;
  }

  // Buat tugas: target
  if (s.state === 'task_target') {
    if (txt.length < 3 || txt.length > 1000) {
      await send(chat, 'Target tidak valid. Kirim link atau nomor tujuan.');
      return;
    }

    const rate = TASK_RATES[d.category];

    if (rate.fields.includes('target_text')) {
      const prompt = d.category === 'comment'
        ? 'Kirim teks komentar yang harus ditulis worker.'
        : 'Kirim pesan yang harus dikirim worker melalui WhatsApp.';

      await setSt(id, 'task_target_text', {
        ...d,
        target_url: txt
      });

      await send(chat, prompt);
      return;
    }

    await setSt(id, 'task_slots', {
      ...d,
      target_url: txt,
      target_text: null,
      worker_reward: rate.reward
    });

    await send(
      chat,
      `Reward kategori ${rate.label}: ${money(rate.reward)} per worker.\nKirim jumlah slot (10–10.000).`
    );
    return;
  }

  // Komentar dan WhatsApp: teks wajib
  if (s.state === 'task_target_text') {
    if (txt.length < 1 || txt.length > 1000) {
      await send(chat, 'Teks harus 1–1.000 karakter.');
      return;
    }

    const rate = TASK_RATES[d.category];

    await setSt(id, 'task_slots', {
      ...d,
      target_text: txt,
      worker_reward: rate.reward
    });

    await send(
      chat,
      `Reward kategori ${rate.label}: ${money(rate.reward)} per worker.\nKirim jumlah slot (10–10.000).`
    );
    return;
  }

  // Buat tugas: hitung anggaran lalu minta konfirmasi
  if (s.state === 'task_slots') {
    const slots = Number(txt);

    let budget;
    try {
      budget = calculateTaskBudget(d.worker_reward, slots);
    } catch (e) {
      await send(chat, e.message);
      return;
    }

    const draft = {
      ...d,
      slots,
      subtotal: budget.subtotal,
      service_fee: budget.serviceFee,
      total_budget: budget.total
    };

    await setSt(id, 'task_confirm', draft);

    await send(
      chat,
      `🧾 <b>Konfirmasi pembuatan tugas</b>\n\n` +
      `Judul: ${esc(d.title)}\n` +
      `Kategori: ${esc(TASK_RATES[d.category].label)}\n` +
      `Reward per worker: ${money(d.worker_reward)}\n` +
      `Jumlah slot: ${slots}\n` +
      `Subtotal: ${money(budget.subtotal)}\n` +
      `Biaya layanan 5%: ${money(budget.serviceFee)}\n` +
      `<b>Total potong saldo: ${money(budget.total)}</b>\n\n` +
      `Saldo baru dipotong setelah lu menekan Konfirmasi.`,
      kb([
        [{ text: '✅ Konfirmasi & publikasikan', callback_data: 'create_confirm' }],
        [{ text: '❌ Batalkan', callback_data: 'create_cancel' }]
      ])
    );
    return;
  }

  // Bukti tugas
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
        await send(chat, '❌ File bukti ini pernah digunakan. Kirim screenshot bukti yang berbeda.');
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
      RETURNING id,task_id
    `, [
      txt || null,
      file?.fileId || null,
      file?.uniqueId || null,
      file?.type || null,
      d.claim,
      id
    ]);

    await clearSt(id);

    if (!r.rows.length) {
      await send(chat, 'Klaim tidak ditemukan atau bukti sudah dikirim.');
      return;
    }

    const claim = r.rows[0];

    await adminNotify(
      `🧾 <b>Bukti tugas #${claim.id}</b>\n` +
      `Task: #${claim.task_id}\n` +
      `User: <code>${id}</code>\n` +
      `${esc(txt || 'Bukti file terlampir')}`,
      kb([[
        { text: '✅ Approve', callback_data: `proof_ok:${claim.id}` },
        { text: '❌ Reject', callback_data: `proof_no:${claim.id}` }
      ]])
    );

    if (file) {
      await sendProofFile(
        ADMIN,
        file.fileId,
        file.type,
        `Bukti tugas #${claim.id} dari user ${id}`
      ).catch(e => console.error('Forward proof failed:', e.message));
    }

    await send(chat, '✅ Bukti terkirim ke admin. Reward masuk setelah admin menyetujui.');
    return;
  }

  // Deposit: nominal
  if (s.state === 'deposit_amount') {
    const n = Number(txt);
    let fee;

    try {
      fee = calculateDepositFee(n);
    } catch (e) {
      await send(chat, e.message);
      return;
    }

    await setSt(id, 'deposit_method', {
      amount: n,
      fee
    });

    await send(
      chat,
      `Nominal saldo: ${money(n)}\n` +
      `Biaya admin: ${money(fee)}\n` +
      `Total transfer: ${money(n + fee)}\n\n` +
      `${esc(depositMethods())}\n\n` +
      `Kirim metode: Bank, GoPay, atau QRIS.`
    );
    return;
  }

  // Deposit: metode
  if (s.state === 'deposit_method') {
    const method = txt.toLowerCase();

    if (!['bank', 'gopay', 'qris'].includes(method)) {
      await send(chat, 'Pilih Bank, GoPay, atau QRIS.');
      return;
    }

    if (method === 'bank' && !process.env.PAYMENT_BANK) {
      await send(chat, 'Metode Bank belum diatur admin. Pilih GoPay.');
      return;
    }

    if (method === 'qris') {
      await send(
        chat,
        '⚠️ QRIS belum aktif. Gambar/placeholder QRIS tidak boleh digunakan untuk pembayaran. Silakan pilih GoPay.'
      );
      return;
    }

    await setSt(id, 'deposit_proof', {
      ...d,
      method: method.toUpperCase()
    });

    await send(
      chat,
      method === 'gopay'
        ? 'Transfer ke GoPay 085188727786 atas nama Abdul Halim, sesuai total pembayaran. Setelah itu kirim foto bukti transfer.'
        : `Transfer ke rekening admin: ${process.env.PAYMENT_BANK}\nSetelah itu kirim foto bukti transfer.`
    );
    return;
  }

  // Deposit: bukti
  if (s.state === 'deposit_proof') {
    const file = getProof(m);

    if (!file && !txt) {
      await send(chat, 'Kirim foto bukti pembayaran atau teks referensi transaksi.');
      return;
    }

    const r = await q(`
      INSERT INTO deposits(
        user_id,amount,fee,total_paid,method,
        proof_file_id,proof_text,proof_file_type
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id
    `, [
      id,
      d.amount,
      d.fee,
      d.amount + d.fee,
      d.method,
      file?.fileId || null,
      txt || null,
      file?.type || null
    ]);

    await clearSt(id);

    const dep = r.rows[0].id;

    await adminNotify(
      `💳 <b>Deposit #${dep}</b>\n` +
      `User: <code>${id}</code>\n` +
      `Saldo diminta: ${money(d.amount)}\n` +
      `Fee: ${money(d.fee)}\n` +
      `Total bayar: ${money(d.amount + d.fee)}\n` +
      `Metode: ${d.method}\n` +
      `${esc(txt || 'Bukti terlampir')}`,
      kb([[
        { text: '✅ Approve', callback_data: `dep_ok:${dep}` },
        { text: '❌ Reject', callback_data: `dep_no:${dep}` }
      ]])
    );

    if (file) {
      await sendProofFile(
        ADMIN,
        file.fileId,
        file.type,
        `Bukti deposit #${dep} dari user ${id}`
      ).catch(e => console.error('Deposit proof forward failed:', e.message));
    }

    await send(chat, 'Bukti deposit diterima. Saldo masuk setelah admin memeriksa dan menyetujui.');
    return;
  }

  // Withdrawal: nominal
  if (s.state === 'withdraw_amount') {
    const n = Number(txt);

    if (!Number.isSafeInteger(n) || n < 5000) {
      await send(chat, 'Nominal WD minimal Rp5.000.');
      return;
    }

    const b = await q(
      'SELECT balance FROM users WHERE telegram_id=$1',
      [id]
    );

    if (!b.rows.length || Number(b.rows[0].balance) < n) {
      await send(chat, 'Saldo tidak cukup.');
      return;
    }

    await setSt(id, 'withdraw_dest', { amount: n });

    await send(
      chat,
      `Nominal WD: ${money(n)}\n` +
      `Fee admin: Rp3.000\n` +
      `Diterima: ${money(n - 3000)}\n\n` +
      `Kirim tujuan transfer (nama bank/e-wallet dan nomor rekening).`
    );
    return;
  }

  // Withdrawal: tujuan
  if (s.state === 'withdraw_dest') {
    if (txt.length < 5 || txt.length > 300) {
      await send(chat, 'Tujuan transfer tidak valid.');
      return;
    }

    const n = d.amount;

    const result = await withTx(async tx => {
      const u = await tx(`
        UPDATE users
        SET balance=balance-$1
        WHERE telegram_id=$2 AND balance >= $1
        RETURNING telegram_id
      `, [n, id]);

      if (!u.rows.length) throw new Error('SALDO');

      const w = await tx(`
        INSERT INTO withdrawals(user_id,amount,fee,net_amount,destination)
        VALUES($1,$2,3000,$3,$4)
        RETURNING id
      `, [id, n, n - 3000, txt]);

      await txLog(tx, id, 'withdraw_hold', -n, `WD #${w.rows[0].id}`);
      return w.rows[0].id;
    }).catch(e => {
      if (e.message === 'SALDO') return null;
      throw e;
    });

    await clearSt(id);

    if (!result) {
      await send(chat, 'Saldo tidak cukup.');
      return;
    }

    await adminNotify(
      `📤 <b>WD #${result}</b>\n` +
      `User: <code>${id}</code>\n` +
      `Nominal ditahan: ${money(n)}\n` +
      `Fee: Rp3.000\n` +
      `Transfer bersih: ${money(n - 3000)}\n` +
      `Tujuan: ${esc(txt)}`,
      kb([[
        { text: '✅ Setujui untuk transfer', callback_data: `wd_ok:${result}` },
        { text: '❌ Tolak & refund', callback_data: `wd_no:${result}` }
      ]])
    );

    await send(chat, 'Permintaan WD masuk antrean. Saldo ditahan sampai admin memprosesnya.');
    return;
  }

  // Angpao admin
  if (s.state === 'angpao_amount' && isAdmin(id)) {
    const n = Number(txt);

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
      INSERT INTO angpaos(
        total_amount,winners,remaining_amount,
        remaining_winners,created_by
      )
      VALUES($1,$2,$1,$2,$3)
      RETURNING id
    `, [d.amount, n, id]);

    await clearSt(id);

    const aid = a.rows[0].id;
    const markup = kb([[
      { text: '🎁 Ambil Angpao', callback_data: `claim_angpao:${aid}` }
    ]]);

    const notice =
      `🎁 <b>ANGPAO LIMXIOCUAN</b>\n` +
      `Total: ${money(d.amount)}\n` +
      `Jumlah pemenang: ${n}\n\n` +
      `Klik untuk klaim!`;

    await channelPost(notice, markup);
    await notifyAll(notice, markup);
    await send(chat, `Angpao #${aid} dipublikasikan. Saldo admin tidak dipotong.`);
    return;
  }

  // Broadcast admin
  if (s.state === 'broadcast' && isAdmin(id)) {
    await clearSt(id);

    const result = await notifyAll(
      `📣 <b>Pengumuman LIMXIOCUAN</b>\n\n${esc(txt)}`
    );

    await channelPost(
      `📣 <b>Pengumuman LIMXIOCUAN</b>\n\n${esc(txt)}`
    );

    await send(
      chat,
      `Broadcast selesai.\nTerkirim: ${result.ok}\nGagal: ${result.failed}`
    );
    return;
  }

  await send(chat, 'Input tidak dikenali. Gunakan /cancel lalu mulai lagi.', menu(id));
}

async function onCallback(c) {
  const id = c.from.id;
  const chat = c.message.chat.id;
  const data = c.data || '';

  await upsertUser(c.from);
  await answer(c.id).catch(() => {});

  if (data === 'check_join') {
    if (await member(id)) {
      await send(chat, '✅ Keanggotaan terverifikasi.', menu(id));
    } else {
      await gate(chat, id);
    }
    return;
  }

  if (!(await gate(chat, id))) return;

  if (data === 'home') {
    await send(chat, 'Menu utama:', menu(id));
    return;
  }

  if (data === 'create_cancel') {
    await clearSt(id);
    await send(chat, 'Pembuatan tugas dibatalkan.', menu(id));
    return;
  }

  // Pilih kategori tugas
  if (data.startsWith('category:')) {
    const category = data.split(':')[1];
    const rate = TASK_RATES[category];

    if (!rate) {
      await send(chat, 'Kategori tidak dikenal.');
      return;
    }

    const s = await st(id);
    if (!s || s.state !== 'task_category') {
      await send(chat, 'Sesi pembuatan tugas tidak ditemukan. Mulai lagi dari menu.');
      return;
    }

    await setSt(id, 'task_desc', {
      ...s.data,
      category
    });

    await send(
      chat,
      `Kategori: <b>${esc(rate.label)}</b>\n` +
      `Reward worker: ${money(rate.reward)}\n\n` +
      `Kirim instruksi tugas yang harus dilakukan worker.`
    );
    return;
  }

  // Konfirmasi pembuatan tugas dan potong saldo
  if (data === 'create_confirm') {
    const s = await st(id);

    if (!s || s.state !== 'task_confirm') {
      await send(chat, 'Draft tugas tidak ditemukan. Silakan buat ulang.');
      return;
    }

    const d = s.data;
    const rate = TASK_RATES[d.category];

    if (!rate) {
      await clearSt(id);
      await send(chat, 'Kategori tidak valid.');
      return;
    }

    const created = await withTx(async tx => {
      const user = await tx(
        'SELECT balance FROM users WHERE telegram_id=$1 FOR UPDATE',
        [id]
      );

      if (!user.rows.length ||
          Number(user.rows[0].balance) < Number(d.total_budget)) {
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
        VALUES(
          $1,$2,$3,$4,$4,$4,$5,0,'open',$6,
          $7,$8,$9,$10,$11,$2
        )
        RETURNING id
      `, [
        d.title,
        d.instructions,
        rate.label,
        d.worker_reward,
        d.slots,
        id,
        d.subtotal,
        d.service_fee,
        d.total_budget,
        d.target_url,
        d.target_text
      ]);

      await txLog(
        tx,
        id,
        'task_budget',
        -Number(d.total_budget),
        `Anggaran tugas #${task.rows[0].id}, termasuk biaya layanan 5%`
      );

      return task.rows[0].id;
    }).catch(e => {
      if (e.message === 'SALDO') return null;
      throw e;
    });

    await clearSt(id);

    if (!created) {
      await send(
        chat,
        `Saldo tidak cukup untuk membayar ${money(d.total_budget)}.`,
        menu(id)
      );
      return;
    }

    await send(
      chat,
      `✅ <b>Tugas #${created} berhasil dibuat.</b>\n` +
      `Reward worker: ${money(d.worker_reward)}\n` +
      `Slot: ${d.slots}\n` +
      `Subtotal: ${money(d.subtotal)}\n` +
      `Biaya layanan: ${money(d.service_fee)}\n` +
      `Total dipotong: ${money(d.total_budget)}`,
      menu(id)
    );

    await publishTask({
      id: created,
      title: d.title,
      category: rate.label,
      worker_reward: d.worker_reward,
      slots: d.slots
    });
    return;
  }

  // Lihat tugas aktif
  if (data === 'tasks') {
    const r = await q(`
      SELECT id,title,category,worker_reward,reward,slots,claimed,
             description,target_url,target_text
      FROM tasks
      WHERE status='open' AND claimed<slots
      ORDER BY id DESC
      LIMIT 15
    `);

    if (!r.rows.length) {
      await send(chat, 'Belum ada tugas aktif.');
      return;
    }

    for (const t of r.rows) {
      const reward = Number(t.worker_reward || Math.floor(Number(t.reward) * 0.95));

      await send(
        chat,
        `<b>#${t.id} ${esc(t.title)}</b>\n` +
        `Kategori: ${esc(t.category)}\n` +
        `Reward worker: ${money(reward)}\n` +
        `Slot tersisa: ${Number(t.slots) - Number(t.claimed)}\n` +
        `${esc(t.description || '')}`,
        kb([[
          { text: 'Ambil Tugas', callback_data: `take:${t.id}` }
        ]])
      );
    }
    return;
  }

  if (data === 'create_task') {
    await setSt(id, 'task_title');
    await send(chat, 'Kirim judul tugas (4–100 karakter).');
    return;
  }

  if (data === 'wallet') {
    const r = await q(
      'SELECT balance FROM users WHERE telegram_id=$1',
      [id]
    );

    await send(
      chat,
      `💰 Saldo tersedia: <b>${money(r.rows[0]?.balance || 0)}</b>`,
      menu(id)
    );
    return;
  }

  if (data === 'deposit') {
    await setSt(id, 'deposit_amount');
    await send(
      chat,
      'Kirim nominal deposit. Rentang biaya: Rp5.000–Rp50.000, Rp51.000–Rp100.000, atau Rp101.000–Rp300.000.'
    );
    return;
  }

  if (data === 'withdraw') {
    await setSt(id, 'withdraw_amount');
    await send(chat, 'Kirim nominal WD. Minimal Rp5.000. Biaya WD Rp3.000.');
    return;
  }

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
        `🎁 Angpao #${a.id}\n` +
        `Sisa hadiah: ${money(a.remaining_amount)}\n` +
        `Pemenang tersisa: ${a.remaining_winners}`,
        kb([[
          { text: 'Ambil Angpao', callback_data: `claim_angpao:${a.id}` }
        ]])
      );
    }
    return;
  }

  if (data === 'referral') {
    const uname = process.env.BOT_USERNAME || 'YOUR_BOT_USERNAME';

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
        ? r.rows.map(x =>
            `${esc(x.type)}: ${money(x.amount)} — ${esc(x.note || '')}`
          ).join('\n')
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
        ? r.rows.map(x =>
            `#${x.id} ${esc(x.title)} — ${esc(x.status)}`
          ).join('\n')
        : 'Belum ada tugas yang diambil.'
    );
    return;
  }

  if (data === 'leaderboard') {
    const r = await q(`
      SELECT telegram_id,username,first_name,balance
      FROM users
      ORDER BY balance DESC
      LIMIT 10
    `);

    await send(
      chat,
      '🏆 <b>Leaderboard saldo</b>\n' +
      r.rows.map((x, i) =>
        `${i + 1}. ${esc(x.username ? '@' + x.username : x.first_name || 'User')} — ${money(x.balance)}`
      ).join('\n')
    );
    return;
  }

  if (data === 'about') {
    await send(
      chat,
      'LIMXIOCUAN adalah platform tugas dan reward.\n\n' +
      'Developer: xiolim\n' +
      'Deposit dan WD diperiksa admin secara manual.\n' +
      'Reward tugas mengikuti tarif kategori.\n' +
      'Biaya layanan pembuatan tugas sebesar 5%, bukan pajak pemerintah.'
    );
    return;
  }

  if (data === 'admin' && isAdmin(id)) {
    await send(chat, '🛠 <b>Admin Panel LIMXIOCUAN</b>', adminMenu);
    return;
  }

  // Ambil tugas
  if (data.startsWith('take:')) {
    const tid = Number(data.split(':')[1]);

    const result = await withTx(async tx => {
      const t = await tx(`
        SELECT *
        FROM tasks
        WHERE id=$1 AND status='open'
        FOR UPDATE
      `, [tid]);

      if (!t.rows.length) return null;

      const task = t.rows[0];

      if (String(task.created_by) === String(id)) {
        throw new Error('OWN_TASK');
      }

      if (Number(task.claimed) >= Number(task.slots)) {
        return null;
      }

      const ins = await tx(`
        INSERT INTO task_claims(task_id,user_id)
        VALUES($1,$2)
        ON CONFLICT(task_id,user_id) DO NOTHING
        RETURNING id
      `, [tid, id]);

      if (!ins.rows.length) {
        throw new Error('DUPLICATE');
      }

      await tx(
        'UPDATE tasks SET claimed=claimed+1 WHERE id=$1',
        [tid]
      );

      return {
        claim: ins.rows[0].id,
        title: task.title,
        category: task.category,
        instructions: task.instructions || task.description,
        target_url: task.target_url,
        target_text: task.target_text,
        reward: task.worker_reward || Math.floor(Number(task.reward) * 0.95)
      };
    }).catch(e => {
      if (['OWN_TASK', 'DUPLICATE'].includes(e.message)) {
        return { error: e.message };
      }
      throw e;
    });

    if (!result) {
      await send(chat, 'Tugas tidak tersedia atau slot sudah habis.');
      return;
    }

    if (result.error === 'OWN_TASK') {
      await send(chat, 'Lu tidak bisa mengambil tugas yang lu buat sendiri.');
      return;
    }

    if (result.error === 'DUPLICATE') {
      await send(chat, 'Lu sudah pernah mengambil tugas ini. Satu akun hanya boleh mengerjakan tugas yang sama satu kali.');
      return;
    }

    await setSt(id, 'proof', {
      claim: result.claim,
      task_id: tid
    });

    await send(
      chat,
      `📋 <b>Tugas #${result.claim}</b>\n` +
      `${esc(result.title)}\n` +
      `Kategori: ${esc(result.category)}\n` +
      `Reward: ${money(result.reward)}\n\n` +
      `Instruksi:\n${esc(result.instructions || '-')}\n\n` +
      `Target:\n${esc(result.target_url || '-')}\n\n` +
      `${result.target_text ? `Teks wajib:\n${esc(result.target_text)}\n\n` : ''}` +
      `Setelah selesai, kirim screenshot bukti di chat ini. Admin akan memeriksa secara manual.`
    );
    return;
  }

  // Klaim Angpao
  if (data.startsWith('claim_angpao:')) {
    const aid = Number(data.split(':')[1]);

    try {
      const amount = await withTx(async tx => {
        const a = await tx(`
          SELECT *
          FROM angpaos
          WHERE id=$1 AND status='open' AND remaining_winners>0
          FOR UPDATE
        `, [aid]);

        if (!a.rows.length) throw new Error('HABIS');

        const row = a.rows[0];

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

        await tx(
          'UPDATE users SET balance=balance+$1 WHERE telegram_id=$2',
          [value, id]
        );

        await txLog(tx, id, 'angpao', value, `Angpao #${aid}`);
        return value;
      });

      await send(chat, `🎉 Berhasil klaim ${money(amount)}!`);
      await channelPost(`🎉 Angpao #${aid} berhasil diklaim. Selamat kepada pemenang!`);
    } catch (e) {
      await send(
        chat,
        e.message === 'HABIS'
          ? 'Angpao sudah habis.'
          : 'Lu sudah klaim Angpao ini atau klaim gagal.'
      );
    }
    return;
  }

  // Semua aksi berikut hanya untuk admin
  if (
    /^(dep_|wd_|proof_|task_close:|adm_)/.test(data) &&
    !isAdmin(id)
  ) {
    await send(chat, 'Aksi ini khusus admin.');
    return;
  }

  // Daftar deposit pending
  if (data === 'adm_deposits' && isAdmin(id)) {
    const r = await q(`
      SELECT id,user_id,amount,fee,total_paid,method,
             proof_text,proof_file_id,proof_file_type
      FROM deposits
      WHERE status='pending'
      ORDER BY id
      LIMIT 15
    `);

    for (const x of r.rows) {
      await send(
        chat,
        `Deposit #${x.id}\n` +
        `User: ${x.user_id}\n` +
        `Saldo: ${money(x.amount)}\n` +
        `Fee: ${money(x.fee)}\n` +
        `Total: ${money(x.total_paid)}\n` +
        `Metode: ${esc(x.method)}\n` +
        `${esc(x.proof_text || '')}`,
        kb([[
          { text: 'Approve', callback_data: `dep_ok:${x.id}` },
          { text: 'Reject', callback_data: `dep_no:${x.id}` }
        ]])
      );

      if (x.proof_file_id) {
        await sendProofFile(
          chat,
          x.proof_file_id,
          x.proof_file_type,
          `Bukti deposit #${x.id}`
        ).catch(() => {});
      }
    }

    if (!r.rows.length) await send(chat, 'Tidak ada deposit pending.');
    return;
  }

  // Daftar WD
  if (data === 'adm_wds' && isAdmin(id)) {
    const r = await q(`
      SELECT id,user_id,amount,fee,net_amount,destination,status
      FROM withdrawals
      WHERE status IN ('pending','approved')
      ORDER BY id
      LIMIT 15
    `);

    for (const x of r.rows) {
      const buttons = x.status === 'pending'
        ? [[
            { text: 'Setujui untuk transfer', callback_data: `wd_ok:${x.id}` },
            { text: 'Tolak & refund', callback_data: `wd_no:${x.id}` }
          ]]
        : [[
            { text: '✅ Transfer sudah dilakukan', callback_data: `wd_done:${x.id}` },
            { text: 'Tolak & refund', callback_data: `wd_no:${x.id}` }
          ]];

      await send(
        chat,
        `WD #${x.id} (${x.status})\n` +
        `User: ${x.user_id}\n` +
        `Nominal ditahan: ${money(x.amount)}\n` +
        `Transfer bersih: ${money(x.net_amount)}\n` +
        `Tujuan: ${esc(x.destination)}`,
        kb(buttons)
      );
    }

    if (!r.rows.length) await send(chat, 'Tidak ada WD aktif.');
    return;
  }

  // Antrean bukti tugas
  if (data === 'adm_proofs' && isAdmin(id)) {
    const r = await q(`
      SELECT c.id,c.user_id,c.task_id,c.proof_text,
             c.proof_file_id,c.proof_file_type,t.title
      FROM task_claims c
      JOIN tasks t ON t.id=c.task_id
      WHERE c.status='pending'
      ORDER BY c.id
      LIMIT 15
    `);

    for (const x of r.rows) {
      await send(
        chat,
        `Bukti #${x.id} — ${esc(x.title)}\n` +
        `Task: #${x.task_id}\n` +
        `User: ${x.user_id}\n` +
        `${esc(x.proof_text || 'Bukti file terlampir')}`,
        kb([[
          { text: '✅ Approve', callback_data: `proof_ok:${x.id}` },
          { text: '❌ Reject', callback_data: `proof_no:${x.id}` }
        ]])
      );

      if (x.proof_file_id) {
        await sendProofFile(
          chat,
          x.proof_file_id,
          x.proof_file_type,
          `Bukti tugas #${x.id}`
        ).catch(() => {});
      }
    }

    if (!r.rows.length) await send(chat, 'Tidak ada bukti pending.');
    return;
  }

  // Kelola tugas
  if (data === 'adm_tasks' && isAdmin(id)) {
    const r = await q(`
      SELECT id,title,status,claimed,slots,budget_locked,
             service_fee,total_budget
      FROM tasks
      ORDER BY id DESC
      LIMIT 15
    `);

    for (const x of r.rows) {
      await send(
        chat,
        `Task #${x.id} ${esc(x.title)}\n` +
        `Status: ${x.status}\n` +
        `Slot terisi: ${x.claimed}/${x.slots}\n` +
        `Sisa anggaran worker: ${money(x.budget_locked)}\n` +
        `Fee layanan awal: ${money(x.service_fee)}`,
        kb([[
          { text: 'Tutup tugas & refund sisa anggaran', callback_data: `task_close:${x.id}` }
        ]])
      );
    }

    if (!r.rows.length) await send(chat, 'Belum ada tugas.');
    return;
  }

  // Statistik admin
  if (data === 'adm_stats' && isAdmin(id)) {
    const r = await q(`
      SELECT
        (SELECT count(*) FROM users) users,
        (SELECT count(*) FROM tasks) tasks,
        (SELECT count(*) FROM deposits WHERE status='pending') deposits,
        (SELECT count(*) FROM withdrawals WHERE status IN ('pending','approved')) wds,
        (SELECT count(*) FROM task_claims WHERE status='pending') proofs,
        (SELECT COALESCE(sum(balance),0) FROM users) balance
    `);

    const x = r.rows[0];

    await send(
      chat,
      `📊 <b>Statistik LIMXIOCUAN</b>\n` +
      `User: ${x.users}\n` +
      `Total tugas: ${x.tasks}\n` +
      `Deposit pending: ${x.deposits}\n` +
      `WD aktif: ${x.wds}\n` +
      `Bukti tugas pending: ${x.proofs}\n` +
      `Total saldo tercatat: ${money(x.balance)}`
    );
    return;
  }

  if (data === 'adm_angpao' && isAdmin(id)) {
    await setSt(id, 'angpao_amount');
    await send(chat, 'Kirim total nominal hadiah Angpao. Saldo admin tidak dipotong.');
    return;
  }

  if (data === 'adm_broadcast' && isAdmin(id)) {
    await setSt(id, 'broadcast');
    await send(chat, 'Kirim isi pengumuman untuk semua pengguna bot dan channel.');
    return;
  }

  // Approve deposit
  if (data.startsWith('dep_ok:') && isAdmin(id)) {
    const n = Number(data.split(':')[1]);

    const out = await withTx(async tx => {
      const r = await tx(`
        UPDATE deposits
        SET status='approved',reviewed_at=NOW()
        WHERE id=$1 AND status='pending'
        RETURNING user_id,amount
      `, [n]);

      if (!r.rows.length) return null;

      const x = r.rows[0];

      await tx(
        'UPDATE users SET balance=balance+$1 WHERE telegram_id=$2',
        [x.amount, x.user_id]
      );

      await txLog(
        tx,
        x.user_id,
        'deposit',
        Number(x.amount),
        `Deposit #${n} disetujui`
      );

      return x;
    });

    if (out) {
      await send(
        out.user_id,
        `✅ Deposit #${n} disetujui. Saldo bertambah ${money(out.amount)}.`
      );
      await send(chat, 'Deposit disetujui dan saldo dikreditkan.');
      await channelPost('✅ Deposit telah diverifikasi admin.');
    } else {
      await send(chat, 'Deposit sudah diproses atau tidak ditemukan.');
    }
    return;
  }

  if (data.startsWith('dep_no:') && isAdmin(id)) {
    const n = Number(data.split(':')[1]);

    const r = await q(`
      UPDATE deposits
      SET status='rejected',reviewed_at=NOW()
      WHERE id=$1 AND status='pending'
      RETURNING user_id
    `, [n]);

    if (r.rows[0]) {
      await send(r.rows[0].user_id, `❌ Deposit #${n} ditolak admin.`);
    }

    await send(chat, r.rows.length ? 'Deposit ditolak.' : 'Deposit sudah diproses.');
    return;
  }

  // Setujui WD: belum dianggap selesai
  if (data.startsWith('wd_ok:') && isAdmin(id)) {
    const n = Number(data.split(':')[1]);

    const r = await q(`
      UPDATE withdrawals
      SET status='approved',reviewed_at=NOW()
      WHERE id=$1 AND status='pending'
      RETURNING user_id,net_amount
    `, [n]);

    if (r.rows[0]) {
      await send(
        r.rows[0].user_id,
        `WD #${n} disetujui untuk diproses. Transfer belum dinyatakan selesai.`
      );

      await send(
        chat,
        'WD disetujui. Silakan transfer manual. Setelah transfer benar-benar dilakukan, tekan konfirmasi selesai di menu WD pending.'
      );
    } else {
      await send(chat, 'WD sudah diproses atau tidak ditemukan.');
    }
    return;
  }

  // Admin konfirmasi transfer benar-benar selesai
  if (data.startsWith('wd_done:') && isAdmin(id)) {
    const n = Number(data.split(':')[1]);

    const r = await q(`
      UPDATE withdrawals
      SET status='completed',completed_at=NOW()
      WHERE id=$1 AND status='approved'
      RETURNING user_id,net_amount
    `, [n]);

    if (r.rows[0]) {
      await send(
        r.rows[0].user_id,
        `✅ WD #${n} selesai. Admin telah mengonfirmasi transfer ${money(r.rows[0].net_amount)}.`
      );

      await channelPost('✅ Penarikan telah selesai dan dikonfirmasi admin.');
      await send(chat, 'WD ditandai selesai.');
    } else {
      await send(chat, 'WD belum disetujui atau sudah selesai.');
    }
    return;
  }

  // Tolak WD dan kembalikan saldo
  if (data.startsWith('wd_no:') && isAdmin(id)) {
    const n = Number(data.split(':')[1]);

    const out = await withTx(async tx => {
      const w = await tx(`
        UPDATE withdrawals
        SET status='rejected',reviewed_at=NOW()
        WHERE id=$1 AND status IN ('pending','approved')
        RETURNING user_id,amount
      `, [n]);

      if (!w.rows.length) return null;

      const x = w.rows[0];

      await tx(
        'UPDATE users SET balance=balance+$1 WHERE telegram_id=$2',
        [x.amount, x.user_id]
      );

      await txLog(
        tx,
        x.user_id,
        'withdraw_refund',
        Number(x.amount),
        `Refund WD #${n}`
      );

      return x;
    });

    if (out) {
      await send(
        out.user_id,
        `❌ WD #${n} ditolak. Saldo ${money(out.amount)} dikembalikan.`
      );
    }

    await send(chat, out ? 'WD ditolak dan saldo dikembalikan.' : 'WD sudah diproses.');
    return;
  }

  // Approve bukti tugas dan beri reward
  if (data.startsWith('proof_ok:') && isAdmin(id)) {
    const n = Number(data.split(':')[1]);

    const out = await withTx(async tx => {
      const c = await tx(`
        SELECT id,user_id,task_id
        FROM task_claims
        WHERE id=$1 AND status='pending'
        FOR UPDATE
      `, [n]);

      if (!c.rows.length) return null;

      const claim = c.rows[0];

      const t = await tx(`
        SELECT worker_reward,reward,funding_per_slot
        FROM tasks
        WHERE id=$1
        FOR UPDATE
      `, [claim.task_id]);

      if (!t.rows.length) throw new Error('TASK_NOT_FOUND');

      const reward = Number(
        t.rows[0].worker_reward ||
        Math.floor(Number(t.rows[0].reward) * 0.95)
      );

      const funding = Number(
        t.rows[0].funding_per_slot || t.rows[0].reward
      );

      await tx(`
        UPDATE task_claims
        SET status='approved',reviewed_at=NOW()
        WHERE id=$1
      `, [n]);

      await tx(
        'UPDATE users SET balance=balance+$1 WHERE telegram_id=$2',
        [reward, claim.user_id]
      );

      await tx(`
        UPDATE tasks
        SET budget_locked=GREATEST(0,budget_locked-$1),
            status=CASE WHEN claimed>=slots THEN 'completed' ELSE status END
        WHERE id=$2
      `, [funding, claim.task_id]);

      await txLog(
        tx,
        claim.user_id,
        'task_reward',
        reward,
        `Reward task #${claim.task_id}`
      );

      // Referral dibayar hanya setelah misi pertama disetujui.
      const ref = await tx(`
        SELECT referrer_id,referral_reward_paid
        FROM users
        WHERE telegram_id=$1
        FOR UPDATE
      `, [claim.user_id]);

      let referral = null;

      if (
        ref.rows[0]?.referrer_id &&
        !ref.rows[0].referral_reward_paid
      ) {
        const referrerId = ref.rows[0].referrer_id;

        const paid = await tx(`
          INSERT INTO referral_rewards(referrer_id,referred_id,amount)
          VALUES($1,$2,1000)
          ON CONFLICT(referred_id) DO NOTHING
          RETURNING id
        `, [referrerId, claim.user_id]);

        if (paid.rows.length) {
          await tx(
            'UPDATE users SET balance=balance+1000 WHERE telegram_id=$1',
            [referrerId]
          );

          await tx(
            'UPDATE users SET referral_reward_paid=TRUE WHERE telegram_id=$1',
            [claim.user_id]
          );

          await txLog(
            tx,
            referrerId,
            'referral',
            1000,
            `Bonus referral misi pertama user ${claim.user_id}`
          );

          referral = referrerId;
        }
      }

      return {
        user: claim.user_id,
        reward,
        task: claim.task_id,
        referral
      };
    });

    if (out) {
      await send(
        out.user,
        `✅ Bukti tugas disetujui. Saldo bertambah ${money(out.reward)}.`
      );

      if (out.referral) {
        await send(
          out.referral,
          '🎉 Bonus referral Rp1.000 masuk karena teman yang lu undang menyelesaikan misi pertamanya.'
        ).catch(() => {});
      }

      await send(chat, 'Bukti disetujui dan reward worker dikreditkan.');
    } else {
      await send(chat, 'Bukti sudah diproses atau tidak ditemukan.');
    }
    return;
  }

  // Reject bukti dan buka slot kembali
  if (data.startsWith('proof_no:') && isAdmin(id)) {
    const n = Number(data.split(':')[1]);

    const out = await withTx(async tx => {
      const r = await tx(`
        UPDATE task_claims
        SET status='rejected',reviewed_at=NOW()
        WHERE id=$1 AND status='pending'
        RETURNING user_id,task_id
      `, [n]);

      if (!r.rows.length) return null;

      await tx(`
        UPDATE tasks
        SET claimed=GREATEST(0,claimed-1)
        WHERE id=$1 AND status='open'
      `, [r.rows[0].task_id]);

      return r.rows[0];
    });

    if (out) {
      await send(
        out.user_id,
        '❌ Bukti tugas ditolak admin. Slot dibuka kembali untuk pengguna lain.'
);
    }

    await send(chat, out ? 'Bukti ditolak.' : 'Bukti sudah diproses.');
    return;
  }

  // Tutup tugas dan refund anggaran worker yang belum dibayarkan
  if (data.startsWith('task_close:') && isAdmin(id)) {
    const n = Number(data.split(':')[1]);

    const out = await withTx(async tx => {
      const t = await tx(`
        UPDATE tasks
        SET status='closed'
        WHERE id=$1 AND status='open'
        RETURNING created_by,budget_locked
      `, [n]);

      if (!t.rows.length) return null;

      await tx(`
        UPDATE task_claims
        SET status='rejected',reviewed_at=NOW()
        WHERE task_id=$1 AND status IN ('claimed','pending')
      `, [n]);

      const refund = Math.max(0, Number(t.rows[0].budget_locked));

      if (refund > 0) {
        await tx(
          'UPDATE users SET balance=balance+$1 WHERE telegram_id=$2',
          [refund, t.rows[0].created_by]
        );

        await txLog(
          tx,
          t.rows[0].created_by,
          'task_refund',
          refund,
          `Refund penutupan task #${n}`
        );
      }

      return {
        owner: t.rows[0].created_by,
        refund
      };
    });

    if (out) {
      await send(
        out.owner,
        `Task #${n} ditutup. Refund sisa anggaran worker: ${money(out.refund)}.`
      );

      await send(
        chat,
        `Task #${n} ditutup. Refund: ${money(out.refund)}. Biaya layanan 5% tidak dikembalikan.`
      );
    } else {
      await send(chat, 'Task sudah ditutup atau tidak ditemukan.');
    }
    return;
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      service: 'LIMXIOCUAN webhook'
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, method: 'POST required' });
    return;
  }

  const secret = process.env.WEBHOOK_SECRET;

  if (
    secret &&
    req.headers['x-telegram-bot-api-secret-token'] !== secret
  ) {
    res.status(401).json({ ok: false });
    return;
  }

  try {
    const update = req.body;

    if (update?.message) {
      await onMessage(update.message);
    }

    if (update?.callback_query) {
      await onCallback(update.callback_query);
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(200).json({
      ok: false,
      error: 'update_failed'
    });
  }
}
