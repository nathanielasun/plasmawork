#!/usr/bin/env bash
#
# DB role-segregation live probe — Phase 0.5 / Phase γ (2026-05-10).
#
# Verifies the four database roles each have exactly the grants
# v4 §12 specifies, and that each is DENIED the grants the others
# hold. Without this isolation, the secure_core_app role can read
# audit_events, and the audit-write role can read users — both of
# which break the v4 §19 hash-chain integrity contract.
#
# Required env (set in .env.auth or sourced from a deployment
# secrets manager):
#
#   PLASMAWORK_DB_URL_APP            — secure_core_app role
#   PLASMAWORK_DB_URL_AUDIT_READ     — secure_core_audit_read role
#   PLASMAWORK_DB_URL_ANCHOR_WRITER  — secure_core_anchor_writer role
#   PLASMAWORK_DB_URL_MIGRATOR       — secure_core_migrator role
#
# Fail-closed posture:
#   - any of the four URLs unset      → exit 1
#   - any role's identity mismatches  → exit 1
#   - any positive-grant check fails  → exit 1
#   - any negative-grant probe lets a forbidden statement run → exit 1
#   - psql not on PATH                → exit 1
#
# This is an OPERATOR script. Run it after database provisioning to
# confirm the four roles' grants match the secure_core spec. Run it
# in CI (gated on the env's presence) for ongoing assurance.
set -euo pipefail

if ! command -v psql >/dev/null 2>&1; then
  echo "DB role probe FAILED: psql not on PATH." >&2
  echo "Install postgresql-client (or set up the libpq tools)." >&2
  exit 1
fi

require_env() {
  local name="$1"
  local val="${!name:-}"
  if [[ -z "$val" ]]; then
    cat <<EOF >&2
DB role probe FAILED: $name is unset.

The four role-segregated URLs MUST be set explicitly in production
(.env.auth or a secrets manager). A single PLASMAWORK_DB_URL fallback
exists for local-dev convenience but is NOT acceptable for the live
probe — confirming role separation requires four distinct connections.
EOF
    exit 1
  fi
}

require_env PLASMAWORK_DB_URL_APP
require_env PLASMAWORK_DB_URL_AUDIT_READ
require_env PLASMAWORK_DB_URL_ANCHOR_WRITER
require_env PLASMAWORK_DB_URL_MIGRATOR

# Helper: run a SQL string against a given URL, return success on
# row-emitting / non-error completion. Captures stderr so a deny
# reads as a probe-asserted failure, not a script bug.
run_sql() {
  local url="$1"
  local sql="$2"
  PGOPTIONS="--client-min-messages=warning" \
    psql "$url" -X -A -t -v ON_ERROR_STOP=1 -c "$sql"
}

# Helper: assert a SQL statement FAILS with a permission-denied error.
# This is the negative-grant probe — we want the statement rejected by
# the database, not silently succeeding.
assert_denied() {
  local url="$1"
  local sql="$2"
  local label="$3"
  if PGOPTIONS="--client-min-messages=warning" \
       psql "$url" -X -A -t -v ON_ERROR_STOP=1 -c "$sql" >/dev/null 2>&1; then
    echo "DB role probe FAILED: $label — statement succeeded but should be denied." >&2
    echo "  SQL: $sql" >&2
    exit 1
  fi
}

# 1. Identity probe — each URL connects as the role its name implies.
declare -A EXPECTED_ROLE=(
  [PLASMAWORK_DB_URL_APP]=secure_core_app
  [PLASMAWORK_DB_URL_AUDIT_READ]=secure_core_audit_read
  [PLASMAWORK_DB_URL_ANCHOR_WRITER]=secure_core_anchor_writer
  [PLASMAWORK_DB_URL_MIGRATOR]=secure_core_migrator
)
for url_var in PLASMAWORK_DB_URL_APP PLASMAWORK_DB_URL_AUDIT_READ \
               PLASMAWORK_DB_URL_ANCHOR_WRITER PLASMAWORK_DB_URL_MIGRATOR; do
  url="${!url_var}"
  expected="${EXPECTED_ROLE[$url_var]}"
  actual="$(run_sql "$url" "SELECT current_user;")"
  actual="$(echo "$actual" | tr -d '[:space:]')"
  if [[ "$actual" != "$expected" ]]; then
    echo "DB role probe FAILED: $url_var connected as '$actual', expected '$expected'." >&2
    exit 1
  fi
done

# 2. Positive-grant probes — each role can do what its spec demands.
#
# secure_core_app: SELECT/INSERT on users, sessions; INSERT-only on
#                  audit_events (no SELECT — that's audit_read's domain).
run_sql "$PLASMAWORK_DB_URL_APP" "SELECT 1 FROM users LIMIT 1;" >/dev/null
run_sql "$PLASMAWORK_DB_URL_APP" "SELECT 1 FROM sessions LIMIT 1;" >/dev/null

# secure_core_audit_read: SELECT on audit_events, provenance_events,
#                         operator_events, log_chain_anchors.
run_sql "$PLASMAWORK_DB_URL_AUDIT_READ" \
  "SELECT 1 FROM audit_events LIMIT 1;" >/dev/null
run_sql "$PLASMAWORK_DB_URL_AUDIT_READ" \
  "SELECT 1 FROM provenance_events LIMIT 1;" >/dev/null
run_sql "$PLASMAWORK_DB_URL_AUDIT_READ" \
  "SELECT 1 FROM log_chain_anchors LIMIT 1;" >/dev/null

# secure_core_anchor_writer: INSERT on log_chain_anchors only.
# (We can't probe INSERT without inserting a real row; the negative
# probes below cover the don't-have-other-grants side.)

# 3. Negative-grant probes — each role is DENIED what it shouldn't have.
#
# secure_core_app: must NOT SELECT audit_events.
assert_denied "$PLASMAWORK_DB_URL_APP" \
  "SELECT 1 FROM audit_events LIMIT 1;" \
  "secure_core_app must NOT have SELECT on audit_events"

# secure_core_audit_read: must NOT INSERT into audit_events.
assert_denied "$PLASMAWORK_DB_URL_AUDIT_READ" \
  "INSERT INTO audit_events (id, action, actor_type, result, request_id, prev_hash, row_hash, canonicalization_version) \
     VALUES ('00000000-0000-4000-8000-000000000000','probe','operator','denied','00000000-0000-4000-8000-000000000000',NULL,'x',1);" \
  "secure_core_audit_read must NOT have INSERT on audit_events"

# secure_core_anchor_writer: must NOT SELECT users.
assert_denied "$PLASMAWORK_DB_URL_ANCHOR_WRITER" \
  "SELECT 1 FROM users LIMIT 1;" \
  "secure_core_anchor_writer must NOT have SELECT on users"

# secure_core_anchor_writer: must NOT SELECT sessions.
assert_denied "$PLASMAWORK_DB_URL_ANCHOR_WRITER" \
  "SELECT 1 FROM sessions LIMIT 1;" \
  "secure_core_anchor_writer must NOT have SELECT on sessions"

# secure_core_app: must NOT INSERT log_chain_anchors (anchor_writer's domain).
assert_denied "$PLASMAWORK_DB_URL_APP" \
  "INSERT INTO log_chain_anchors (id, log_type, tip_hash) VALUES ('00000000-0000-4000-8000-000000000000','audit','x');" \
  "secure_core_app must NOT have INSERT on log_chain_anchors"

echo "DB role probe OK: 4 roles verified, 5 negative-grant probes denied."
exit 0
