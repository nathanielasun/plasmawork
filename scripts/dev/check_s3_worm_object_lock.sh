#!/usr/bin/env bash
#
# S3 WORM Object Lock live probe — Phase 0.5 / Phase γ (2026-05-10).
#
# Verifies that the bucket configured for the bootstrap WORM marker
# has Object Lock enabled in COMPLIANCE mode with a non-zero
# retention. Without this, a DB restore would re-enable bootstrap —
# the in-memory FakeWormMarkerProvider is acceptable for dev only.
#
# Required env (set in .env.auth or sourced from a deployment
# secrets manager):
#
#   WORKBENCH_BOOTSTRAP_WORM_S3_BUCKET — production bucket
#   WORKBENCH_BOOTSTRAP_WORM_S3_KEY    — object key path
#   WORKBENCH_BOOTSTRAP_WORM_S3_REGION — AWS region
#
# AWS credentials must be present in the standard chain (env, profile,
# instance metadata). The probe does not configure credentials itself.
#
# Fail-closed posture:
#   - any of the three env vars unset       → exit 1
#   - aws CLI not on PATH                   → exit 1
#   - bucket lacks Object Lock              → exit 1
#   - Object Lock not in COMPLIANCE mode    → exit 1
#   - retention is zero / unset             → exit 1
#   - probe-object PUT fails                → exit 1
#   - probe-object DELETE succeeds          → exit 1 (delete should fail!)
#
# Side effect:
#   The probe PUTs a probe-{epoch}.json object with a 1-day retention.
#   Object Lock prevents delete until the retention expires; this
#   probe object stays behind by design. Operator may sweep them after
#   24h via a lifecycle rule or by waiting out the retention.
#
# This is an OPERATOR script. Run it after S3 bucket provisioning.
set -euo pipefail

if ! command -v aws >/dev/null 2>&1; then
  echo "S3 WORM probe FAILED: aws CLI not on PATH." >&2
  echo "Install awscli (https://aws.amazon.com/cli/)." >&2
  exit 1
fi

require_env() {
  local name="$1"
  local val="${!name:-}"
  if [[ -z "$val" ]]; then
    cat <<EOF >&2
S3 WORM probe FAILED: $name is unset.

The bootstrap WORM marker bucket MUST be configured explicitly in
production. Without Object Lock, a DB restore re-enables the one-shot
bootstrap gate — the manual re-bootstrap runbook in LIMITATIONS.md
exists precisely so the gate stays sealed across DB restores.
EOF
    exit 1
  fi
}

require_env WORKBENCH_BOOTSTRAP_WORM_S3_BUCKET
require_env WORKBENCH_BOOTSTRAP_WORM_S3_KEY
require_env WORKBENCH_BOOTSTRAP_WORM_S3_REGION

BUCKET="$WORKBENCH_BOOTSTRAP_WORM_S3_BUCKET"
REGION="$WORKBENCH_BOOTSTRAP_WORM_S3_REGION"

# 1. Object Lock configuration probe.
lock_config="$(
  aws s3api get-object-lock-configuration \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --output json 2>&1
)" || {
  echo "S3 WORM probe FAILED: bucket '$BUCKET' has no Object Lock configuration." >&2
  echo "$lock_config" >&2
  echo "Enable Object Lock at bucket creation (it cannot be retrofitted)." >&2
  exit 1
}

mode="$(echo "$lock_config" | python3 -c \
  "import json,sys;d=json.load(sys.stdin);print(d.get('ObjectLockConfiguration',{}).get('Rule',{}).get('DefaultRetention',{}).get('Mode',''))")"
if [[ "$mode" != "COMPLIANCE" ]]; then
  echo "S3 WORM probe FAILED: bucket '$BUCKET' Object Lock mode is '$mode', expected 'COMPLIANCE'." >&2
  echo "Governance mode allows root account to remove the lock; COMPLIANCE does not." >&2
  exit 1
fi

# Retention probe — read whichever unit (Days or Years) the bucket
# is configured with; either MUST be a positive integer.
days="$(echo "$lock_config" | python3 -c \
  "import json,sys;d=json.load(sys.stdin);print(d.get('ObjectLockConfiguration',{}).get('Rule',{}).get('DefaultRetention',{}).get('Days',0))")"
years="$(echo "$lock_config" | python3 -c \
  "import json,sys;d=json.load(sys.stdin);print(d.get('ObjectLockConfiguration',{}).get('Rule',{}).get('DefaultRetention',{}).get('Years',0))")"
if [[ "${days:-0}" == "0" && "${years:-0}" == "0" ]]; then
  echo "S3 WORM probe FAILED: bucket '$BUCKET' Object Lock retention is zero." >&2
  echo "Set Days >= 365 (or Years >= 1) so a transient operator cannot wait out the lock." >&2
  exit 1
fi

# 2. PUT a probe object with explicit retention. We use the bucket's
# default but pass an explicit RetainUntilDate to verify the path
# enforces it; some misconfigurations only honor defaults.
PROBE_KEY="probe-$(date +%s)-$$.json"
RETAIN_UNTIL="$(python3 -c \
  "from datetime import datetime,timedelta,timezone;print((datetime.now(timezone.utc)+timedelta(days=1)).isoformat().replace('+00:00','Z'))")"

probe_payload="{\"probe\":\"workbench_worm_check\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
probe_tmp="$(mktemp -t workbench_worm_probe.XXXXXX.json)"
trap 'rm -f "$probe_tmp"' EXIT
echo "$probe_payload" > "$probe_tmp"

if ! aws s3api put-object \
    --bucket "$BUCKET" \
    --key "$PROBE_KEY" \
    --body "$probe_tmp" \
    --object-lock-mode COMPLIANCE \
    --object-lock-retain-until-date "$RETAIN_UNTIL" \
    --region "$REGION" >/dev/null; then
  echo "S3 WORM probe FAILED: PUT of '$PROBE_KEY' was rejected." >&2
  exit 1
fi

# 3. DELETE attempt — MUST fail under COMPLIANCE mode + active retention.
if aws s3api delete-object \
     --bucket "$BUCKET" \
     --key "$PROBE_KEY" \
     --region "$REGION" >/dev/null 2>&1; then
  echo "S3 WORM probe FAILED: DELETE of '$PROBE_KEY' SUCCEEDED but should have been refused." >&2
  echo "Object Lock COMPLIANCE mode is misconfigured — the bucket is NOT WORM." >&2
  exit 1
fi

# 4. Confirm the object is still present after the failed delete.
if ! aws s3api head-object \
     --bucket "$BUCKET" \
     --key "$PROBE_KEY" \
     --region "$REGION" >/dev/null 2>&1; then
  echo "S3 WORM probe FAILED: probe object disappeared after DELETE attempt." >&2
  exit 1
fi

echo "S3 WORM probe OK: bucket '$BUCKET' enforces COMPLIANCE Object Lock."
echo "  probe object: s3://$BUCKET/$PROBE_KEY (retention until $RETAIN_UNTIL)"
echo "  the probe object remains by design — Object Lock prevents cleanup."
exit 0
