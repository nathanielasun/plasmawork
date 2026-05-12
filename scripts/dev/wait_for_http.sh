#!/usr/bin/env bash
#
# scripts/dev/wait_for_http.sh — block until an HTTP endpoint is reachable.
#
# Wait-for-ready helper used by cross-process smoke tests (Layer 4 /
# Layer 5) and run_dev.sh. Polls the given URL until ANY HTTP response
# comes back, or the timeout expires. "Any response" — including 401,
# 403, 404 — means the server is alive and answering, which is all the
# caller cares about. The caller's own assertions decide whether the
# specific response status is correct.
#
# Usage:
#   scripts/dev/wait_for_http.sh <url> [timeout_seconds]
#
# Defaults: timeout_seconds = 30.
#
# Exit codes:
#   0  endpoint responded with ANY HTTP status (server is alive)
#   1  timed out (no response within timeout)
#   2  bad arguments

set -uo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: wait_for_http.sh <url> [timeout_seconds]" >&2
  exit 2
fi

URL="$1"
TIMEOUT="${2:-30}"

if ! command -v curl >/dev/null 2>&1; then
  echo "wait_for_http.sh: curl not on PATH" >&2
  exit 2
fi

START=$(date +%s)
while true; do
  # -s silent, -o /dev/null discard body, -w prints status code
  # (000 means no response, anything else means the server answered).
  # No -f, so any HTTP status counts as "ready".
  code=$(curl -sS --max-time 2 -o /dev/null -w "%{http_code}" "$URL" 2>/dev/null || true)
  if [[ "$code" != "000" && -n "$code" ]]; then
    exit 0
  fi
  NOW=$(date +%s)
  ELAPSED=$((NOW - START))
  if (( ELAPSED >= TIMEOUT )); then
    echo "wait_for_http.sh: timed out after ${TIMEOUT}s waiting for ${URL}" >&2
    exit 1
  fi
  sleep 0.5
done
