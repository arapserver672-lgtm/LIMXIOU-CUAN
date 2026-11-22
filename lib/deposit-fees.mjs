
export function calculateDepositFee(amount) {
  const n = Number(amount);

  if (!Number.isSafeInteger(n) || n % 1000 !== 0) {
    throw new Error('Nominal deposit harus angka bulat kelipatan Rp1.000.');
  }

  if (n >= 5000 && n <= 50000) return 2000;
  if (n >= 51000 && n <= 100000) return 5000;
  if (n >= 101000 && n <= 300000) return 10000;

  throw new Error(
    'Nominal deposit tidak masuk rentang biaya yang tersedia.'
  );
}

export function calculateDepositTotal(amount) {
  const fee = calculateDepositFee(amount);

  return {
    amount: Number(amount),
    fee,
    totalPaid: Number(amount) + fee
  };
}
