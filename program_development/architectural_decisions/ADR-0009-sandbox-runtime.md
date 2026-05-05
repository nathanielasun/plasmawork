# ADR-0009: Per-Run Execution Sandbox Runtime

## Status
Proposed

## Date
2026-05-05

## Context

`secure_multi_user_scaffolding_plan_v4.md` §15 mandates that every
run — paper-import worker, ModelSpec generator, codegen evaluator,
capsule simulation, internal tool, AI-generated script — execute
inside a strong isolation boundary. The phase-05 security
implementation plan lists this decision as Gate **G1.L0.2**; the
sandbox runner itself ships in Layer 3 (L3.7) and is the phase's
critical path per the risk register.

Two adversaries from v4 §0.1 are direct targets:

- **Adversary 8** — malicious or vulnerable AI-generated code. The
  workbench routinely runs Python an agent wrote from a user-supplied
  paper; even non-malicious code can fuzz syscalls, open sockets, fork.
- **Adversary 10** — compromised worker process. A worker induced
  (via injected paper text, malicious tool manifest, or kernel CVE)
  to behave outside contract must not read another workspace,
  exfiltrate data, or pivot to the control plane.

v4 §15.1 enumerates the run-environment invariants the sandbox must
enforce: no ambient host FS access; no DB / signing-key / session
credentials in the run env; per-run root filesystem; read-only
capsule snapshot mounts; writable mounts only for approved
workspace-scoped paths; enforced CPU / memory / wall-time / PID /
disk quotas; default-deny network egress with explicit allowlist;
no DNS exfiltration channel (no UDP/TCP 53 except through a
controlled allowlist resolver).

The matching v4 §29 regression tests are #38–43 (sandbox cannot read
host FS / another workspace / DB credentials; cannot perform
unapproved HTTP egress; cannot perform DNS exfiltration; DNS
violation emits audit event) plus #67 (trusted tool still runs
inside sandbox). They must run under the chosen runtime, not a mock.

This ADR binds one technology to process isolation, syscall
filtering, filesystem layout, resource enforcement, network
namespacing, and the egress proxy story. Splitting into independent
components was rejected — every historical container-escape chained
two layers, so the backstop must be a single coherent runtime.

## Decision

1. **Production runs gVisor (`runsc`)** as the OCI runtime for every
   workbench run container. The orchestrator launches one gVisor
   sandbox per run with: `--platform=systrap` (or `kvm` where the
   host supports it); `--network=none` for the sandbox itself; a
   per-run root filesystem composed from a pinned base image + tmpfs
   upper layer; read-only bind mounts for the capsule snapshot
   (`workspaces/<workspace_id>/capsules/<capsule_id>/...`) and
   workspace data; a single read-write tmpfs mount for
   `temp_runs/<run_id>/`; cgroups v2 enforcement of CPU shares,
   `memory.max`, `pids.max`, `io.max` (disk quota), plus a
   runtime-supervised wall-clock deadline; drop-all Linux capabilities
   (nothing re-added); seccomp default-deny via gVisor's syscall
   surface (the host kernel never sees the sandboxed syscall
   directly); `--no-new-privs`, no SUID, no `/dev` passthrough.

2. **All egress flows through a per-run L7 proxy sidecar over a
   UNIX-domain socket.** The proxy is a `tinyproxy` (or Squid)
   container in a sibling namespace with its own network access; the
   proxy's listener is bound to a UNIX socket at
   `/var/run/secure_core/proxy.sock`, which is bind-mounted into the
   sandbox container as the only egress affordance. The sandbox
   container is launched with `--network=none` — no network namespace,
   no `lo`, no veth, no resolver. Direct UDP/TCP 53 from the sandbox is
   physically impossible: there is no network stack to open a socket
   against. The proxy enforces the v4 §15.3 hostname allowlist
   (package mirrors, HPC submission, institutional data sources, object
   storage upload, approved webhooks); blocked requests emit
   `sandbox.violation` audit events.

   Application HTTP clients inside the sandbox (Python `urllib3`,
   Node `undici`, `curl --unix-socket`) dial the bind-mounted socket
   instead of a TCP host. The L1.6 secrets wrapper exposes a
   `getSecret('proxy.unix_socket_path')` so workers can build the
   client without hardcoded paths. UNIX-socket-only is chosen over
   the alternative private-veth topology because the latter requires
   a network namespace inside the sandbox, which weakens the
   "no network stack" invariant — every veth pair is a packet path
   that a misconfigured allowlist could leak. UNIX sockets cannot
   carry IP packets and cannot resolve hostnames, so the leak class
   is closed by construction rather than by allowlist correctness.

