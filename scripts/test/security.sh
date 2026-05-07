#!/usr/bin/env bash
#
# scripts/test/security.sh
#
# Phase 0.5 — secure multi-user regression suite (§29 of v4).
#
# Runs the spec-level §29 invariants under `packages/secure_core/test/
# security/`. These prove the structural contracts the runtime
# enforces (no --privileged, no forbidden env keys, mount allowlist,
# audit-actor consistency, etc.). They run on any dev host.
#
# Live runtime probes (gVisor sandbox, DB role separation against a
# real PostgreSQL, S3 Object Lock anchor invariants) run through
# dedicated deployment-side scripts/jobs:
#   - PLASMAWORK_RUNSC_PROBES=1   sandbox live probes
#   - PLASMAWORK_TEST_DB_URL=...  DB role-privilege probes
#   - PLASMAWORK_ANCHOR_LIVE_PROBES=1 + PLASMAWORK_ANCHOR_S3_* anchor probes
# Layer 5 wires those vars in the dedicated CI lane.
#
# This script is a hard gate: a failure fails CI. The §30 item #23
# close-out criterion requires this — until the live-runtime CI lane
# is up, we still gate on the spec-level tests, which catch any
# argv-emission / forbidden-env / actor-shape regression.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

FORBIDDEN_PROD_SECRET_ENV=(
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_SESSION_TOKEN
  PLASMAWORK_DB_URL
  PLASMAWORK_DB_URL_APP
  PLASMAWORK_DB_URL_AUDIT_READ
  PLASMAWORK_DB_URL_ANCHOR_WRITER
  PLASMAWORK_DB_URL_MIGRATOR
  PLASMAWORK_SECRETS_AWS_PREFIX
)

for name in "${FORBIDDEN_PROD_SECRET_ENV[@]}"; do
  if [[ -n "${!name:-}" ]]; then
    echo "[security] refusing to run with production-secret-shaped env var set: ${name}" >&2
    echo "[security] use PLASMAWORK_TEST_DB_URL and local/mock providers for this lane." >&2
    exit 1
  fi
done

cd "$REPO_ROOT/packages/secure_core"

# Vitest scoped to the security suite. The full secure_core suite
# remains gated by scripts/test/secure_core.sh; this script targets
# only test/security/ so a failure there is unambiguous.
echo "[security] running v4 §29 spec-level invariants..."
npx vitest run test/security

if [[ -n "${PLASMAWORK_RUNSC_PROBES:-}" ]]; then
  echo "[security] runsc live probes enabled (PLASMAWORK_RUNSC_PROBES=$PLASMAWORK_RUNSC_PROBES)"
else
  echo "[security] runsc live probes SKIPPED — set PLASMAWORK_RUNSC_PROBES=1 in CI to enable"
fi
if [[ -n "${PLASMAWORK_TEST_DB_URL:-}" ]]; then
  echo "[security] DB role probes will fire against PLASMAWORK_TEST_DB_URL"
else
  echo "[security] DB role probes SKIPPED — set PLASMAWORK_TEST_DB_URL to enable"
fi
if [[ -n "${PLASMAWORK_ANCHOR_LIVE_PROBES:-}" ]]; then
  echo "[security] WORM anchor live probes are deployment-scoped; run scripts/test/security_live_worm.sh"
else
  echo "[security] WORM anchor live probes SKIPPED — set PLASMAWORK_ANCHOR_LIVE_PROBES=1 in a protected deployment lane"
fi
