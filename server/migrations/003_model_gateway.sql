-- 003_model_gateway.sql: self-hosted model gateway data layer.
-- Design source: self-hosted-cloud-models-design.md §5.1–5.5.
-- Order: media_assets and model_invocations before model_jobs (FK order).

-- ============ 5.1 Providers ============

CREATE TABLE model_providers (
  id UUID PRIMARY KEY,
  owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  scope VARCHAR(16) NOT NULL CHECK (scope IN ('private', 'shared')),
  name VARCHAR(120) NOT NULL,
  base_url TEXT NOT NULL,
  auth_type VARCHAR(32) NOT NULL CHECK (auth_type IN ('none', 'bearer', 'api-key-header')),
  auth_header_name VARCHAR(128),
  active_credential_version_id UUID,
  timeout_ms INTEGER,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (scope = 'private' AND owner_user_id IS NOT NULL)
    OR (scope = 'shared' AND owner_user_id IS NULL)
  )
);

-- ============ 5.2 Models ============

CREATE TABLE models (
  id UUID PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES model_providers(id) ON DELETE RESTRICT,
  name VARCHAR(120) NOT NULL,
  api_model VARCHAR(255) NOT NULL,
  capability VARCHAR(16) NOT NULL CHECK (capability IN ('chat', 'image', 'video')),
  adapter_kind VARCHAR(64) NOT NULL,
  protocol_preset VARCHAR(64),
  endpoint_path TEXT NOT NULL,
  base_url_override TEXT,
  auth_override_type VARCHAR(32),
  auth_override_header_name VARCHAR(128),
  auth_override_credential_version_id UUID,
  timeout_ms INTEGER,
  capabilities JSONB NOT NULL DEFAULT '{}',
  protocol_config JSONB NOT NULL DEFAULT '{}',
  access_level VARCHAR(16) NOT NULL CHECK (access_level IN ('verified', 'vip', 'admin')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    auth_override_type IS NULL
    OR auth_override_type IN ('none', 'bearer', 'api-key-header')
  )
);

-- ============ 5.2.1 Credential versions ============

CREATE TABLE model_credential_versions (
  id UUID PRIMARY KEY,
  provider_id UUID REFERENCES model_providers(id) ON DELETE CASCADE,
  model_id UUID REFERENCES models(id) ON DELETE CASCADE,
  ciphertext BYTEA NOT NULL,
  iv BYTEA NOT NULL,
  tag BYTEA NOT NULL,
  encryption_key_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ,
  CHECK ((provider_id IS NOT NULL) <> (model_id IS NOT NULL))
);

ALTER TABLE model_providers
  ADD CONSTRAINT model_providers_active_credential_fk
  FOREIGN KEY (active_credential_version_id)
  REFERENCES model_credential_versions(id);
ALTER TABLE models
  ADD CONSTRAINT models_override_credential_fk
  FOREIGN KEY (auth_override_credential_version_id)
  REFERENCES model_credential_versions(id);

-- ============ 5.4 Media assets (before invocations/jobs) ============

CREATE TABLE media_assets (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  content_type VARCHAR(128) NOT NULL,
  size_bytes BIGINT NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('uploading', 'ready', 'failed', 'deleted')),
  ref_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- ============ 5.5 Invocations ============

CREATE TABLE model_invocations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id UUID REFERENCES models(id) ON DELETE SET NULL,
  model_id_snapshot UUID NOT NULL,
  operation VARCHAR(32) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  request_payload_ciphertext BYTEA NOT NULL,
  request_payload_iv BYTEA NOT NULL,
  request_payload_tag BYTEA NOT NULL,
  request_payload_key_id VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL CHECK (status IN (
    'created', 'submitting', 'submission_uncertain', 'succeeded', 'failed', 'cancelled'
  )),
  lease_owner VARCHAR(128),
  lease_expires_at TIMESTAMPTZ,
  upstream_request_id VARCHAR(255),
  result_media_asset_id UUID REFERENCES media_assets(id),
  result_text_ciphertext BYTEA,
  result_text_iv BYTEA,
  result_text_tag BYTEA,
  result_text_key_id VARCHAR(64),
  result_json_ciphertext BYTEA,
  result_json_iv BYTEA,
  result_json_tag BYTEA,
  result_json_key_id VARCHAR(64),
  error_code VARCHAR(64),
  error_message VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, operation, idempotency_key)
);