3. **No long-lived credentials, signing keys, DB DSNs, or session
   material enter the sandbox env.** The orchestrator builds the run
   env explicitly: only the run-scoped worker token (v4 §18.1,
   single-purpose, single-run, narrow capability) and the run's
   declared parameters. Worker artifact upload uses ADR-0012, not
   direct DB writes.

4. **Trusted tools run inside the same sandbox.** v4 §15.2 forbids
   trust from granting sandbox escape; promotion to `trusted` may
   widen quotas or add allowlist entries within the sandbox, never
   exempt code from it. v4 test #67 enforces this.

5. **Dev uses Docker Desktop + gVisor on Linux, Docker Desktop's
   Linux VM + gVisor inside the VM on macOS.** Where gVisor is
   genuinely unavailable, a dev fallback to Docker rootless +
   drop-all capabilities + curated seccomp profile + user namespaces
   is permitted **only for tests that do not exercise §29 #38–43**.
   The §15.1 claims can only be asserted under gVisor.

6. **CI runs the full §29 #38–43 + #67 suite under gVisor on
   GitHub Actions Linux runners.** The job installs `runsc` in setup;
   if unavailable, sandbox tests **fail loudly** (pytest.fail naming
   this ADR), never silently pass. L3.7 reviewer protocol re-runs
   negative-path probes against staging before promotion.

## Alternatives Considered

Each alternative is evaluated against the v4 §15.1 enforcement list
plus adversaries 8 and 10.

### A. Docker + user namespaces (no gVisor)

FS isolation, cgroup quotas, and netns + sidecar proxy all check
the §15.1 boxes on paper. Kernel surface is the gap: the container
shares the host kernel, so a CVE in a syscall reachable from the
namespace breaks out. Adversary 8 (AI code fuzzing syscalls) and
adversary 10 (worker chaining a known CVE) are exactly that
workload. **Verdict: insufficient as sole defense.**

### B. Podman rootless

Same shape as A with a daemonless model and slightly stronger
default seccomp. Same kernel-surface limit. **Insufficient as
primary**, acceptable as a dev fallback when gVisor is unavailable.

### C. Kubernetes sandboxed pods (RuntimeClass=gvisor) + seccomp/AppArmor

Gvisor underneath, deployed via Kubernetes. All §15.1 invariants
enforceable via Pod spec + NetworkPolicy + ResourceQuota. Adds a
Kubernetes control plane before the workbench has users.
**Equivalent in security to bare gVisor**, premature operationally;
swap-in via the orchestrator interface at multi-tenant scale-out.

### D. Firecracker microVMs

Strongest isolation: per-run KVM VM with a minimal device model;
defeats kernel-CVE escapes by construction. All §15.1 invariants
satisfied. Each VM needs its own kernel + rootfs image; the jailer
config is an operational burden, and `/dev/kvm` is unavailable on
macOS dev machines and many CI runners — dev/CI parity becomes hard.
**Stronger than gVisor but operationally heavier than the project
can carry today**; the orchestrator is structured so Firecracker
can replace gVisor in a future ADR if a workload's syscall set
gVisor cannot serve.

### E. Local-only Docker for dev, no production sandbox

Rejected by v4 §15: "trust never grants sandbox escape" requires a
production sandbox regardless of dev convenience.

## Consequences

### Positive

- Defense in depth against adversaries 8 and 10: kernel-surface
  attacks must defeat gVisor's user-space syscall intercept layer
  on top of namespaces and seccomp.
- v4 §15.1 invariants bind to one runtime, not a checklist of
  co-operating layers.
- `--network=none` + L7 proxy makes DNS exfiltration physically
  impossible from inside the sandbox; v4 test #42 has a structural
  (not policy) basis.
- Trusted tools and untrusted AI-generated code share the runtime,
  so v4 §15.2 / test #67 falls out of architecture, not a per-tool
  flag that can drift.
- Future migration to Kubernetes RuntimeClass=gvisor or Firecracker
  is a runtime swap behind the orchestrator interface, not a rewrite.

### Negative

