import { q, withTx } from '../lib/db.mjs';
import { tg, send, answer } from '../lib/telegram.mjs';
import { TASK_RATES, calculateTaskBudget, rupiah } from '../lib/task-rates.mjs';
import { calculateDepositFee } from '../lib/deposit-fees.mjs';
import { randomInt } from 'node:crypto';

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
  [{ text: `❤️ Like TikTok - Rp${TASK_RATES.like.reward}`, callback_data: 'category:like' },
   { text: `🔁 Repost - Rp${TASK_RATES.repost.reward}`, callback_data: 'category:repost' }],
  [{ text: `➕ Follow - Rp${TASK_RATES.follow.reward}`, callback_data: 'category:follow' },
   { text: `💬 Komentar - Rp${TASK_RATES.comment.reward}`, callback_data: 'category:comment' }],
  [{ text: `⭐ Favorite - Rp${TASK_RATES.favorite.reward}`, callback_data: 'category:favorite' },
   { text: `🔗 Salin Link 10x - Rp${TASK_RATES.copy_link.reward}`, callback_data: 'category:copy_link' }],
  [{ text: `📤 Share 10 teman - Rp${TASK_RATES.share.reward}`, callback_data: 'category:share' }],
  [{ text: `✈️ Telegram - Rp${TASK_RATES.telegram.reward}`, callback_data: 'category:telegram' },
   { text: `📢 Channel - Rp${TASK_RATES.channel.reward}`, callback_data: 'category:channel' }],
  [{ text: `👥 Group - Rp${TASK_RATES.group.reward}`, callback_data: 'category:group' },
   { text: `🟢 WhatsApp - Rp${TASK_RATES.whatsapp.reward}`, callback_data: 'category:whatsapp' }],
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
  if (isAdmin(id)) return true;
  const ban = await q('SELECT is_banned FROM users WHERE telegram_id=$1',[id]);
  if (ban.rows[0]?.is_banned) { await send(chat,'🚫 Akun diblokir karena pelanggaran bukti. Hubungi admin untuk peninjauan.'); return false; }
  if (await member(id)) return true;

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
  try { return await send(CHANNEL, text, markup); }
  catch (e) { console.error('Channel post failed:', e.message); throw e; }
}

async function setting(key) {
  const r = await q('SELECT value FROM settings WHERE key=$1', [key]);
  return r.rows[0]?.value ?? null;
}

async function saveSetting(key, value) {
  await q(`
    INSERT INTO settings(key,value)
    VALUES($1,$2)
    ON CONFLICT(key)
    DO UPDATE SET value=EXCLUDED.value
  `, [key, String(value)]);
}

function mask(value) {
  const x = String(value || '');
  if (x.length <= 5) return '*'.repeat(x.length);
  return x.slice(0,4) + '*'.repeat(Math.max(3, x.length-7)) + x.slice(-3);
}

function validTarget(category, value) {
  const raw = String(value || '').trim();
  if (category === 'whatsapp') return /^\+?[0-9][0-9\s-]{7,18}$/.test(raw);
  let u; try { u = new URL(raw); } catch { return false; }
  if (!['https:','http:'].includes(u.protocol)) return false;
  const host = u.hostname.toLowerCase().replace(/^www\./,'');
  if (category === 'telegram' || category === 'channel' || category === 'group') return host === 't.me' || host === 'telegram.me';
  if (['like','repost','follow','comment','favorite','copy_link','share'].includes(category)) {
    const allowed = ['tiktok.com','vm.tiktok.com','vt.tiktok.com'];
    return allowed.some(d => host === d || host.endsWith('.'+d));
  }
  return false;
}

