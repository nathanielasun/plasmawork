#!/usr/bin/env bash
#
# Focused secure-core workspace path isolation checks.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PKG_DIR="$REPO_ROOT/packages/secure_core"

if [[ ! -d "$PKG_DIR/node_modules" ]]; then
  echo "[workspace-paths] $PKG_DIR/node_modules missing — run npm install in packages/secure_core." >&2
  exit 1
fi

cd "$PKG_DIR"
exec npx vitest run \
  test/paths/builder.test.ts \
  test/paths/components.test.ts \
  test/paths/extractArchive.test.ts \
  test/paths/safeOpen.test.ts \
  test/workers/deriveArtifactPath.test.ts
