#!/usr/bin/env bash
#
# gVisor runtime live probe — Phase 0.5 / Phase γ (2026-05-10).
#
# Verifies that the runsc binary is present, reports a version, and
# can boot a minimal sandboxed container. The workbench's worker
# execution path requires gVisor (or an equivalent userspace kernel)
# to keep tool / capsule code from reaching the host kernel directly;
# without runsc, the production sandbox falls open.
#
# Fail-closed posture:
#   - runsc not on PATH               → exit 1 with the override hint
#   - runsc --version returns nothing → exit 1
#   - sandbox dry-run prints != "gvisor_ok" → exit 1
#   - any unexpected exit code        → exit 1
#
# Override:
#   WORKBENCH_RUNSC_BIN=/path/to/runsc bash scripts/dev/check_gvisor_runtime.sh
#
# This is an OPERATOR script. It is NOT wired into scripts/test/*; it
# runs against a configured deployment env and is dispatched by the
# operator (or, eventually, a CI lane that's gated on the env's
# presence — see plan β/γ deferrals).
set -euo pipefail

RUNSC_BIN="${WORKBENCH_RUNSC_BIN:-runsc}"

if ! command -v "$RUNSC_BIN" >/dev/null 2>&1; then
  cat <<EOF >&2
gVisor probe FAILED: '$RUNSC_BIN' is not on PATH.

The workbench's worker execution path requires gVisor / runsc.
Install via the gVisor docs (https://gvisor.dev/docs/user_guide/install/)
or set WORKBENCH_RUNSC_BIN to a non-default install path.

Refusing to start a deployment without a working runsc binary;
the worker sandbox would otherwise fall open to host-kernel access.
EOF
  exit 1
fi

# Version probe — runsc prints to stderr by default; capture both.
if ! version_output="$("$RUNSC_BIN" --version 2>&1)"; then
  echo "gVisor probe FAILED: '$RUNSC_BIN --version' exited non-zero." >&2
  echo "$version_output" >&2
  exit 1
fi
if [[ -z "$version_output" ]]; then
  echo "gVisor probe FAILED: '$RUNSC_BIN --version' produced empty output." >&2
  exit 1
fi

# Sandbox dry-run. We build a tiny OCI bundle in TMPDIR with a
# config.json that echoes a known marker, run it under runsc, and
# assert the marker reaches stdout. If runsc cannot create the
# sandbox (e.g. unprivileged-user-namespaces disabled, KVM access
# refused, etc.) the probe fails loud rather than silently passing.
PROBE_DIR="$(mktemp -d -t workbench_gvisor_probe.XXXXXX)"
trap 'rm -rf "$PROBE_DIR"' EXIT

mkdir -p "$PROBE_DIR/rootfs/bin"
# Use the host's /bin/echo (statically linked enough on most Linux
# distros for a probe). On a real deployment, the rootfs would carry
# a known-good busybox.
if ! cp /bin/echo "$PROBE_DIR/rootfs/bin/echo" 2>/dev/null; then
  echo "gVisor probe FAILED: cannot stage /bin/echo into the probe rootfs." >&2
  exit 1
fi

cat > "$PROBE_DIR/config.json" <<EOF
{
  "ociVersion": "1.0.0",
  "process": {
    "terminal": false,
    "user": { "uid": 0, "gid": 0 },
    "args": ["/bin/echo", "gvisor_ok"],
    "env": ["PATH=/bin"],
    "cwd": "/"
  },
  "root": { "path": "rootfs", "readonly": true },
  "hostname": "workbench-gvisor-probe",
  "linux": { "namespaces": [{ "type": "pid" }, { "type": "mount" }] }
}
EOF

probe_out="$(
  "$RUNSC_BIN" --rootless --network=none run \
    --bundle "$PROBE_DIR" \
    "workbench-probe-$$" 2>&1
)" || {
  echo "gVisor probe FAILED: sandbox run exited non-zero." >&2
  echo "$probe_out" >&2
  exit 1
}

if [[ "$probe_out" != *"gvisor_ok"* ]]; then
  echo "gVisor probe FAILED: sandbox stdout did not contain 'gvisor_ok'." >&2
  echo "$probe_out" >&2
  exit 1
fi

echo "gVisor probe OK: $version_output"
echo "  sandbox dry-run produced: gvisor_ok"
exit 0