-- ============ 5.3 Jobs (after invocations) ============

CREATE TABLE model_jobs (
  id UUID PRIMARY KEY,
  invocation_id UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_snapshot JSONB NOT NULL,
  credential_version_id UUID REFERENCES model_credential_versions(id),
  upstream_task_id TEXT,
  upstream_resource_id TEXT,
  status VARCHAR(32) NOT NULL CHECK (status IN (
    'created', 'submitting', 'submission_uncertain', 'queued', 'polling', 'succeeded',
    'failed', 'cancel_requested', 'cancelled', 'expired'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_poll_at TIMESTAMPTZ,
  lease_owner VARCHAR(128),
  lease_expires_at TIMESTAMPTZ,
  error_code VARCHAR(64),
  error_message VARCHAR(500),
  result_origin TEXT,
  result_url_ciphertext BYTEA,
  result_url_iv BYTEA,
  result_url_tag BYTEA,
  result_url_key_id VARCHAR(64),
  result_object_key TEXT,
  result_content_type VARCHAR(128),
  result_size_bytes BIGINT,
  cancel_requested_at TIMESTAMPTZ,
  upstream_cancel_confirmed BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE model_invocations
  ADD CONSTRAINT model_invocations_id_user_unique UNIQUE (id, user_id);
ALTER TABLE model_jobs
  ADD CONSTRAINT model_jobs_invocation_owner_fk
  FOREIGN KEY (invocation_id, user_id)
  REFERENCES model_invocations(id, user_id)
  ON DELETE RESTRICT;

-- ============ Row-level security (fail closed) ============
-- The app sets app.user_id / app.is_admin per transaction (GUC). Missing or
-- malformed values yield NULL/empty -> private rows invisible -> fail closed.

ALTER TABLE model_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE models ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_credential_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY providers_visible ON model_providers
  FOR SELECT
  USING (
    scope = 'shared'
    OR (scope = 'private' AND owner_user_id::text = current_setting('app.user_id', true))
  );

CREATE POLICY providers_owner_write ON model_providers
  FOR INSERT WITH CHECK (
    (scope = 'private' AND owner_user_id::text = current_setting('app.user_id', true))
    OR (scope = 'shared' AND current_setting('app.is_admin', true) = 'true')
  );
CREATE POLICY providers_owner_update ON model_providers
  FOR UPDATE
  USING (
    (scope = 'private' AND owner_user_id::text = current_setting('app.user_id', true))
    OR (scope = 'shared' AND current_setting('app.is_admin', true) = 'true')
  );

CREATE POLICY media_owner ON media_assets
  FOR ALL
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));

CREATE POLICY invocation_owner ON model_invocations
  FOR ALL
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));

CREATE POLICY job_owner ON model_jobs
  FOR ALL
  USING (user_id::text = current_setting('app.user_id', true))
  WITH CHECK (user_id::text = current_setting('app.user_id', true));

-- ============ Constraint trigger: model writes must satisfy provider rules ============
-- Lock the provider row and validate owner/scope/enabled/deleted before any
-- model insert/update. Shared-provider models require admin.

CREATE OR REPLACE FUNCTION enforce_model_provider_guard() RETURNS trigger AS $$
DECLARE
  p model_providers%ROWTYPE;
BEGIN
  SELECT * INTO p FROM model_providers WHERE id = NEW.provider_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'provider not found';
  END IF;
  IF p.deleted_at IS NOT NULL OR NOT p.enabled THEN
    RAISE EXCEPTION 'provider is disabled';
  END IF;
  IF p.scope = 'private' AND p.owner_user_id::text <> current_setting('app.user_id', true) THEN
    RAISE EXCEPTION 'provider ownership mismatch';
  END IF;
  IF p.scope = 'shared' AND current_setting('app.is_admin', true) <> 'true' THEN
    RAISE EXCEPTION 'shared provider requires admin';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER models_provider_guard
  BEFORE INSERT OR UPDATE ON models
  FOR EACH ROW EXECUTE FUNCTION enforce_model_provider_guard();
