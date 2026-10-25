-- 001a_entitlements.sql: VIP entitlements and structured audit log.
-- Design source: user-identity-access-design.md §5.5 (entitlements) and §5.7 (audit).
-- Added as a follow-up to 001_identity.sql for stage-1 Task 5; lexical order
-- keeps it between 001_identity.sql and 002_user_ownership.sql.

CREATE TABLE user_entitlements (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entitlement_key VARCHAR(64) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  granted_by UUID REFERENCES users(id),
  reason VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, entitlement_key)
);

CREATE TABLE audit_events (
  id UUID PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id),
  target_user_id UUID REFERENCES users(id),
  event_type VARCHAR(96) NOT NULL,
  result VARCHAR(16) NOT NULL,
  request_id VARCHAR(64),
  ip_hash CHAR(64),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_events_created_idx ON audit_events(created_at DESC);
