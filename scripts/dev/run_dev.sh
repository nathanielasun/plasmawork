#!/usr/bin/env bash
#
# scripts/dev/run_dev.sh — boot the full three-process dev stack from one command.
#
# Replaces the three-terminal model (run_backend.sh + run_*_gateway.sh +
# run_ui.sh) with a single command. Backgrounds each process, prefixes
# their log output, blocks on the gateway becoming ready, and cleans up
# every PID on Ctrl-C / process exit.
#
# Modes:
#   --stub  (default)  Use scripts/dev/run_dev_stub_gateway.sh on :4000.
#                      Zero-config. NO real auth. Accepts any login.
#   --real             Use scripts/dev/run_gateway.sh on :4000.
#                      Requires .env.auth + Postgres + bootstrap admin.
#
# The default is stub because it's the friendliest for new contributors
# and the common case (UI/backend dev). Real-auth dev is one flag away.
#
# Output is interleaved on a single stdout stream, line-prefixed by
# source ([backend] / [stub] / [gateway] / [ui]) via sed. Portable
# across BSD and GNU sed.

set -uo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"

MODE="stub"
for arg in "$@"; do
  case "$arg" in
    --stub) MODE="stub" ;;
    --real) MODE="real" ;;
    --help|-h)
      cat <<EOF
Usage: scripts/dev/run_dev.sh [--stub | --real | --help]

Boots the three-process dev stack:
  Terminal-less, single command:
    FastAPI backend on :8000
    Gateway (stub or real) on :4000
    Vite UI dev server on :5173

  --stub  (default)  Zero-config stub gateway. NO real auth.
  --real             Real gateway. Requires .env.auth + Postgres.

  Ctrl-C cleanly stops every process. Each process's stdout is
  prefixed with its source name on a single interleaved stream.
EOF
      exit 0
      ;;
    *)
      echo "run_dev.sh: unknown argument: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

# -- pre-flight ---------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "run_dev.sh: node not on PATH" >&2
  exit 1
fi
if [[ ! -x "$REPO_ROOT/.venv/bin/python" ]]; then
  echo "run_dev.sh: .venv/bin/python missing. Run scripts/dev/install.sh first." >&2
  exit 1
fi
if [[ "$MODE" == "real" && ! -f "$REPO_ROOT/.env.auth" ]]; then
  echo "run_dev.sh: --real requires /.env.auth (cp .env.auth.example .env.auth)" >&2
  exit 1
fi

# -- process lifecycle --------------------------------------------------------
PIDS=()

# Recursive process-tree killer. npm doesn't reliably forward SIGTERM
# to its child node, and Python's subprocess.call wraps uvicorn as a
# grandchild; killing only the direct child leaves the listener orphaned
# and the port held. Walk pgrep -P depth-first and signal each pid.
kill_tree() {
  local pid="$1"
  local sig="${2:-TERM}"
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child" "$sig"
  done
  kill -"$sig" "$pid" 2>/dev/null || true
}

cleanup() {
  # Dedupe re-entry: SIGINT/SIGTERM fires the trap, then bash exits
  # and fires EXIT too. Clear all three so the second pass is a no-op.
  trap - EXIT INT TERM
  echo "[run_dev] shutting down..." >&2
  local pid
  for pid in "${PIDS[@]:-}"; do
    [[ -n "${pid:-}" ]] && kill_tree "$pid" TERM
  done
  # Belt and suspenders: signal every direct child of this shell, in
  # case `cmd > >(sed) &` set $! to something other than cmd's PID on
  # this platform.
  pkill -TERM -P $$ 2>/dev/null || true
  # Give graceful shutdown ~1s before SIGKILL escalation.
  sleep 1
  for pid in "${PIDS[@]:-}"; do
    [[ -n "${pid:-}" ]] && kill_tree "$pid" KILL
  done
  pkill -KILL -P $$ 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Pipe-prefix helper: use process substitution so $! is the actual
# command's PID (NOT sed's). With `cmd | sed &`, $! is sed and killing
# it leaves the upstream command running. With `cmd > >(sed) &`, the
# command is the direct child and the sed sibling drains naturally.
spawn_prefixed() {
  local prefix="$1"
  shift
  "$@" > >(sed "s/^/[$prefix] /") 2> >(sed "s/^/[$prefix] /" >&2) &
  PIDS+=($!)
}

# -- spawn FastAPI ------------------------------------------------------------
echo "[run_dev] starting FastAPI on :8000..."
spawn_prefixed backend "$SCRIPT_DIR/run_backend.sh"

# -- spawn gateway ------------------------------------------------------------
if [[ "$MODE" == "real" ]]; then
  echo "[run_dev] starting REAL gateway on :4000..."
  spawn_prefixed gateway "$SCRIPT_DIR/run_gateway.sh"
else
  echo "[run_dev] starting STUB gateway on :4000 (zero auth)..."
  spawn_prefixed stub "$SCRIPT_DIR/run_dev_stub_gateway.sh"
fi

# Block on the gateway becoming ready. Reuses the Layer-4 helper.
"$SCRIPT_DIR/wait_for_http.sh" "http://127.0.0.1:4000/auth/session" 30 || {
  echo "[run_dev] gateway did not become ready on :4000 — aborting." >&2
  exit 1
}

# -- spawn UI -----------------------------------------------------------------
echo "[run_dev] starting UI on :5173..."
spawn_prefixed ui "$SCRIPT_DIR/run_ui.sh"

# -- ready banner -------------------------------------------------------------
cat <<EOF

================================================================
  Dev stack running. Open http://localhost:5173

  Mode: $MODE
EOF
if [[ "$MODE" == "stub" ]]; then
  cat <<EOF
  Login: any username + password (stub accepts everything).
EOF
fi
cat <<EOF
  Ctrl-C to stop every process.
================================================================

EOF

# Block until any backgrounded process exits OR the user Ctrl-Cs.
# The trap kills the rest on the way out.
wait
