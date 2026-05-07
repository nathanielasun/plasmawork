#!/usr/bin/env bash
#
# Install the repo-local SimWorkbench tool-construction skill into a local
# Codex skill directory. This script mutates the user's home directory only
# when invoked without --dry-run.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/dev/install_tool_construction_skill.sh [--copy|--symlink] [--force] [--dry-run] [--target-root DIR]

Installs .agents/skills/simworkbench-tool-construction into:
  $CODEX_HOME/skills, when CODEX_HOME is set
  ~/.codex/skills, otherwise

Options:
  --copy             Copy the skill directory.
  --symlink          Symlink the skill directory (default).
  --force            Replace an existing installed skill path.
  --dry-run          Print the planned action without writing.
  --target-root DIR  Override the skills root directory.
  -h, --help         Show this help.
USAGE
}

MODE="symlink"
FORCE="0"
DRY_RUN="0"
TARGET_ROOT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --copy)
      MODE="copy"
      ;;
    --symlink)
      MODE="symlink"
      ;;
    --force)
      FORCE="1"
      ;;
    --dry-run)
      DRY_RUN="1"
      ;;
    --target-root)
      if [[ $# -lt 2 || -z "$2" ]]; then
        echo "ERROR: --target-root requires a directory argument." >&2
        exit 2
      fi
      TARGET_ROOT="$2"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
SKILL_NAME="simworkbench-tool-construction"
SOURCE="$REPO_ROOT/.agents/skills/$SKILL_NAME"

if [[ ! -d "$SOURCE" ]]; then
  echo "ERROR: repo-local skill not found: $SOURCE" >&2
  exit 1
fi

if [[ -z "$TARGET_ROOT" ]]; then
  if [[ -n "${CODEX_HOME:-}" ]]; then
    TARGET_ROOT="$CODEX_HOME/skills"
  else
    TARGET_ROOT="$HOME/.codex/skills"
  fi
fi

TARGET="$TARGET_ROOT/$SKILL_NAME"

echo "source: $SOURCE"
echo "target: $TARGET"
echo "mode:   $MODE"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "dry-run: no files changed"
  exit 0
fi

mkdir -p "$TARGET_ROOT"

if [[ -e "$TARGET" || -L "$TARGET" ]]; then
  if [[ "$FORCE" != "1" ]]; then
    echo "ERROR: target already exists. Re-run with --force to replace: $TARGET" >&2
    exit 1
  fi
  rm -rf "$TARGET"
fi

if [[ "$MODE" == "copy" ]]; then
  cp -R "$SOURCE" "$TARGET"
else
  ln -s "$SOURCE" "$TARGET"
fi

echo "installed: $TARGET"
