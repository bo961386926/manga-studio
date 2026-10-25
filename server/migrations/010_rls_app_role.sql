-- 010_rls_app_role.sql: Create non-superuser role for production app connections
-- This migration must run as superuser (postgres) during initial setup or manual migration.
-- After running, update .env DB_USER=manga_studio_app and restart API.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manga_studio_app') THEN
    CREATE ROLE manga_studio_app LOGIN PASSWORD 'CHANGE_ME_IN_ENV';
  END IF;
END $$;

-- Grant minimal required privileges
GRANT CONNECT ON DATABASE manga_studio TO manga_studio_app;
GRANT USAGE ON SCHEMA public TO manga_studio_app;

-- Read/write access to application tables (RLS policies enforce row-level access)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO manga_studio_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO manga_studio_app;

-- Ensure future tables also get grants (run as superuser after migrations)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO manga_studio_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO manga_studio_app;

-- Allow the role to set the GUCs used by RLS policies
ALTER ROLE manga_studio_app SET app.user_id = '';
ALTER ROLE manga_studio_app SET app.is_admin = 'false';

-- Prevent accidental superuser escalation
REVOKE ALL ON DATABASE manga_studio FROM PUBLIC;