async function editAdminAction(c, text) {
  if (!c.message) return;
  const base = { chat_id: c.message.chat.id, message_id: c.message.message_id, reply_markup: { inline_keyboard: [] } };
  try {
    if (c.message.photo || c.message.document) await tg('editMessageCaption', { ...base, caption: text, parse_mode: 'HTML' });
    else await tg('editMessageText', { ...base, text, parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (e) {
    try { await tg('editMessageReplyMarkup', base); } catch {}
    console.error('Admin message edit failed:', e.message);
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

async function sendProofFile(chat, fileId, fileType, caption, markup) {
  if (!fileId) return;

  if (fileType === 'photo') {
    await tg('sendPhoto', {
      chat_id: chat,
      photo: fileId,
      caption,
      parse_mode: 'HTML',
      ...(markup ? { reply_markup: markup } : {})
    });
  } else {
    await tg('sendDocument', {
      chat_id: chat,
      document: fileId,
      caption,
      parse_mode: 'HTML',
      ...(markup ? { reply_markup: markup } : {})
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

async function depositMethods() {
  const qris = await setting('qris_file_id');
  return { qris };
}

async function nextUniqueDepositCode() {
  for (let i=0;i<30;i++) {
    const code = randomInt(1,1000);
    const used = await q("SELECT 1 FROM deposits WHERE status='pending' AND unique_code=$1 LIMIT 1",[code]);
    if (!used.rows.length) return code;
  }
  throw new Error('Kode unik deposit sedang penuh. Coba lagi beberapa saat.');
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
  const markup = kb([[{ text: '📋 Ambil Tugas di Bot', callback_data: `take:${task.id}` }]]);

  const notice =
    `📢 <b>TUGAS BARU #${task.id}</b>\n` +
    `${esc(task.title)}\n` +
    `Kategori: ${esc(task.category)}\n` +
    `Reward worker: ${money(task.worker_reward)}\n` +
    `Slot: ${task.slots}\n` +
    `Link target: ${esc(task.target_url || '-')}\n\n` +
    `Tekan tombol untuk melihat dan mengambil tugas.`;

  await channelPost(notice, markup);
  await notifyAll(notice, markup);
}

async function createTaskNow(chat,id,d) {
  const rate = TASK_RATES[d.category];
  if (!rate || !validTarget(d.category,d.target_url)) throw new Error('Kategori atau target tugas tidak valid.');
  const created = await withTx(async tx => {
    const user = await tx('SELECT balance FROM users WHERE telegram_id=$1 FOR UPDATE',[id]);
    if (!user.rows.length) throw new Error('User tidak ditemukan.');
    if (!isAdmin(id)) {
      if (Number(user.rows[0].balance) < Number(d.total_budget)) throw new Error('SALDO');
      await tx('UPDATE users SET balance=balance-$1 WHERE telegram_id=$2',[d.total_budget,id]);
    }
    const task = await tx(`INSERT INTO tasks(title,description,category,reward,worker_reward,funding_per_slot,slots,claimed,status,created_by,budget_locked,service_fee,total_budget,target_url,target_text,instructions) VALUES($1,$2,$3,$4,$5,$4,$6,0,'open',$7,$8,$9,$10,$11,$12,$2) RETURNING id`,[
      rate.label,rate.label,rate.label,d.base_reward,d.worker_reward,d.slots,id,d.subtotal,d.service_fee,d.total_budget,d.target_url,d.target_text || null
    ]);
    if (!isAdmin(id)) await txLog(tx,id,'task_budget',-Number(d.total_budget),`Anggaran tugas #${task.rows[0].id} termasuk biaya layanan 5%`);
    return task.rows[0].id;
  }).catch(e => { if (e.message === 'SALDO') return null; throw e; });
  if (!created) {
    await clearSt(id);
    await send(chat,`Saldo tidak cukup. Total biaya ${money(d.total_budget)}. Isi saldo lewat menu Deposit.`,menu(id));
    return null;
  }
  await clearSt(id);
  await send(chat,`✅ <b>Tugas #${created} berhasil dibuat.</b>\nKategori: ${esc(rate.label)}\nReward pekerja: ${money(d.worker_reward)}\nSlot: ${d.slots}\nBiaya layanan: ${money(d.service_fee)}\nTotal dipotong: ${money(d.total_budget)}`,menu(id));
  try {
    await publishTask({id:created,title:rate.label,category:rate.label,worker_reward:d.worker_reward,slots:d.slots,target_url:d.target_url});
  } catch (e) {
    console.error('Task publish failed:',e);
    try { await adminNotify(`🚨 Tugas #${created} berhasil dibuat tetapi gagal diposting ke channel.\n${esc(e.message)}`); } catch {}
    await send(chat,`⚠️ Tugas #${created} tersimpan, tetapi gagal diposting ke channel. Admin sudah diberi tahu.`);
  }
  return created;
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
      '👋 Selamat datang di LIMXIOCUAN心想事成\n\n' +
'Platform freelance untuk mengerjakan tugas dan promosi konten TikTok.\n\n' +
'💰 Kerjakan tugas, kumpulkan saldo, dan tarik penghasilanmu.\n' +
'Silakan pilih layanan melalui menu di bawah.',
      menu(id)
    );
    return;
  }

  if (txt === '/admin' && isAdmin(id)) {
    await send(chat, '🛠 <b>Admin Panel LIMXIOCUAN</b>', adminMenu);
    return;
  }

  if (txt.startsWith('/setqris') && isAdmin(id)) {
    await setSt(id,'set_qris');
    await send(chat,'Kirim foto QRIS resmi milikmu. Foto ini disimpan sebagai file Telegram dan tidak diubah.');
    return;
  }
  if (txt.startsWith('/setsaldo') && isAdmin(id)) {
    const [,uid,amount] = txt.split(/\s+/);
    const n = Number(amount);
    if (!/^\d+$/.test(uid || '') || !Number.isSafeInteger(n) || n < 0) { await send(chat,'Format: /setsaldo <telegram_id> <nominal>'); return; }
    const r = await q('UPDATE users SET balance=$1 WHERE telegram_id=$2 RETURNING telegram_id',[n,uid]);
    await send(chat,r.rows.length ? `Saldo user ${uid} diset ke ${money(n)}.` : 'User tidak ditemukan.');
    return;
  }
  if (txt === '/isisaldo' && isAdmin(id)) {
    const r = await q('SELECT count(*) users,COALESCE(sum(balance),0) balance FROM users WHERE telegram_id<>$1',[id]);
    await send(chat,`User terdaftar (tanpa admin): ${r.rows[0].users}\nTotal saldo user: ${money(r.rows[0].balance)}`);
    return;
  }
  if (txt.startsWith('/unban') && isAdmin(id)) {
    const target = txt.split(/\s+/)[1];
    if (!target || !/^\d+$/.test(target)) { await send(chat,'Format: /unban <telegram_id>'); return; }
    await q('UPDATE users SET is_banned=FALSE WHERE telegram_id=$1',[target]);
    const r = await q('DELETE FROM proof_blacklist WHERE first_user_id::text=$1 OR blocked_user_id::text=$1 RETURNING id',[target]);
    await send(chat,`Blacklist user ${target} dibersihkan. Data bukti dihapus: ${r.rowCount}.`);
    return;
  }

  if (!(await gate(chat, id))) return;

  const s = await st(id);
  if (!s) {
    await send(chat, 'Pilih menu lewat /start.', menu(id));
    return;
  }

  const d = s.data || {};

  if (s.state === 'set_qris' && isAdmin(id)) {
    const photo = m.photo?.[m.photo.length-1];
    if (!photo?.file_id) { await send(chat,'Kirim QRIS dalam bentuk foto.'); return; }
    await saveSetting('qris_file_id',photo.file_id);
    await clearSt(id);
    await send(chat,'✅ QRIS berhasil disimpan. Bot akan mengirim gambar asli ini tanpa mengubahnya.');
    return;
  }

  // Buat tugas: jumlah slot
  if (s.state === 'task_slots') {
    const slots = Number(txt);
    const rate = TASK_RATES[d.category];
    if (!rate) { await clearSt(id); await send(chat, 'Kategori tugas tidak valid.'); return; }
    let budget;
    try { budget = calculateTaskBudget(rate.reward, slots); }
    catch (e) { await send(chat, e.message); return; }
    const draft = {
      ...d,
      slots,
      base_reward: rate.reward,
      worker_reward: Math.floor(rate.reward * 0.95),
      funding_per_slot: rate.reward,
      subtotal: budget.subtotal,
      service_fee: budget.serviceFee,
      total_budget: budget.total
    };
    await setSt(id, 'task_target', draft);
    await send(chat,
      `🧾 <b>Rincian biaya tugas</b>\n` +
      `Kategori: ${esc(rate.label)}\n` +
      `Reward pekerja setelah potongan 5%: ${money(draft.worker_reward)} / slot\n` +
      `Slot: ${slots}\n` +
      `Anggaran dasar: ${money(budget.subtotal)}\n` +
      `Biaya layanan 5%: ${money(budget.serviceFee)}\n` +
      `<b>Total saldo yang dipotong: ${money(budget.total)}</b>\n\n` +
      `Sekarang kirim ${taskTargetLabel(d.category)}.`
    );
    return;
  }

  // Buat tugas: target link atau nomor
  if (s.state === 'task_target') {
    if (!validTarget(d.category,txt)) {
      await send(chat,d.category === 'whatsapp'
        ? 'Nomor WhatsApp tidak valid. Kirim nomor HP yang benar.'
        : `Link tidak valid. Gunakan ${['telegram','channel','group'].includes(d.category) ? 'link t.me' : 'link TikTok yang valid'}.`);
      return;
    }
    const draft = {...d,target_url:txt};
    if (TASK_RATES[d.category].fields.includes('target_text')) {
      await setSt(id,'task_target_text',draft);
      await send(chat,d.category === 'comment' ? 'Kirim teks komentar yang harus ditulis pekerja.' : 'Kirim pesan yang harus dikirim pekerja melalui WhatsApp.');
      return;
    }
    await createTaskNow(chat,id,draft);
    return;
  }
  if (s.state === 'task_target_text') {
    if (!txt || txt.length > 1000) { await send(chat,'Teks target wajib 1–1.000 karakter.'); return; }
    await createTaskNow(chat,id,{...d,target_text:txt});
    return;
  }

  // Bukti tugas
  if (s.state === 'proof') {
    const file = getProof(m);

    if (!txt && !file) {
      await send(chat, 'Kirim screenshot foto atau dokumen sebagai bukti.');
      return;
    }

    const r = await withTx(async tx => {
      if (file?.uniqueId) {
        const inserted = await tx(`INSERT INTO proof_blacklist(file_unique_id,first_user_id,first_task_id,blocked_user_id)
          VALUES($1,$2,$3,NULL) ON CONFLICT(file_unique_id) DO NOTHING RETURNING id`,[file.uniqueId,id,d.task_id]);
        if (!inserted.rows.length) {
          await tx('UPDATE proof_blacklist SET blocked_user_id=$1 WHERE file_unique_id=$2',[id,file.uniqueId]);
          await tx('UPDATE users SET is_banned=TRUE WHERE telegram_id=$1',[id]);
          return { duplicate:true };
        }
      }
      const updated = await tx(`UPDATE task_claims SET proof_text=$1,proof_file_id=$2,proof_file_unique_id=$3,proof_file_type=$4,status='pending' WHERE id=$5 AND user_id=$6 AND status='claimed' RETURNING id,task_id`,[txt || null,file?.fileId || null,file?.uniqueId || null,file?.type || null,d.claim,id]);
      if (!updated.rows.length) throw new Error('CLAIM_NOT_FOUND');
      return { claim:updated.rows[0] };
    });
    await clearSt(id);
    if (r.duplicate) {
      await channelPost(`🚫 <b>Blacklist otomatis</b>
User: <code>${mask(id)}</code> terdeteksi menggunakan ulang bukti tugas.`);
      await send(chat,'🚫 Akun diblokir otomatis karena bukti yang dikirim pernah digunakan sebelumnya. Hubungi admin jika ini kekeliruan.');
      return;
    }
    const claim = r.claim;

    const proofButtons = kb([[{text:'✅ Approve',callback_data:`proof_ok:${claim.id}`},{text:'❌ Reject',callback_data:`proof_no:${claim.id}`}]]);
    const proofCaption = `🧾 <b>Bukti tugas #${claim.id}</b>\nTask: #${claim.task_id}\nUser: <code>${id}</code>\n${esc(String(txt || 'Bukti file terlampir').slice(0,500))}`;
    if (file) await sendProofFile(ADMIN,file.fileId,file.type,proofCaption,proofButtons);
    else await adminNotify(proofCaption,proofButtons);

    await send(chat, '✅ Bukti terkirim ke admin. Reward masuk setelah admin menyetujui.');
    return;
  }

  // Deposit: nominal
  if (s.state === 'deposit_amount') {
    if (!/^\d+$/.test(txt)) { await send(chat, 'Nominal harus angka saja tanpa titik atau koma.'); return; }
    const n = Number(txt);
    let fee;
    try { fee = calculateDepositFee(n); }
    catch (e) { await send(chat, e.message); return; }
    const uniqueCode = await nextUniqueDepositCode();
    const total = n + fee + uniqueCode;
    await setSt(id, 'deposit_method', { amount: n, fee, unique_code: uniqueCode, total_paid: total });
    const b = await q('SELECT balance FROM users WHERE telegram_id=$1', [id]);
    const qris = await depositMethods();
    const rows = [[{ text: 'GoPay', callback_data: 'dep_method:gopay' }]];
    if (qris.qris) rows.push([{ text: 'QRIS', callback_data: 'dep_method:qris' }]);
    if (process.env.PAYMENT_BANK) rows.push([{ text: 'Bank', callback_data: 'dep_method:bank' }]);
    await send(chat,
      `💳 <b>Rincian deposit</b>\nSaldo sekarang: ${money(b.rows[0]?.balance || 0)}\n` +
      `Nominal saldo: ${money(n)}\nBiaya admin: ${money(fee)}\nKode unik: ${uniqueCode}\n` +
      `<b>Total transfer: ${money(total)}</b>\n\nPilih metode pembayaran:`, kb(rows));
    return;
  }

  if (s.state === 'deposit_method') {
    await send(chat, 'Pilih metode pembayaran melalui tombol yang tersedia.');
    return;
  }

  if (s.state === 'deposit_proof') {
    const file = getProof(m);
    if (!file) { await send(chat, 'Kirim foto bukti pembayaran sebagai gambar.'); return; }
    const duplicate = await q('SELECT id FROM deposits WHERE proof_file_unique_id=$1 LIMIT 1', [file.uniqueId]);
    if (duplicate.rows.length) { await send(chat, '❌ Foto bukti ini sudah pernah digunakan.'); return; }
    const r = await q(`
      INSERT INTO deposits(user_id,amount,fee,total_paid,method,proof_file_id,proof_text,proof_file_type,proof_file_unique_id,unique_code,unique_total)
      VALUES($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$4) RETURNING id
    `, [id,d.amount,d.fee,d.total_paid,d.method,file.fileId,file.type,file.uniqueId,d.unique_code]);
    const dep = r.rows[0].id;
    await clearSt(id);
    const caption = `💳 <b>Deposit #${dep}</b>\nUser: <code>${id}</code>\nNominal saldo: ${money(d.amount)}\nFee: ${money(d.fee)}\nKode unik: ${d.unique_code}\nTotal harus dibayar: ${money(d.total_paid)}\nMetode: ${esc(d.method)}\nWaktu: ${new Date().toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})}`;
    const buttons = kb([[{text:'✅ Approve',callback_data:`dep_ok:${dep}`},{text:'❌ Reject',callback_data:`dep_no:${dep}`}]]);
    await sendProofFile(ADMIN,file.fileId,file.type,caption,buttons);
    await send(chat, '✅ Bukti deposit diterima. Saldo akan masuk setelah admin memeriksa dan menyetujui.');
    return;
  }

  // WD: nominal, nomor, nama penerima, konfirmasi
  if (s.state === 'withdraw_amount') {
    if (isAdmin(id)) { await clearSt(id); await send(chat,'Akun admin tidak dapat melakukan WD.'); return; }
    if (!/^\d+$/.test(txt)) { await send(chat, 'Nominal WD harus angka saja.'); return; }
    const n = Number(txt);
    if (!Number.isSafeInteger(n) || n < 15000) { await send(chat, 'Minimal WD Rp15.000.'); return; }
    const b = await q('SELECT balance FROM users WHERE telegram_id=$1',[id]);
    if (!b.rows.length || Number(b.rows[0].balance) < n) { await send(chat, `Saldo tidak cukup. Saldo kamu ${money(b.rows[0]?.balance || 0)}.`); return; }
    await setSt(id,'withdraw_phone',{...d,amount:n});
    await send(chat,`Nominal WD: ${money(n)}\nBiaya admin: Rp3.000\nDiterima: ${money(n-3000)}\nKirim nomor HP yang terdaftar di ${esc(d.method)}.`);
    return;
  }
  if (s.state === 'withdraw_phone') {
    const phone = txt.replace(/[\s-]/g,'');
    if (!/^\+?62\d{8,13}$/.test(phone) && !/^08\d{8,11}$/.test(phone)) { await send(chat,'Nomor HP tidak valid. Contoh: 081234567890.'); return; }
    await setSt(id,'withdraw_name',{...d,phone});
    await send(chat,'Kirim nama pemilik akun e-wallet.');
    return;
  }
  if (s.state === 'withdraw_name') {
    if (txt.length < 2 || txt.length > 80) { await send(chat,'Nama penerima tidak valid.'); return; }
    const draft = {...d,recipient_name:txt};
    await setSt(id,'withdraw_confirm',draft);
    await send(chat,`<b>Konfirmasi WD</b>\nMetode: ${esc(d.method)}\nNomor: ${esc(d.phone)}\nNama: ${esc(txt)}\nNominal: ${money(d.amount)}\nFee: Rp3.000\nDiterima: ${money(d.amount-3000)}`,kb([
      [{text:'✅ Konfirmasi WD',callback_data:'wd_confirm'}],[{text:'❌ Batal',callback_data:'withdraw_cancel'}]
    ]));
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

    const post = await channelPost(notice, markup);
    await q('UPDATE angpaos SET channel_message_id=$1 WHERE id=$2',[post.message_id,aid]);
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
  const chat = isAdmin(c.from.id) ? c.message.chat.id : c.from.id;
  const data = c.data || '';

  await upsertUser(c.from);
  if (!data.startsWith('claim_angpao:')) await answer(c.id).catch(() => {});

  if (data === 'check_join') {
    if (await member(id)) {
      await send(chat, '✅ Keanggotaan terverifikasi.', menu(id));
    } else {
      await gate(chat, id);
    }
    return;
  }

  if (!(await gate(chat, id))) return;

  if (data.startsWith('dep_method:')) {
    const s = await st(id);
    if (!s || s.state !== 'deposit_method') { await answer(c.id,'Sesi deposit tidak ditemukan.',true); return; }
    const method = data.split(':')[1].toUpperCase();
    if (method === 'QRIS') {
      const fileId = await setting('qris_file_id');
      if (!fileId) { await answer(c.id,'QRIS belum diatur admin.',true); return; }
      await setSt(id,'deposit_proof',{...s.data,method:'QRIS'});
      await tg('sendPhoto',{chat_id:chat,photo:fileId,caption:`QRIS resmi XIOLIM, PULSA & INTERNET\nTransfer tepat: ${money(s.data.total_paid)}\nSetelah transfer, kirim foto bukti pembayaran.`});
      return;
    }
    if (method === 'BANK' && !process.env.PAYMENT_BANK) { await answer(c.id,'Bank belum diaktifkan.',true); return; }
    await setSt(id,'deposit_proof',{...s.data,method});
    await send(chat,method === 'GOPAY'
      ? `Transfer ke GoPay 085188727786 atas nama Abdul Halim sebesar ${money(s.data.total_paid)}. Setelah itu kirim foto bukti.`
      : `Transfer ke rekening admin: ${process.env.PAYMENT_BANK}. Total ${money(s.data.total_paid)}. Setelah itu kirim foto bukti.`);
    return;
  }
  if (data.startsWith('wd_method:')) {
    const s = await st(id);
    if (!s || s.state !== 'withdraw_method') { await answer(c.id,'Sesi WD tidak ditemukan.',true); return; }
    const method = data.split(':')[1];
    if (!['DANA','GOPAY','OVO'].includes(method)) { await answer(c.id,'Metode tidak valid.',true); return; }
    await setSt(id,'withdraw_amount',{method});
    await send(chat,`Metode WD: ${method}.\nKirim nominal WD (angka saja). Minimal Rp15.000. Fee admin Rp3.000.`);
    return;
  }
  if (data === 'withdraw_cancel') { await clearSt(id); await send(chat,'Permintaan WD dibatalkan.',menu(id)); return; }
  if (data === 'wd_confirm') {
    const s = await st(id);
    if (!s || s.state !== 'withdraw_confirm') { await answer(c.id,'Sesi WD tidak ditemukan.',true); return; }
    const d = s.data;
    const result = await withTx(async tx => {
      const u = await tx('UPDATE users SET balance=balance-$1 WHERE telegram_id=$2 AND balance >= $1 RETURNING telegram_id',[d.amount,id]);
      if (!u.rows.length) throw new Error('SALDO');
      const dest = `${d.method} ${d.phone} a.n. ${d.recipient_name}`;
      const w = await tx(`INSERT INTO withdrawals(user_id,amount,fee,net_amount,destination,method,phone,recipient_name) VALUES($1,$2,3000,$3,$4,$5,$6,$7) RETURNING id`,[id,d.amount,d.amount-3000,dest,d.method,d.phone,d.recipient_name]);
      await txLog(tx,id,'withdraw_hold',-d.amount,`WD #${w.rows[0].id}`);
      return w.rows[0].id;
    }).catch(e => { if (e.message === 'SALDO') return null; throw e; });
    await clearSt(id);
    if (!result) { await send(chat,'Saldo tidak cukup.'); return; }
    const cap = `📤 <b>WD #${result}</b>\nUser: <code>${id}</code>\nNominal: ${money(d.amount)}\nFee: Rp3.000\nTransfer bersih: ${money(d.amount-3000)}\nMetode: ${d.method}\nNomor: ${mask(d.phone)}\nNama: ${esc(d.recipient_name)}`;
    await adminNotify(cap,kb([[{text:'✅ Setujui untuk transfer',callback_data:`wd_ok:${result}`},{text:'❌ Tolak & refund',callback_data:`wd_no:${result}`}]]));
    await send(chat,'Permintaan WD masuk antrean admin. Saldo ditahan sampai diproses.');
    return;
  }

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
    if (!rate) { await answer(c.id,'Kategori tidak dikenal.',true); return; }
    const s = await st(id);
    if (!s || s.state !== 'task_category') { await answer(c.id,'Sesi pembuatan tugas tidak ditemukan.',true); return; }
    await setSt(id,'task_slots',{category});
    await send(chat,`Kategori: <b>${esc(rate.label)}</b>\nTarif dasar: ${money(rate.reward)}\nReward pekerja setelah potongan 5%: ${money(Math.floor(rate.reward*0.95))}\n\nKirim jumlah slot (10–10.000).`);
    return;
  }

  // Publikasikan tugas
  if (data === 'create_confirm') {
    const s = await st(id);
    if (!s || s.state !== 'task_confirm') { await answer(c.id,'Draft tugas tidak ditemukan.',true); return; }
    const d = s.data;
    const rate = TASK_RATES[d.category];
    if (!rate || !validTarget(d.category,d.target_url)) { await send(chat,'Kategori atau target tidak valid.'); return; }
    const created = await withTx(async tx => {
      const user = await tx('SELECT balance FROM users WHERE telegram_id=$1 FOR UPDATE',[id]);
      if (!user.rows.length) throw new Error('USER_NOT_FOUND');
      if (!isAdmin(id)) {
        if (Number(user.rows[0].balance) < Number(d.total_budget)) throw new Error('SALDO');
        await tx('UPDATE users SET balance=balance-$1 WHERE telegram_id=$2',[d.total_budget,id]);
      }
      const title = `${rate.label}`;
      const task = await tx(`INSERT INTO tasks(title,description,category,reward,worker_reward,funding_per_slot,slots,claimed,status,created_by,budget_locked,service_fee,total_budget,target_url,target_text,instructions) VALUES($1,$2,$3,$4,$5,$4,$6,0,'open',$7,$8,$9,$10,$11,$12,$2) RETURNING id`,[
        title, rate.label, rate.label, d.base_reward, d.worker_reward, d.slots, id, d.subtotal, d.service_fee, d.total_budget, d.target_url, d.target_text || null
      ]);
      if (!isAdmin(id)) await txLog(tx,id,'task_budget',-Number(d.total_budget),`Anggaran tugas #${task.rows[0].id} termasuk biaya layanan 5%`);
      return task.rows[0].id;
    }).catch(e => { if (e.message === 'SALDO') return null; throw e; });
    if (!created) { await send(chat,`Saldo tidak cukup. Biaya ${money(d.total_budget)}. Isi saldo lewat menu Deposit.`,menu(id)); return; }
    await clearSt(id);
    await send(chat,`✅ <b>Tugas #${created} berhasil dibuat dan dipublikasikan.</b>\nReward pekerja: ${money(d.worker_reward)}\nSlot: ${d.slots}\nTotal potong saldo: ${money(d.total_budget)}`,menu(id));
    await publishTask({id:created,title:rate.label,category:rate.label,worker_reward:d.worker_reward,slots:d.slots,target_url:d.target_url});
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
    await setSt(id, 'task_category');
    await send(chat, 'Pilih kategori tugas. Tarif ditampilkan pada tombol:', kb(categoryRows));
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
    const b = await q('SELECT balance FROM users WHERE telegram_id=$1',[id]);
    await setSt(id,'deposit_amount');
    await send(chat,`💳 <b>Deposit</b>\nSaldo sekarang: ${money(b.rows[0]?.balance || 0)}\nMinimal: Rp5.000\nMaksimal: Rp300.000\nBiaya admin: Rp2.000–Rp10.000 sesuai nominal\nKode unik transfer: Rp1–Rp999\nBonus: tidak ada bonus deposit.\n\nKirim nominal angka saja (kelipatan Rp1.000).`);
    return;
  }

  if (data === 'withdraw') {
    if (isAdmin(id)) { await send(chat,'Akun admin tidak dapat melakukan WD.'); return; }
    await setSt(id,'withdraw_method',{});
    await send(chat,'Pilih metode penarikan:',kb([[{text:'DANA',callback_data:'wd_method:DANA'},{text:'GoPay',callback_data:'wd_method:GOPAY'},{text:'OVO',callback_data:'wd_method:OVO'}]]));
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
      WHERE telegram_id<>$1
      ORDER BY balance DESC
      LIMIT 10
    `,[ADMIN || '0']);

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
    '<b>TENTANG LIMXIOCUAN心想事成</b>\n\n' +
    'LIMXIOCUAN adalah bot freelance TikTok yang memungkinkan Anda:\n' +
    '✅ Mengerjakan tugas\n' +
    '✅ Membuat tugas untuk promosi konten TikTok\n' +
    '✅ Mendapat bonus referral\n' +
    '✅ Penarikan ke DANA, GoPay, OVO\n\n' +

    '💵 <b>Rate Tugas:</b>\n' +
    '• 👍 Like: Rp110\n' +
    '• ♻️ Posting Ulang: Rp100\n' +
    '• 👱 Follow: Rp1.300\n' +
    '• 💬 Komentar: Rp700\n' +
    '• 🗄️ Favorite: Rp550\n' +
    '• 📎 Salin Tautan 10x: Rp350\n' +
    '• 🤝 Bagikan ke 10 Teman: Rp900\n' +
    '• 📎 Telegram: Rp750\n' +
    '• 🪩 Channel: Rp500\n' +
    '• 🪩 Group: Rp500\n' +
    '• 💬 Whatsapp: Rp850\n\n' +

    '📜 <b>Syarat & Ketentuan:</b>\n' +
    '• Akun harus nama manusia, unsur nama orang Indonesia\n' +
    '• Akun memiliki foto profil\n' +
    '• Akun boleh baru atau lama\n\n' +

    '<b>Peraturan:</b>\n' +
    '• Tugas ditolak 5x = akun diblokir 24 jam & saldo di-reset Rp0\n' +
    '• Setiap tugas hanya bisa dikerjakan 1x per user\n' +
    '• Bukti kerja WAJIB screenshot, lalu menunggu ACC admin\n' +
    '• Screenshot yang sama / palsu = BLACKLIST PERMANEN\n' +
    '• Link harus valid (jenis khusus boleh TikTok / Telegram / WhatsApp). Slot: min 10 (Like & Posting Ulang min 50)'
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

      await answer(c.id,'Berhasil klaim angpao!');
      await send(id, `🎉 Berhasil klaim ${money(amount)}!`);
      const remaining = await q('SELECT remaining_winners,channel_message_id FROM angpaos WHERE id=$1',[aid]);
      if (Number(remaining.rows[0]?.remaining_winners) === 0) {
        try { await tg('editMessageReplyMarkup',{chat_id:CHANNEL,message_id:remaining.rows[0].channel_message_id,reply_markup:{inline_keyboard:[]}}); } catch {}
      }
    } catch (e) {
      await tg('answerCallbackQuery',{callback_query_id:c.id,text:e.message === 'HABIS' ? 'Angpao sudah habis.' : 'Kamu sudah klaim atau klaim gagal.',show_alert:true});
      if (e.message === 'HABIS' && c.message?.chat?.type === 'channel') { try { await tg('editMessageReplyMarkup',{chat_id:c.message.chat.id,message_id:c.message.message_id,reply_markup:{inline_keyboard:[]}}); } catch {} }
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
      const buttons = kb([[{text:'Approve',callback_data:`dep_ok:${x.id}`},{text:'Reject',callback_data:`dep_no:${x.id}`}]]);
      const cap = `Deposit #${x.id}\nUser: ${x.user_id}\nSaldo: ${money(x.amount)}\nFee: ${money(x.fee)}\nTotal: ${money(x.total_paid)}\nMetode: ${esc(x.method)}\n${esc(x.proof_text || '')}`;
      if (x.proof_file_id) await sendProofFile(chat,x.proof_file_id,x.proof_file_type,cap,buttons);
      else await send(chat,cap,buttons);
    }

    if (!r.rows.length) await send(chat, 'Tidak ada deposit pending.');
    return;
  }

  // Daftar WD
  if (data === 'adm_wds' && isAdmin(id)) {
    const r = await q(`
      SELECT id,user_id,amount,fee,net_amount,destination,status,method,phone,recipient_name
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
        `Metode: ${esc(x.method || '—')}\nNomor: ${esc(x.phone || x.destination || '—')}\nNama: ${esc(x.recipient_name || '—')}`,
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
      const buttons = kb([[{text:'✅ Approve',callback_data:`proof_ok:${x.id}`},{text:'❌ Reject',callback_data:`proof_no:${x.id}`}]]);
      const cap = `Bukti #${x.id} — ${esc(x.title)}\nTask: #${x.task_id}\nUser: ${x.user_id}\n${esc(x.proof_text || 'Bukti file terlampir')}`;
      if (x.proof_file_id) await sendProofFile(chat,x.proof_file_id,x.proof_file_type,cap,buttons);
      else await send(chat,cap,buttons);
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
        (SELECT count(*) FROM users WHERE telegram_id<>$1) users,
        (SELECT count(*) FROM tasks) tasks,
        (SELECT count(*) FROM deposits WHERE status='pending') deposits,
        (SELECT count(*) FROM withdrawals WHERE status IN ('pending','approved')) wds,
        (SELECT count(*) FROM task_claims WHERE status='pending') proofs,
        (SELECT COALESCE(sum(balance),0) FROM users WHERE telegram_id<>$1) balance
    `,[ADMIN || '0']);

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
        RETURNING user_id,amount,method
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
      await editAdminAction(c,`✅ <b>DEPOSIT #${n} DISETUJUI</b>\nSaldo ${money(out.amount)} telah dikreditkan ke user <code>${out.user_id}</code>.`);
      await channelPost(
  `✅ <b>DEPOSIT BERHASIL</b>\n` +
  `User: ${mask(out.user_id)}\n` +
  `Nominal deposit: ${money(out.amount)}\n` +
  `Metode: ${esc(out.method || '-')}`
);
} else {
      await editAdminAction(c, `ℹ️ <b>DEPOSIT #${n} SUDAH DIPROSES / TIDAK DITEMUKAN</b>`);
    }
    return;
  }

  if (data.startsWith('dep_no:') && isAdmin(id)) {
    const n = Number(data.split(':')[1]);

    const r = await withTx(tx => tx(`UPDATE deposits SET status='rejected',reviewed_at=NOW() WHERE id=$1 AND status='pending' RETURNING user_id`,[n]));
    if (r.rows[0]) await send(r.rows[0].user_id,`❌ Deposit #${n} ditolak admin. Silakan periksa pembayaran dan ajukan ulang bila perlu.`);
    await editAdminAction(c,r.rows.length ? `❌ <b>DEPOSIT #${n} DITOLAK</b>` : `ℹ️ <b>DEPOSIT #${n} SUDAH DIPROSES</b>`);
    await send(chat,r.rows.length ? 'Deposit ditolak.' : 'Deposit sudah diproses.');
    return;
  }

  // Setujui WD: status hanya menjadi approved; belum dianggap selesai.
  if (data.startsWith('wd_ok:') && isAdmin(id)) {
    const n = Number(data.split(':')[1]);
    const r = await withTx(async tx => tx(`
      UPDATE withdrawals
      SET status='approved',reviewed_at=NOW()
      WHERE id=$1 AND status='pending'
      RETURNING user_id,amount,fee,net_amount,method,phone,recipient_name
    `, [n]));

    if (!r.rows.length) {
      await editAdminAction(c, `ℹ️ <b>WD #${n} SUDAH DIPROSES / TIDAK DITEMUKAN</b>`);
      return;
    }

    const w = r.rows[0];
    let post = null;
    try {
      post = await channelPost(
        `📤 <b>WD SEDANG DIPROSES</b>\n` +
        `User: ${mask(w.user_id)}\n` +
        `Nominal WD: ${money(w.amount)}\n` +
        `Biaya: ${money(w.fee)}\n` +
        `Nominal transfer: ${money(w.net_amount)}\n` +
        `Metode: ${esc(w.method || '-')}\n` +
        `Nomor tujuan: ${mask(w.phone || '')}`
      );
      await q("UPDATE withdrawals SET channel_message_id=$1 WHERE id=$2 AND status='approved'", [post.message_id,n]);
    } catch (e) {
      console.error('WD channel notice failed:', e.message);
      try { await adminNotify(`⚠️ WD #${n} sudah disetujui untuk transfer, tetapi notifikasi channel gagal: ${esc(e.message)}`); } catch {}
    }

    await send(w.user_id, `WD #${n} disetujui. Transfer bersih ${money(w.net_amount)} sedang diproses admin.`);
    await editAdminAction(c, `🟡 <b>WD #${n} DISETUJUI — MENUNGGU TRANSFER</b>`);
    return;
  }

  // Admin konfirmasi transfer benar-benar selesai
  if (data.startsWith('wd_done:') && isAdmin(id)) {
    const n = Number(data.split(':')[1]);

    const r = await withTx(tx => tx(`UPDATE withdrawals SET status='completed',completed_at=NOW() WHERE id=$1 AND status='approved' RETURNING user_id,net_amount,channel_message_id`,[n]));
    if (r.rows[0]) {
      await send(r.rows[0].user_id,`✅ WD #${n} selesai. Transfer ${money(r.rows[0].net_amount)} telah dikonfirmasi admin.`);
      if (r.rows[0].channel_message_id) await tg('editMessageText',{chat_id:CHANNEL,message_id:r.rows[0].channel_message_id,text:`✅ <b>WD SELESAI</b>\nUser: ${mask(r.rows[0].user_id)}\nTransfer telah dikonfirmasi admin.`,parse_mode:'HTML'});
      await editAdminAction(c,`✅ <b>WD #${n} SELESAI</b>`);
    } else await editAdminAction(c,`ℹ️ <b>WD #${n} BELUM DISETUJUI / SUDAH SELESAI</b>`);
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
        RETURNING user_id,amount,channel_message_id
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
      await send(out.user_id,`❌ WD #${n} ditolak. Saldo ${money(out.amount)} dikembalikan.`);
      if (out.channel_message_id) { try { await tg('editMessageText',{chat_id:CHANNEL,message_id:out.channel_message_id,text:`❌ <b>WD DITOLAK</b>\nUser: ${mask(out.user_id)}\nSaldo dikembalikan.`,parse_mode:'HTML'}); } catch {} }
    }

    await editAdminAction(c,out ? `❌ <b>WD #${n} DITOLAK — SALDO DIREFUND</b>` : `ℹ️ <b>WD #${n} SUDAH DIPROSES</b>`);
    await send(chat,out ? 'WD ditolak dan saldo dikembalikan.' : 'WD sudah diproses.');
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

      await editAdminAction(c,`✅ <b>BUKTI #${n} DISETUJUI</b>\nReward ${money(out.reward)} dikreditkan.`);
    } else {
      await editAdminAction(c,`ℹ️ <b>BUKTI #${n} SUDAH DIPROSES</b>`);
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

    await editAdminAction(c,out ? `❌ <b>BUKTI #${n} DITOLAK</b>` : `ℹ️ <b>BUKTI #${n} SUDAH DIPROSES</b>`);
    await send(chat,out ? 'Bukti ditolak.' : 'Bukti sudah diproses.');
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

      if (refund > 0 && String(t.rows[0].created_by) !== ADMIN) {
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
        refund: String(t.rows[0].created_by) === ADMIN ? 0 : refund
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
    const update = req.body || {};
    const userId = update.message?.from?.id || update.callback_query?.from?.id;
    const chatId = update.message?.chat?.id || (update.callback_query?.from?.id);
    const detail = String(e?.message || e).slice(0,700);
    if (chatId) { try { await send(chatId,'⚠️ Proses gagal karena terjadi kesalahan. Tidak ada status berhasil yang diklaim. Silakan coba lagi atau hubungi admin.'); } catch {} }
    if (ADMIN) { try { await send(ADMIN,`🚨 <b>WEBHOOK ERROR</b>\nUser: <code>${userId || '-'}</code>\n${esc(detail)}`); } catch {} }
    res.status(200).json({ ok: false, error: 'update_failed' });
  }
}
