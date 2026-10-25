-- 002_user_ownership.sql: scope projects/assets by user_id with composite keys.
-- Design source: user-identity-access-design.md §5.6 and §9.1.
-- Runs inside the migration runner's transaction (rollback-safe).
-- Requires an active admin to own legacy rows; aborts otherwise.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

-- Backfill: existing rows belong to the bootstrap (first active) admin.
WITH admin AS (
  SELECT id FROM users
  WHERE role = 'admin' AND status = 'active'
  ORDER BY created_at
  LIMIT 1
)
UPDATE projects SET user_id = (SELECT id FROM admin) WHERE user_id IS NULL;

WITH admin AS (
  SELECT id FROM users
  WHERE role = 'admin' AND status = 'active'
  ORDER BY created_at
  LIMIT 1
)
UPDATE assets SET user_id = (SELECT id FROM admin) WHERE user_id IS NULL;

-- Fail the migration when ownership is incomplete (composite PK forbids NULL).
DO $$
DECLARE
  p_count integer;
  a_count integer;
BEGIN
  SELECT COUNT(*) INTO p_count FROM projects WHERE user_id IS NULL;
  SELECT COUNT(*) INTO a_count FROM assets WHERE user_id IS NULL;
  IF p_count > 0 OR a_count > 0 THEN
    RAISE EXCEPTION 'ownership backfill incomplete: projects=% assets=% (bootstrap an admin first)', p_count, a_count;
  END IF;
END $$;

-- Replace single-column primary keys with (user_id, id) composite keys.
ALTER TABLE projects DROP CONSTRAINT projects_pkey;
ALTER TABLE assets DROP CONSTRAINT assets_pkey;
ALTER TABLE projects ADD PRIMARY KEY (user_id, id);
ALTER TABLE assets ADD PRIMARY KEY (user_id, id);

-- Owner-scoped listing indexes.
CREATE INDEX IF NOT EXISTS projects_user_modified_idx
  ON projects(user_id, last_modified DESC);
CREATE INDEX IF NOT EXISTS assets_user_updated_idx
  ON assets(user_id, updated_at DESC);

-- Migration report for auditability.
INSERT INTO config (key, value)
VALUES ('ownership_migration_report', jsonb_build_object(
  'version', 2,
  'applied_at', NOW(),
  'projects_owned_by', (SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY created_at LIMIT 1)
))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
