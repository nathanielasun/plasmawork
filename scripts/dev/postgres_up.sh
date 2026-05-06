#!/usr/bin/env bash
#
# Phase 0.5 secure_core Postgres bootstrap entrypoint.
#
# The full containerized bootstrap lands with the Layer-2/3 runtime
# services. For Layer 1, the DB integration tests accept an explicit
# PLASMAWORK_TEST_DB_URL and skip when it is unset.
set -euo pipefail

cat <<'EOF'
scripts/dev/postgres_up.sh: secure_core Postgres bootstrap is not implemented yet.

For current Layer-1 DB checks, provide a PostgreSQL superuser URL via:
  PLASMAWORK_TEST_DB_URL=postgres://postgres:postgres@localhost:5432/postgres

Then run:
  scripts/test/secure_core.sh
EOF
