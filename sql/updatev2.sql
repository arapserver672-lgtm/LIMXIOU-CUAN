
BEGIN;

-- Reward worker dan pendanaan tugas dipisahkan.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS worker_reward BIGINT,
  ADD COLUMN IF NOT EXISTS funding_per_slot BIGINT,
  ADD COLUMN IF NOT EXISTS service_fee BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_budget BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS target_url TEXT,
  ADD COLUMN IF NOT EXISTS target_text TEXT,
  ADD COLUMN IF NOT EXISTS instructions TEXT;

-- Lepas batas reward lama >= 5000.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'tasks'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%reward%'
  LOOP
    EXECUTE format('ALTER TABLE tasks DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_reward_positive CHECK (reward > 0);

-- Pertahankan arti reward lama untuk tugas yang sudah ada.
UPDATE tasks
SET worker_reward = COALESCE(worker_reward, FLOOR(reward * 0.95)::BIGINT),
    funding_per_slot = COALESCE(funding_per_slot, reward),
    total_budget = CASE
      WHEN total_budget = 0 THEN budget_locked
      ELSE total_budget
    END;

ALTER TABLE task_claims
  ADD COLUMN IF NOT EXISTS proof_file_unique_id TEXT,
  ADD COLUMN IF NOT EXISTS proof_file_type TEXT;

ALTER TABLE deposits
  ADD COLUMN IF NOT EXISTS proof_file_type TEXT;

CREATE TABLE IF NOT EXISTS proof_blacklist (
  id BIGSERIAL PRIMARY KEY,
  file_unique_id TEXT NOT NULL UNIQUE,
  first_user_id BIGINT,
  first_task_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referral_reward_paid BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS referral_rewards (
  id BIGSERIAL PRIMARY KEY,
  referrer_id BIGINT NOT NULL REFERENCES users(telegram_id),
  referred_id BIGINT NOT NULL REFERENCES users(telegram_id),
  amount BIGINT NOT NULL DEFAULT 1000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(referred_id)
);

CREATE INDEX IF NOT EXISTS idx_claims_status
  ON task_claims(status);

CREATE INDEX IF NOT EXISTS idx_deposits_status
  ON deposits(status);

CREATE INDEX IF NOT EXISTS idx_wds_status
  ON withdrawals(status);

CREATE INDEX IF NOT EXISTS idx_tasks_status
  ON tasks(status);

COMMIT;