- **gVisor only runs on Linux.** macOS dev machines need Docker
  Desktop's Linux VM with gVisor inside, or a remote dev sandbox.
  Local laptop runs are degraded for macOS contributors.
- **Syscall coverage is a subset of Linux.** Some scientific Python
  workloads — mmap-heavy kernels, accelerator-driver `ioctl`s,
  certain `io_uring` paths, GPU passthrough — may fail or run
  slowly. Each unsupported syscall is a feature decision: declared
  workaround in the module, or escalate to Firecracker via a
  follow-up ADR.
- **Performance penalty.** ~10–30% overhead on I/O-heavy workloads,
  lower for CPU-bound numerics. Acceptable for security-critical
  workloads; re-measured per release.
- **L7 proxy is a maintained dependency.** Allowlist must track
  v4 §15.3 destinations; proxy CVEs are an upgrade obligation.

### Neutral

- Orchestrator gains a `SandboxRuntime` interface; gVisor is one
  implementation, the dev-fallback rootless-Docker path another
  (only for non-§29-#38–43 tests).
- Provenance gains a `sandbox.runtime` field stamped from the live
  runtime descriptor (parallel to ADR-0006's
  `backend.CAPABILITIES.deterministic`: identity read from the
  running sandbox, not a free-text claim).

## Implementation Notes

### Production

- `runsc` installed on every worker host.
- Per-run sandbox launched via the orchestrator using an OCI runtime
  spec generated from the run request; the spec is itself an audit
  artifact.
- Egress proxy sidecar runs in its own container with full network
  access. Its listener binds to a UNIX-domain socket at
  `/var/run/secure_core/proxy-<run_id>.sock`; that socket file is
  bind-mounted read-write into the sandbox container at a
  predictable in-sandbox path. The sandbox itself has `--network=none`
  — no network namespace, no `lo`, no veth pair. The bind-mounted
  socket is the entire egress affordance; nothing else reaches the
  proxy.
- Proxy allowlist is a workspace-scoped configuration object, not a
  per-run free-text field.
- Sandbox launch failures, quota terminations, and proxy denials all
  emit `sandbox.violation` audit events with the run id and the
  offending request.

### Development

- Linux: install `runsc`, register the runtime in Docker
  `daemon.json`, launch tests via `RUNTIME=runsc
  scripts/test/security.sh`.
- macOS: Docker Desktop with the Linux VM enabled, `runsc` inside
  the VM via `scripts/dev/install_sandbox_macos.sh` (stub to land
  alongside L3.7).
- When neither is available, `scripts/test/security.sh` **skips
  §29 #38–43 with a hard, visible failure** that names this ADR —
  not a silent pass.

### CI

- GitHub Actions Linux runners install `runsc` in a setup step.
- The security test job is required by branch protection per v4 §29.
- If the runner image drops `runsc`, the job fails loudly; bypass
  logic requires an ADR amendment.

### Required negative-path acceptance probes (L3.7 review)

The phase-05 implementation plan's L3.7 reviewer protocol runs
these against a real sandbox before sign-off:

1. **Fork-bomb** inside the sandbox is killed by the wall-time
   deadline (and `pids.max` should fire first).
2. **100 GB write attempt** to a writable mount is killed by the
   `io.max` / disk quota long before the host disk fills.
3. **5-minute tight loop** with no I/O is killed by wall-time.
4. `socket(AF_INET, SOCK_DGRAM, 0)` followed by `sendto(8.8.8.8:53,
   ...)` is refused; no packet leaves the host. (`--network=none`
   makes this structural; the test still asserts the syscall
   outcome and the absence of host-side traffic.)
5. **Mounting a host path that wasn't workspace-scoped** is
   refused at sandbox-spec validation time, before `runsc`
   launches.

Each probe lands as a test under `tests/security/test_sandbox_*.py`
and is included in v4 §29 #38–43 coverage.

### Forward references

- L3.7 (sandbox runner) implements this ADR.
- L4.3 (worker job protocol) and L4.11 (artifact upload) consume
  the worker token model assumed here.
- ADR-0012 (worker upload protocol) chooses between v4 §18.2
  Option A and Option B; this ADR is agnostic to that choice
  but assumes the worker has no DB credentials inside the
  sandbox.
- A future ADR will revisit Firecracker if a workload emerges
  whose syscall set gVisor cannot serve, or Kubernetes
  RuntimeClass=gvisor when the deployment moves to multi-tenant
  scale-out.
