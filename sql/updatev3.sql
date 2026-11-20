BEGIN;

-- Settings disimpan di database, termasuk file_id QRIS Telegram.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deposit: kode unik dan pencegahan pemakaian ulang foto bukti.
ALTER TABLE deposits
  ADD COLUMN IF NOT EXISTS proof_file_unique_id TEXT,
  ADD COLUMN IF NOT EXISTS unique_code INTEGER,
  ADD COLUMN IF NOT EXISTS unique_total BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_proof_unique
  ON deposits(proof_file_unique_id)
  WHERE proof_file_unique_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_pending_unique_code
  ON deposits(unique_code)
  WHERE status='pending' AND unique_code IS NOT NULL;

-- WD: metode dan data penerima terstruktur, serta referensi notifikasi channel.
ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS method TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS recipient_name TEXT,
  ADD COLUMN IF NOT EXISTS channel_message_id BIGINT;

-- Angpao: simpan ID pesan channel agar tombol bisa dinonaktifkan saat habis.
ALTER TABLE angpaos
  ADD COLUMN IF NOT EXISTS channel_message_id BIGINT;

-- Blacklist bukti: catat user yang terdeteksi mengirim ulang bukti.
CREATE TABLE IF NOT EXISTS proof_blacklist (
  id BIGSERIAL PRIMARY KEY,
  file_unique_id TEXT NOT NULL UNIQUE,
  first_user_id BIGINT,
  first_task_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE proof_blacklist
  ADD COLUMN IF NOT EXISTS blocked_user_id BIGINT;

-- Status blokir akun agar akses otomatis dihentikan sampai /unban.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_is_banned ON users(is_banned);
CREATE INDEX IF NOT EXISTS idx_proof_blacklist_blocked_user
  ON proof_blacklist(blocked_user_id);

COMMIT;
