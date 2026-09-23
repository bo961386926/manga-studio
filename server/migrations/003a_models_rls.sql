-- 003a_models_rls.sql: RLS policies for models and credential versions,
-- deriving visibility from the provider (private -> owner, shared -> all).

CREATE POLICY models_visible ON models
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM model_providers p
      WHERE p.id = models.provider_id
        AND p.deleted_at IS NULL
        AND (
          p.scope = 'shared'
          OR (p.scope = 'private' AND p.owner_user_id::text = current_setting('app.user_id', true))
        )
    )
  );

CREATE POLICY models_write ON models
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM model_providers p
      WHERE p.id = models.provider_id
        AND p.deleted_at IS NULL
        AND (
          p.scope = 'shared' AND current_setting('app.is_admin', true) = 'true'
          OR (p.scope = 'private' AND p.owner_user_id::text = current_setting('app.user_id', true))
        )
    )
  );

CREATE POLICY credential_versions_visible ON model_credential_versions
  FOR SELECT
  USING (
    (provider_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM model_providers p WHERE p.id = model_credential_versions.provider_id
        AND (p.scope = 'shared' OR (p.scope = 'private' AND p.owner_user_id::text = current_setting('app.user_id', true)))
    ))
    OR (model_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM models m JOIN model_providers p ON p.id = m.provider_id
      WHERE m.id = model_credential_versions.model_id
        AND (p.scope = 'shared' OR (p.scope = 'private' AND p.owner_user_id::text = current_setting('app.user_id', true)))
    ))
  );
