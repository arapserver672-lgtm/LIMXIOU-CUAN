// Tarif tugas ala BUZZCUAN.
// Creator bayar: harga x slot + pajak 4%.
// Worker terima: harga - pajak 4%.

export const SERVICE_TAX_RATE = 0.04; // dibayar creator di atas harga
export const WORKER_TAX_RATE = 0.04;  // dipotong dari bayaran worker

export const rupiah = n =>
  'Rp' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// reward = harga per slot. fields = input tambahan dari creator.
// platform = dipakai untuk validasi link/nomor.
export const TASK_RATES = {
  like: {
    label: 'Like', icon: '👍', reward: 110, min: 10, max: 10000,
    platform: 'tiktok-video', fields: [],
    title: 'Like video TikTok',
    instructions: 'Buka link video TikTok, tekan Like, lalu kirim screenshot bukti.'
  },
  repost: {
    label: 'Posting Ulang', icon: '♻️', reward: 100, min: 50, max: 10000,
    platform: 'tiktok-video', fields: [],
    title: 'Posting ulang video TikTok',
    instructions: 'Buka link video TikTok, tekan Posting Ulang (Repost), lalu kirim screenshot bukti.'
  },
  follow: {
    label: 'Follow', icon: '👤', reward: 1300, min: 10, max: 10000,
    platform: 'tiktok-profile', fields: [],
    title: 'Follow akun TikTok',
    instructions: 'Buka link profil TikTok, tekan Follow, lalu kirim screenshot bukti.'
  },
  comment: {
    label: 'Komentar', icon: '💬', reward: 700, min: 10, max: 10000,
    platform: 'tiktok-video', fields: ['target_text'],
    title: 'Komentar di video TikTok',
    instructions: 'Buka link video TikTok, tulis komentar sesuai teks wajib, lalu kirim screenshot bukti.'
  },
  favorite: {
    label: 'Favorite', icon: '⭐', reward: 550, min: 10, max: 10000,
    platform: 'tiktok-video', fields: [],
    title: 'Favorite video TikTok',
    instructions: 'Buka link video TikTok, tekan Favorite (simpan), lalu kirim screenshot bukti.'
  },
  copy_link: {
    label: 'Salin Tautan 10x', icon: '🔗', reward: 350, min: 10, max: 10000,
    platform: 'tiktok-video', fields: [],
    title: 'Salin tautan video TikTok 10x',
    instructions: 'Buka video TikTok, tekan Bagikan lalu Salin Tautan sebanyak 10 kali, kirim screenshot bukti.'
  },
  share: {
    label: 'Bagikan 10 Teman', icon: '🤝', reward: 900, min: 10, max: 10000,
    platform: 'tiktok-video', fields: [],
    title: 'Bagikan video TikTok ke 10 teman',
    instructions: 'Bagikan video TikTok ke 10 teman, lalu kirim screenshot bukti.'
  },
  telegram: {
    label: 'Telegram', icon: '📎', reward: 750, min: 10, max: 10000,
    platform: 'telegram', fields: [],
    title: 'Tugas Telegram',
    instructions: 'Buka link Telegram, ikuti instruksi di tujuan, lalu kirim screenshot bukti.'
  },
  channel: {
    label: 'Channel', icon: '📢', reward: 500, min: 10, max: 10000,
    platform: 'telegram', fields: [],
    title: 'Join channel Telegram',
    instructions: 'Join channel di link berikut, lalu kirim screenshot bukti.'
  },
  group: {
    label: 'Group', icon: '👥', reward: 500, min: 10, max: 10000,
    platform: 'telegram', fields: [],
    title: 'Join grup Telegram',
    instructions: 'Join grup di link berikut, lalu kirim screenshot bukti.'
  },
  whatsapp: {
    label: 'WhatsApp', icon: '💬', reward: 850, min: 10, max: 10000,
    platform: 'whatsapp', fields: ['target_text'],
    title: 'Kirim pesan WhatsApp',
    instructions: 'Kirim pesan WhatsApp ke nomor tujuan sesuai teks wajib, lalu kirim screenshot bukti.'
  }
};

export function calculateTaskBudget(reward, slots, { min = 10, max = 10000 } = {}) {
  if (!Number.isInteger(slots) || slots < min || slots > max) {
    throw new Error(`Slot harus ${min} sampai ${max}. Kirim angka saja.`);
  }
  const subtotal = Number(reward) * slots;
  const serviceFee = Math.round(subtotal * SERVICE_TAX_RATE);
  return { subtotal, serviceFee, total: subtotal + serviceFee };
}

export function workerPayout(price) {
  const tax = Math.round(Number(price) * WORKER_TAX_RATE);
  return { tax, net: Number(price) - tax };
}

const TIKTOK_SHORT = new Set(['vm.tiktok.com', 'vt.tiktok.com']);

// Return { ok:true, value } atau { ok:false, error }
export function validateTarget(category, raw) {
  const rate = TASK_RATES[category];
  const s = String(raw || '').trim();

  if (!rate) return { ok: false, error: 'Kategori tidak dikenal.' };
  if (s.length < 3 || s.length > 500) {
    return { ok: false, error: 'Input tidak valid. Kirim link atau nomor yang benar.' };
  }

  if (rate.platform === 'whatsapp') {
    const digits = s.replace(/[\s\-().+]/g, '');
    if (!/^\d{8,15}$/.test(digits)) {
      return { ok: false, error: 'Kirim nomor WhatsApp yang valid (8–15 digit), contoh: 628123456789.' };
    }
    return { ok: true, value: digits };
  }

  let u;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
  } catch {
    return { ok: false, error: 'Link tidak valid.' };
  }
  if (!['http:', 'https:'].includes(u.protocol)) {
    return { ok: false, error: 'Link tidak valid.' };
  }

  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname;

  if (rate.platform === 'tiktok-video' || rate.platform === 'tiktok-profile') {
    const isTikTok = host === 'tiktok.com' || host.endsWith('.tiktok.com');
    if (!isTikTok) {
      return { ok: false, error: '❌ Link harus dari TikTok (tiktok.com, vm.tiktok.com, atau vt.tiktok.com).' };
    }
    const short = TIKTOK_SHORT.has(host) || path.startsWith('/t/');
    if (rate.platform === 'tiktok-video' && !short && !path.includes('/video/')) {
      return { ok: false, error: '❌ Itu bukan link video TikTok. Contoh: https://www.tiktok.com/@akun/video/123...' };
    }
    if (rate.platform === 'tiktok-profile' && !short && !path.startsWith('/@')) {
      return { ok: false, error: '❌ Itu bukan link profil TikTok. Contoh: https://www.tiktok.com/@akun' };
    }
    return { ok: true, value: u.href };
  }

  if (rate.platform === 'telegram') {
    if (!['t.me', 'telegram.me', 'telegram.dog'].includes(host) || path.length < 2) {
      return { ok: false, error: '❌ Link harus link Telegram (t.me/...).' };
    }
    return { ok: true, value: u.href };
  }

  return { ok: false, error: 'Kategori tidak dikenal.' };
}
