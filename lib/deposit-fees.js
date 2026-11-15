// Biaya admin deposit bertingkat + bonus deposit.

export const MIN_DEPOSIT = 5000;
export const MAX_DEPOSIT = 300000;

export const FEE_TIERS = [
  { min: 5000, max: 50000, fee: 3000 },
  { min: 51000, max: 100000, fee: 5000 },
  { min: 101000, max: 300000, fee: 10000 }
];

export function calculateDepositFee(n) {
  if (!Number.isSafeInteger(n)) {
    throw new Error('Nominal tidak valid. Kirim angka saja, contoh: 50000.');
  }
  if (n < MIN_DEPOSIT || n > MAX_DEPOSIT) {
    throw new Error('Nominal deposit minimal Rp5.000 dan maksimal Rp300.000.');
  }
  if (n % 1000 !== 0) {
    throw new Error('Nominal harus kelipatan Rp1.000, contoh: 50000.');
  }
  const tier = FEE_TIERS.find(t => n >= t.min && n <= t.max);
  return tier.fee;
}

// Bonus per deposit: setiap deposit >= minDeposit dapat bonus persen.
export const BONUS_PERCENT = { minDeposit: 50000, percent: 10 };

// Bonus sekali jalan saat total deposit approved mencapai ambang.
export const BONUS_MILESTONES = [
  { key: 'm20k', totalDeposit: 20000, amount: 4000 }
];

export function percentBonus(amount) {
  return amount >= BONUS_PERCENT.minDeposit
    ? Math.floor((amount * BONUS_PERCENT.percent) / 100)
    : 0;
}
