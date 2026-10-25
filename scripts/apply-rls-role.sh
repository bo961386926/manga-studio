#!/usr/bin/env bash
# Apply RLS non-superuser role migration.
# Usage: ./scripts/apply-rls-role.sh [--check|--execute] [--db-url postgres://...]
#   --check    : dry-run, only verify current state (default)
#   --execute  : actually create role and run migration
#   --db-url   : optional DATABASE_URL (default: from .env or localhost)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MIGRATION_SQL="$PROJECT_ROOT/server/migrations/010_rls_app_role.sql"

MODE="check"
DB_URL=""

for arg in "$@"; do
  case "$arg" in
    --check) MODE="check" ;;
    --execute) MODE="execute" ;;
    --db-url=*) DB_URL="${arg#*=}" ;;
    --db-url) shift; DB_URL="${1:-}" ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

# Load .env if exists
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
fi

# Resolve DATABASE_URL
if [[ -z "$DB_URL" ]]; then
  if [[ -n "${DATABASE_URL:-}" ]]; then
    DB_URL="$DATABASE_URL"
  else
    DB_HOST="${DB_HOST:-localhost}"
    DB_PORT="${DB_PORT:-5432}"
    DB_NAME="${DB_NAME:-manga_studio}"
    DB_USER="${DB_USER:-postgres}"
    DB_PASSWORD="${DB_PASSWORD:-postgres}"
    DB_URL="postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
  fi
fi

echo "[apply-rls-role] Mode: $MODE"
echo "[apply-rls-role] Target DB: ${DB_URL%:*}@***"

# Check if migration file exists
if [[ ! -f "$MIGRATION_SQL" ]]; then
  echo "ERROR: Migration not found: $MIGRATION_SQL" >&2
  exit 1
fi

# Function to run SQL as superuser (postgres)
run_sql() {
  local sql="$1"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -c "$sql"
}

# Function to run migration file
run_migration() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION_SQL"
}

# Verify current state
check_role() {
  echo "=== Checking manga_studio_app role ==="
  run_sql "SELECT rolname, rolsuper, rolcreaterole, rolcanlogin FROM pg_roles WHERE rolname = 'manga_studio_app';"
}

check_grants() {
  echo "=== Checking table grants ==="
  run_sql "
    SELECT grantee, table_name, privilege_type
    FROM information_schema.table_privileges
    WHERE grantee = 'manga_studio_app'
      AND table_schema = 'public'
    ORDER BY table_name, privilege_type;
  "
}

check_gucs() {
  echo "=== Checking GUC defaults ==="
  run_sql "
    SELECT rolname, rolconfig
    FROM pg_roles
    WHERE rolname = 'manga_studio_app';
  "
}

check_rls() {
  echo "=== Checking RLS policies (sample) ==="
  run_sql "
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('models', 'model_invocations', 'model_jobs', 'media_assets', 'model_providers')
    ORDER BY tablename, policyname;
  "
}

if [[ "$MODE" == "check" ]]; then
  echo "[apply-rls-role] DRY-RUN: checking current state..."
  check_role
  check_grants
  check_gucs
  check_rls
  echo ""
  echo "To execute migration, run:"
  echo "  $0 --execute"
  exit 0
fi

# Execute mode
echo "[apply-rls-role] EXECUTING migration..."

# 1. Run migration SQL (requires superuser)
echo "--- Running 010_rls_app_role.sql ---"
run_migration

# 2. Verify
echo "--- Verifying role ---"
check_role

echo "--- Verifying grants ---"
check_grants

echo "--- Verifying GUCs ---"
check_gucs

echo "--- Verifying RLS policies ---"
check_rls

# 3. Output required .env changes
echo ""
echo "=== Migration complete. Update your .env: ==="
echo "DB_USER=manga_studio_app"
echo "DB_PASSWORD=<the password you set in 010_rls_app_role.sql>"
echo ""
echo "Then restart API container:"
echo "  docker compose --env-file .env up -d --no-deps api"
echo ""
echo "Verify connection:"
echo "  psql \"postgres://manga_studio_app:<password>@host:5432/manga_studio\" -c 'SELECT current_user;'"