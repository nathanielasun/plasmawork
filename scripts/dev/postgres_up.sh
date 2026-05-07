#!/usr/bin/env bash
#
# secure_core Postgres bootstrap entrypoint.
#
# This repository does not silently provision a local database for secure-core
# role probes. Operators must provide an explicit deployment/CI database URL to
# the live probe script. This command fails closed so automation cannot treat an
# informational stub as a successful database startup.
set -euo pipefail

cat <<'EOF'
scripts/dev/postgres_up.sh: no local Postgres bootstrap is configured.

Provide an ephemeral PostgreSQL superuser URL via:
  PLASMAWORK_TEST_DB_URL=postgres://postgres:postgres@localhost:5432/postgres

Then run:
  scripts/test/security_live_db.sh

The default security gate remains:
  scripts/test/security.sh
EOF

exit 1
