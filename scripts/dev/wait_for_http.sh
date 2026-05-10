#!/usr/bin/env bash
#
# scripts/dev/wait_for_http.sh — block until an HTTP endpoint is reachable.
#
# Fail-closed wait-for-ready helper used by cross-process smoke tests
# (Layer 4 / Layer 5). Polls the given URL with curl --retry-connrefused
# until it returns a 2xx response, or the timeout expires.
#
# Usage:
#   scripts/dev/wait_for_http.sh <url> [timeout_seconds]
#
# Defaults: timeout_seconds = 30.
#
# Exit codes:
#   0  endpoint reached
#   1  timed out (the URL never returned 2xx within timeout)
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
  if curl -fsS --max-time 2 -o /dev/null "$URL" 2>/dev/null; then
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
