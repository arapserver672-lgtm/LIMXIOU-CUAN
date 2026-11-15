CREATE TABLE IF NOT EXISTS users (
 telegram_id BIGINT PRIMARY KEY, username TEXT, first_name TEXT,
 balance BIGINT NOT NULL DEFAULT 0 CHECK(balance>=0),
 referrer_id BIGINT REFERENCES users(telegram_id), referral_paid BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS user_states (
 telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id) ON DELETE CASCADE,
 state TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS tasks (
 id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Umum',
 reward BIGINT NOT NULL CHECK(reward>=5000), slots INTEGER NOT NULL CHECK(slots>0), claimed INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','completed')),
 created_by BIGINT NOT NULL REFERENCES users(telegram_id), budget_locked BIGINT NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS task_claims (
 id BIGSERIAL PRIMARY KEY, task_id BIGINT NOT NULL REFERENCES tasks(id), user_id BIGINT NOT NULL REFERENCES users(telegram_id),
 proof_text TEXT, proof_file_id TEXT, status TEXT NOT NULL DEFAULT 'claimed' CHECK(status IN ('claimed','pending','approved','rejected')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ, UNIQUE(task_id,user_id)
);
CREATE TABLE IF NOT EXISTS deposits (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(telegram_id), amount BIGINT NOT NULL CHECK(amount>0),
 fee BIGINT NOT NULL, total_paid BIGINT NOT NULL, method TEXT NOT NULL, proof_file_id TEXT, proof_text TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS withdrawals (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(telegram_id), amount BIGINT NOT NULL CHECK(amount>0),
 fee BIGINT NOT NULL DEFAULT 3000, net_amount BIGINT NOT NULL, destination TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','completed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ, completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS transactions (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(telegram_id), type TEXT NOT NULL,
 amount BIGINT NOT NULL, note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS angpaos (
 id BIGSERIAL PRIMARY KEY, total_amount BIGINT NOT NULL CHECK(total_amount>0), winners INTEGER NOT NULL CHECK(winners>0),
 remaining_amount BIGINT NOT NULL, remaining_winners INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open',
 created_by BIGINT NOT NULL REFERENCES users(telegram_id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS angpao_claims (
 id BIGSERIAL PRIMARY KEY, angpao_id BIGINT NOT NULL REFERENCES angpaos(id), user_id BIGINT NOT NULL REFERENCES users(telegram_id),
 amount BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(angpao_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_claims_status ON task_claims(status);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
CREATE INDEX IF NOT EXISTS idx_wds_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
