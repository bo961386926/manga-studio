-- 002b_migration_imports.sql: one-time binding for encrypted legacy imports,
-- rejecting replay across deployments/users/export ids.

CREATE TABLE migration_imports (
  id UUID PRIMARY KEY,
  export_id VARCHAR(128) NOT NULL UNIQUE,
  imported_by UUID NOT NULL REFERENCES users(id),
  deployment_id VARCHAR(128) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
