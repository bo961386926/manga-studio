-- 001_identity.sql: identity, sessions, one-time action tokens and email outbox.
-- Design source: docs/superpowers/specs/2026-08-20-user-identity-access-design.md §5.1–5.4.
-- Note: the plan document calls the token table `one_time_tokens`; the spec's
-- authoritative DDL uses `user_action_tokens`, which is what we create here.

CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(320) NOT NULL,
  email_normalized VARCHAR(320) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('admin', 'user')),
  status VARCHAR(32) NOT NULL CHECK (
    status IN ('pending_verification', 'active', 'disabled')
  ),
  email_verified_at TIMESTAMPTZ,
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  session_version INTEGER NOT NULL,
  csrf_token_hash CHAR(64),
  csrf_expires_at TIMESTAMPTZ,
  csrf_version INTEGER NOT NULL DEFAULT 1,
  reauthenticated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash CHAR(64),
  user_agent_summary VARCHAR(255),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX sessions_user_active_idx ON sessions(user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE user_action_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose VARCHAR(32) NOT NULL CHECK (
    purpose IN ('verify_email', 'reset_password', 'bootstrap_admin')
  ),
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE email_outbox (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose VARCHAR(32) NOT NULL CHECK (
    purpose IN ('verify_email', 'reset_password', 'bootstrap_admin')
  ),
  action_token_id UUID REFERENCES user_action_tokens(id) ON DELETE SET NULL,
  kind VARCHAR(32) NOT NULL,
  recipient_email VARCHAR(320) NOT NULL,
  template_data JSONB NOT NULL,
  action_token_ciphertext BYTEA,
  action_token_iv BYTEA,
  action_token_tag BYTEA,
  action_token_key_id VARCHAR(64),
  status VARCHAR(16) NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error_code VARCHAR(64),
  lease_owner VARCHAR(128),
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  CHECK (status IN ('pending', 'sending', 'sent', 'dead'))
);
