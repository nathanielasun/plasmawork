#!/usr/bin/env bash
#
# scripts/test/security.sh
#
# Phase 0.5 — secure multi-user regression suite (`secure_multi_user_scaffolding_plan_v4.md` §29).
#
# Status: STUB. The §29 suite of 84 tests lands in Layer 5 of the
# Phase 0.5 implementation plan. Until then, this script:
#   - exits 0 (does not break CI),
#   - prints a clear notice that the security suite is not yet shipped,
#   - prints the path to the implementation plan for anyone curious.
#
# When Layer 5 begins, replace the body of this script with:
#   1. invocation of the secure_core test runner under
#      packages/secure_core/test/security/,
#   2. a static-analysis sweep that fails on forbidden logging
#      patterns (per v4 §19.4),
#   3. integration tests that spin up an ephemeral DB + the runtime
#      role separation per v4 §12.1.1.
#
# The Phase 0.5 close-out gate (§30 item #23) requires this script to
# fail the PR on any §29 regression. Until Layer 5 ships, "no §29
# tests yet" is a structural truth — not a bypass.
set -euo pipefail

cat <<'EOF'
[security] §29 security regression suite is not yet shipped.

  Phase 0.5 (secure multi-user scaffolding) is in Layer-0 drafting; the
  §29 suite of 84 tests lands in Layer 5 per the implementation plan.

  Until Layer 1 begins, this script is a stub that exits 0. The
  workbench is single-user and local-only; nothing is enforced or
  protected by these tests yet.

  Plan:    program_development/phase_05_security_implementation_plan.md
  Design:  secure_multi_user_scaffolding_plan_v4.md
  Review:  security_review_v4_and_decomposability.md
EOF

# When Layer 5 ships, the next line becomes:
#   exec node packages/secure_core/test/security/run.js
exit 0
