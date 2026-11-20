
export const TASK_RATES = {
  like: {
    label: 'Like TikTok',
    reward: 110,
    fields: ['target_url']
  },
  repost: {
    label: 'Posting Ulang TikTok',
    reward: 100,
    fields: ['target_url']
  },
  follow: {
    label: 'Follow TikTok',
    reward: 1300,
    fields: ['target_url']
  },
  comment: {
    label: 'Komentar TikTok',
    reward: 700,
    fields: ['target_url', 'target_text']
  },
  favorite: {
    label: 'Favorite TikTok',
    reward: 550,
    fields: ['target_url']
  },
  copy_link: {
    label: 'Salin Tautan 10x',
    reward: 350,
    fields: ['target_url']
  },
  share: {
    label: 'Bagikan ke 10 Teman',
    reward: 900,
    fields: ['target_url']
  },
  telegram: {
    label: 'Tugas Telegram',
    reward: 750,
    fields: ['target_url']
  },
  channel: {
    label: 'Join Channel',
    reward: 500,
    fields: ['target_url']
  },
  group: {
    label: 'Join Group',
    reward: 500,
    fields: ['target_url']
  },
  whatsapp: {
    label: 'Tugas WhatsApp',
    reward: 850,
    fields: ['no hp', 'target_text']
  }
};

export const MIN_TASK_SLOTS = 10;
export const MAX_TASK_SLOTS = 10000;
export const MIN_TASK_BUDGET = 5000;
export const SERVICE_FEE_PERCENT = 5;

export function calculateTaskBudget(reward, slots) {
  if (!Number.isSafeInteger(slots) ||
      slots < MIN_TASK_SLOTS ||
      slots > MAX_TASK_SLOTS) {
    throw new Error('Slot harus 10 sampai 10.000.');
  }

  if (!Number.isSafeInteger(reward) || reward <= 0) {
    throw new Error('Reward tidak valid.');
  }

  const subtotal = reward * slots;

  if (!Number.isSafeInteger(subtotal) ||
      subtotal < MIN_TASK_BUDGET) {
    throw new Error('Anggaran sebelum biaya layanan minimal Rp5.000.');
  }

  const serviceFee = Math.ceil(
    subtotal * SERVICE_FEE_PERCENT / 100
  );

  return {
    subtotal,
    serviceFee,
    total: subtotal + serviceFee
  };
}

export function rupiah(value) {
  return 'Rp' + Number(value || 0).toLocaleString('id-ID');
}

export function calculateWorkerReward(baseReward) {
  const n = Number(baseReward);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Reward dasar tidak valid.');
  return Math.floor(n * 0.95);
}
