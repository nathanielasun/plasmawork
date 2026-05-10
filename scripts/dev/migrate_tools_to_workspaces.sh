#!/usr/bin/env bash
#
# Migrate flat-layout imported tools to the per-workspace quarantine.
# Phase α (2026-05-10).
#
# Before this script: ``local_cache/imported_tools/{tool_name}/...``
# After this script:  ``local_cache/imported_tools/_pending_migration/{tool_name}/...``
#
# Each move is logged into
# ``local_cache/imported_tools/_pending_migration/_migration_log.json``
# with a timestamp + the original path. ``--rollback`` reads that log
# and reverses every move that hasn't already been re-promoted.
#
# Why quarantine and not "auto-promote to shared-internal-tools":
# the user picked the safer migration in the plan answers — every
# existing tool is reviewed by the operator before re-promotion. A
# flat install with sensitive tooling would otherwise expose those
# tools to every user as soon as the workspace-scoped registry
# rolls out.
#
# After this script runs, the operator re-promotes each quarantined
# tool via the Tools UI's "Promote" action (Phase α.4 — pending) OR
# manually moves the directory into the target workspace's slug
# folder (e.g. ``mv _pending_migration/foo shared-internal-tools/foo``).
#
# Idempotent: re-runs are no-ops; tools already under
# ``_pending_migration/`` or under a workspace slug subdirectory are
# left alone.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMPORTED_ROOT="$REPO_ROOT/local_cache/imported_tools"
QUARANTINE_DIR="$IMPORTED_ROOT/_pending_migration"
LOG_FILE="$QUARANTINE_DIR/_migration_log.json"

# Reserved subdirectory names ToolRegistry already skips. Mirror the
# Python-side RESERVED_QUARANTINE_DIRS constant.
RESERVED_NAMES=("_pending_migration")

usage() {
  cat <<EOF
Usage: $0 [--rollback] [--dry-run]

  Default: detect flat-layout tools under $IMPORTED_ROOT and move them
  to $QUARANTINE_DIR/. Each move is logged.

  --rollback: read the log and reverse every still-quarantined move.
  --dry-run:  print what would happen, change nothing.
EOF
}

ROLLBACK=0
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rollback) ROLLBACK=1 ;;
    --dry-run)  DRY_RUN=1 ;;
    -h|--help)  usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ ! -d "$IMPORTED_ROOT" ]]; then
  echo "No imported_tools/ directory at $IMPORTED_ROOT — nothing to migrate."
  exit 0
fi

is_reserved_name() {
  local name="$1"
  for reserved in "${RESERVED_NAMES[@]}"; do
    if [[ "$name" == "$reserved" ]]; then
      return 0
    fi
  done
  return 1
}

# A directory is "flat-layout legacy" iff it sits directly under
# imported_tools/, contains a tool.yaml, AND its name is neither a
# reserved quarantine name nor a known workspace slug pattern. We
# err on the side of "looks like a tool" — any subdir with a
# tool.yaml that isn't the quarantine dir is treated as legacy.
is_legacy_tool_dir() {
  local dir="$1"
  [[ -f "$dir/tool.yaml" ]] || return 1
  local name
  name="$(basename "$dir")"
  is_reserved_name "$name" && return 1
  return 0
}

# Append a JSON record to the migration log. Format is line-delimited
# JSON (one object per line) so a future log-rotation / parse stays
# simple. The log lives INSIDE _pending_migration/ so it survives a
# subsequent migration round.
log_move() {
  local original="$1"
  local target="$2"
  mkdir -p "$QUARANTINE_DIR"
  printf '{"timestamp":"%s","original":"%s","target":"%s"}\n' \
    "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    "$original" \
    "$target" \
    >> "$LOG_FILE"
}

if [[ $ROLLBACK -eq 1 ]]; then
  if [[ ! -f "$LOG_FILE" ]]; then
    echo "No migration log at $LOG_FILE — nothing to roll back."
    exit 0
  fi
  reversed=0
  # Reverse each logged move, newest first, skipping moves whose
  # target has already been re-promoted (e.g. moved into a workspace
  # slug subdirectory by the operator).
  while IFS= read -r line; do
    original="$(printf '%s' "$line" | python3 -c \
      "import json,sys;print(json.loads(sys.stdin.read()).get('original',''))")"
    target="$(printf '%s' "$line" | python3 -c \
      "import json,sys;print(json.loads(sys.stdin.read()).get('target',''))")"
    if [[ -z "$original" || -z "$target" ]]; then continue; fi
    if [[ ! -d "$target" ]]; then
      echo "  skip (target gone): $target"
      continue
    fi
    if [[ -e "$original" ]]; then
      echo "  skip (original path now occupied): $original"
      continue
    fi
    if [[ $DRY_RUN -eq 1 ]]; then
      echo "  would restore: $target -> $original"
    else
      mv "$target" "$original"
      echo "  restored: $target -> $original"
      reversed=$((reversed+1))
    fi
  done < <(tac "$LOG_FILE" 2>/dev/null || tail -r "$LOG_FILE")
  echo "Rollback complete: $reversed move(s) reversed."
  exit 0
fi

# Forward sweep: detect flat-layout tools and move them to quarantine.
moved=0
for entry in "$IMPORTED_ROOT"/*/; do
  [[ -d "$entry" ]] || continue
  if ! is_legacy_tool_dir "$entry"; then
    continue
  fi
  name="$(basename "$entry")"
  target="$QUARANTINE_DIR/$name"
  if [[ -e "$target" ]]; then
    echo "  skip (target exists): $target"
    continue
  fi
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  would move: $entry -> $target"
  else
    mkdir -p "$QUARANTINE_DIR"
    mv "$entry" "$target"
    log_move "$entry" "$target"
    echo "  moved: $entry -> $target"
    moved=$((moved+1))
  fi
done

if [[ $moved -eq 0 && $DRY_RUN -eq 0 ]]; then
  echo "No legacy flat-layout tools found under $IMPORTED_ROOT."
  echo "(Re-runs are no-ops; this is the idempotent state.)"
else
  echo "Migration complete: $moved tool(s) quarantined under $QUARANTINE_DIR/"
  echo "Each is now invisible to ToolRegistry. Re-promote via the Tools UI"
  echo "(Promote action — Phase α.4 pending) or by manually moving the"
  echo "directory into the target workspace slug folder."
fi
