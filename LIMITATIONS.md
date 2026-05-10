# Capabilities and Limitations

**Last updated: 2026-05-09 (Phase 0.5 audit fix bundle F1-F5 + recovery→session bridge + audit follow-up: login + CSRF cookie issuance, run-backend high-risk gating, workspaces audit-tx ordering with behavioral regression, cookieSecret hardening, password-reset/email-verify mint a fresh session unconditionally (`loginService` is now type-required on `authRoutes`, not optional), `LoginResponseBody` + `/auth/login` + `/auth/logout` are now in the frontend contracts surface. One known follow-up remains visible in `--include-open-workstreams`: HMAC-signed pagination cursors on audit-events + operator routes. Secure-core is implemented through Layer 5: identity/session/login, workspace-scoped routes, approval middleware, audit/provenance chains, sandbox spec guards, worker-token/upload paths, security dashboard, rate limits, production-secret validation, supply-chain gates, and frontend Security Ops binding. Production multi-user operation still requires target-runtime live probes for DB roles, gVisor/runsc, and WORM anchors, plus an explicit deployment cut-over from the local single-user FastAPI workbench.)**

This document is the honest, non-aspirational map of what the Scientific Simulation Workbench can and cannot do today. The convention checker verifies *structural* completeness — files exist, classes define the right fields, tests cover the named verbs. It does **not** verify scientific capability. A green gate plus a passing test suite means the wiring works and regressions don't sneak back in. It does NOT mean the system can take a real laser-physics paper and produce a publishable simulation autonomously.

If you are evaluating this workbench for real research work, read this file first. If you are an agent shipping a phase, **update the relevant section in the same commit that flips the phase status**. The maintenance protocol is at the bottom.

---

## TL;DR

What you have is a well-tested **substrate**:
- Schemas, units, runtime contract, capsule format, provenance, sweep / UQ / optimization, FastAPI + TypeScript UI, audit trails, approval gates.
- One real numerical domain (0D rate equations) end-to-end, with deterministic seeded execution and validated agreement between two backends.
- Six small physics modules promoted to `validated` against analytic limits.
- A secure-core multi-user scaffold with server-derived identity, workspace object scope, approval-token middleware, audit/provenance chain verification, security dashboard, and CI/security gates.

What you do **not** have:
- An LLM in the loop. Every "agent" in `simworkbench.autonomy` is a Python class with hand-coded heuristics. The plan's "autonomous experiment design" is a structured-data emitter, not a reasoning system.
- A real solver suite. The C++/CUDA pipeline ships `axpy`. There is no PIC, MHD, hydrodynamics, fluid-plasma, or coupled radiation-transport solver implemented. The registry has *slots* for them; the slots are empty or contain skeleton modules.
- Real paper interpretation. Phase 4 extracts text, tables, figures, equations, and parameters from a paper, but the four interpretation artifacts (`assumptions.md`, `validity_domain.md`, `paper_summary.md`, `implementation_plan.md`) are AGENT DRAFTS with placeholder bullets. They exist to be hand-edited by a reviewer.

---

## Capabilities (production-shaped)

These subsystems are real, tested, and work as documented. You can use them in earnest today.

### Numerical core

| Capability | Module | Status | Notes |
|---|---|---|---|
| 0D rate-equation ODE integration | `simworkbench.runtime.python_cpu` | Validated | SciPy LSODA, deterministic seeded, NaN/inf-clean over typical input ranges. |
| Numba-JIT 0D rate equations | `simworkbench.runtime.numba_cpu` | Validated | Cross-backend agreement vs. python_cpu within `rtol=1e-6`. |
| Run lifecycle (start/pause/resume/stop) | `simworkbench.runtime.runner` | Real | `RunState` machine, event bus, progress tracker, checkpoint every N steps. |
| Deterministic seeding | `simworkbench.runtime.seeds` | Real | `derive(base_seed, run_id)` produces a reproducible `SeedSet`. |
| Units boundary | `simworkbench.units` (`pint`) | Real | All public ModelSpec fields carry pint quantities; raw floats refused at validators. |

### Schema, serialization, provenance

| Capability | Module | Status | Notes |
|---|---|---|---|
| ModelSpec v0.1 IR | `simworkbench.model_spec` | Real | Pydantic-typed; recursive validation rejects raw floats / unitless numeric strings. |
| Capsule format | `simworkbench.serialization` | Real | `manifest.toml` v0.1 + HDF5 bulk data + JSON sidecars. ADR-0002 Accepted. |
| Capsule export / fork | `simworkbench.serialization.capsule` + `scripts/export/` | Real | `export_capsule`, `fork_capsule`, `export_archive`. Outside-source target validated before write. |
| Provenance triad | `simworkbench.provenance` | Real | `provenance.lock`, `agent_trace.md` (append-only), `environment.yaml`. |
| Determinism stamping | `simworkbench.serialization.capsule` + ADR-0006 | Real | `provenance.lock.determinism` derived from `BackendCapabilities`, never user-claimed. |

### Sweep / Optimization / Uncertainty

| Capability | Module | Status | Notes |
|---|---|---|---|
| Sweep engine | `simworkbench.sweep.SweepEngine` | Real | Hard `max_evaluations` cap, no bypass kwargs, JSON checkpoint resume across kills. |
| Sweep samplers | `simworkbench.sweep.samplers` | Real | Grid, Random, Latin-hypercube, Adaptive ABC. |
| Random search | `simworkbench.optimization.RandomSearchOptimizer` | Real | Deterministic with seed; converges on canonical quadratic. |
| Bayesian opt hook | `simworkbench.optimization.BayesianOptimizerHook` | Real (optional) | Wraps `scikit-optimize` `gp_minimize`; raises `BayesianUnavailable` if missing. Real callback-driven early stop. |
| Monte Carlo propagation | `simworkbench.uncertainty.MonteCarloPropagator` | Validated | Linear / quadratic / mixed-distribution checks against closed form. |
| Sensitivity analysis | `simworkbench.uncertainty.SensitivityAnalysis` | Real | Variance-based first-order index (lightweight Sobol stand-in). |
| Bootstrap CI | `simworkbench.uncertainty.bootstrap_confidence_interval` | Real | Validated against nominal coverage probability. |
| Comparison report | `simworkbench.reports.ComparisonReport` | Real | Ranks a `SweepReport`, writes `manifest.json` + `report.md`. |

### Registry, lifecycle, approval

| Capability | Module | Status | Notes |
|---|---|---|---|
| Tool registry + lifecycle | `simworkbench.tools` | Real | `BaseTool` ABC, `ToolMetadata`, draft → candidate → trusted, single-use approval tokens. |
| Module registry + lifecycle | `simworkbench.modules` | Real | `ModuleMetadata`, draft → candidate → validated → trusted → deprecated, gated by approval tokens AND benchmark evidence AND test execution. |
| Backend registry + lifecycle | `simworkbench.backends` | Real | Same gating as modules; `Literal`-typed status. |
| Autonomy approval gate | `simworkbench.autonomy.ApprovalGate` | Real | Single-use file-backed tokens, action+subject scoped, refuses without grant. |
| Locality guards | `simworkbench.paths.is_under_workbench` | Real | Every Phase 8/9/10 writer (SlurmJob, SweepEngine, SweepCheckpoint, ComparisonReport, ScientificReviewer, ApprovalGate, StubPICAdapter) refuses non-workbench targets by default. |

### API and UI plumbing

| Capability | Module | Status | Notes |
|---|---|---|---|
| FastAPI server | `simworkbench.api.server` | Real | 35 endpoints, all return real data, none read `actor`/`role` from the body. |
| TypeScript UI shell | `apps/workbench-ui` | Real | Vite + React + React Router, 13 navigation panels, type-shared client (`apiClient`). |
| Examples gallery | `apps/workbench-ui/src/components/examples/ExamplesGallery.tsx` + `GET /api/examples` + `POST /api/examples/{name}/run` | Real | Discovers `examples/*/` dirs that ship `run.py` + `README.md`. ModelSpec examples drive `Runner` inline; script examples exec via subprocess with the repo venv (5-min timeout, server-side allow-list, no client-supplied paths). Default landing route. |
| Folder browser | `apps/workbench-ui/src/components/ui/FolderBrowser.tsx` + `GET /api/browse` | Real | Read-only tree view over the four workbench-managed roots + `examples/`. Server allow-lists root names; resolves `..` and symlink-escape attempts via `.resolve().relative_to(root)` and refuses with 400. AbortController-cancellable on the client. Replaces the hand-typed path inputs in AutonomyPanel and RunControls; original `<input>` stays as a power-user fallback. |
| Unified runs view | `GET /api/runs` (merged) + `GET /api/runs/{id}/diagnostics/{name}` (disk fallback) | Real | Backend merges in-memory runs with on-disk `temp_runs/<id>/summary.json` files; heterogeneous summary shapes (python_cpu's `species_trajectories: {A: [...]}` and tabular runs' `rows: [{T, m, ...}]`) both surface as dotted diagnostic keys (`species_trajectories.A`, `rows.m_per_spin`). Time axis falls back to integer index when the summary has no `time_seconds`. Path-traversal-guarded (`run_id` cannot contain `/` or start with `.`). Diagnostics tab now shows every run a researcher launches via the Examples gallery, not just in-memory ones. |
| Docs viewer | `apps/workbench-ui/src/components/DocsViewer.tsx` (single-server) | Real | Bundles every page under `docs_site/src/content/*.tsx` into the workbench UI via Vite's `import.meta.glob`, one lazy chunk per page. No iframe, no probe, no second server — the Documentation tab works the moment the workbench UI is up. Typography handled by a `.docs-content` wrapper class so the existing TSX pages render readable without per-page styling. AGENTS.md "no inlined doc text" preserved — pages literally come from `docs_site/src/content/`, just bundled instead of separately served. The `docs_site/` Vite app remains as an optional standalone build target (`scripts/docs/build.sh`). |
| Code viewer | `apps/workbench-ui/src/components/CodeViewer.tsx` + capsule file APIs | Real | Read-only viewer over capsule `src/generated/`, `src/user_edits/`, and `src/kernels/` using `listCapsules`, `getCapsuleTree`, and `getCapsuleFile`. User-owned files are labeled and not editable from this route. |
| Vite ↔ FastAPI proxy | `apps/workbench-ui/vite.config.ts` | Real | `/api` → `localhost:8000`. |
| Convention checker | `scripts/dev/check_repo_conventions.sh` | Real | Default hard gate plus opt-in `--include-open-workstreams` backlog view. Hard gate for repo health. |
| Test runner | `scripts/test/all.sh` | Real | Convention check → ruff lint → unit → integration → regression → validation → performance → UI typecheck. |

### Secure multi-user scaffold

| Capability | Module | Status | Notes |
|---|---|---|---|
| Server-derived session | `packages/secure_core/src/auth` + `/auth/session` | Real scaffold | Session data includes actor, assurance, memberships, roles, and capabilities. Live memberships with zero capabilities remain visible. |
| Login + CSRF cookie issuance | `packages/secure_core/src/auth/loginService.ts` + `/auth/login` route | Real scaffold | `POST /auth/login` mints `secure_session` (HttpOnly) and `csrf_token` (non-HttpOnly) cookies with constant-time anti-enumeration; `POST /auth/logout` revokes the session and clears both cookies idempotently. `password-reset/consume` and `email-verify/consume` bridge into a fresh session via `LoginService.mintSessionForUser` (aal2 for password reset, aal1 for email verify) — `loginService` is type-required on `authRoutes`, so a host that forgets to wire it fails to compile. Deployments inject their own `verifyPasswordHash` / `fetchPasswordHash` seam (Argon2id is the recommendation). |
| Workspace-scoped routes | `packages/secure_core/src/routes/` | Real scaffold | Workspaces, capsules, runs, artifacts, tools, approvals, operator, bootstrap, worker token/upload, and security-dashboard routes enforce auth, membership/capability, schema, object scope, and audit checks. Run creation gates `expensive:*` and `hpc:*` backends through the L2.9 high-risk approval token flow. |
| Approval middleware | `packages/secure_core/src/middleware/requireApprovalIfHighRisk.ts` | Real scaffold | Human-only, single-use high-risk approval token consumption with operator step-up preconditions where required. Run-create route classifies the body's `backend` and consumes approval tokens for `expensive_run` / `hpc_submission` actions. |
| Audit/provenance chains | `packages/secure_core/src/audit/` | Real scaffold | Append-only chain verification, external-anchor readback when WORM provider is configured, periodic verifier job, and dashboard health summaries. |
| Sandbox runner scaffold | `packages/secure_core/src/sandbox/` | Real scaffold | Launch specs forbid privileged mode, default network egress, forbidden env, and mount escapes. Production isolation still depends on a target runner with `runsc` and live probes. |
| Security Ops UI | `apps/workbench-ui/src/components/security/` | Real scaffold | `/security` route renders server-derived session/dashboard data when available and labels fixture fallback during local UI review. |

### Validated physics modules

Six modules ship at `validated` against analytic limits:

| Module | Path | Validated against |
|---|---|---|
| `absorption_lambert_beer` | `packages/physics_modules/laser/absorption_lambert_beer/` | `I(z) = I0 * exp(-α z)` to closed form. |
| `rate_equation_0d` | `packages/physics_modules/species/rate_equation_0d/` | Conservation + steady-state analytic limits. |
| `lennard_jones` | `packages/physics_modules/molecular_dynamics/lennard_jones/` | Energy drift < 1e-3 over 1000 steps. |
| `ising_2d` | `packages/physics_modules/phase_transition/ising_2d/` | Critical temperature within 5% of Onsager. |
| `wave_equation_1d` | `packages/physics_modules/pde/wave_equation_1d/` | 2nd-order grid convergence. |
| `reaction_diffusion_1d` | `packages/physics_modules/pde/reaction_diffusion_1d/` | Steady-state matches analytic profile. |

---

## Limitations (skeleton / heuristic / not yet shipped)

These subsystems exist as named entities the plan promised, but the implementation is a template, a heuristic, or a structured-data emitter rather than the intelligence the name suggests. **None of these are scams** — every one ships with tests that exercise the named contract, and the code does what its docstring says it does. The limitation is the gap between the plan's prose and what a reasonable reader assumes from a name like "Experiment Design Agent".

### Phase 4 — Paper interpretation is template-driven

| Artifact | What it actually does | What it does NOT do |
|---|---|---|
| `extracted_text.md` | Real `pypdf` text extraction (or identity for Markdown sources). | — |
| `extracted_tables.json` | Pipe-table parser; finds tables in Markdown / extracted PDF text. | Image-based tables in PDFs are missed. |
| `extracted_figures.json` | Alt-text + nearby-caption regex. | No actual figure understanding. |
| `extracted_equations.json` | Inline-LaTeX + display-math regex with confidence heuristic. | No semantic equation parsing. |
| `extracted_parameters.yaml` | Numeric value + unit-string extraction; flags `missing_units`. | No domain awareness; nuclear cross-sections and laser intensities look the same. |
| `paper_summary.md`, `assumptions.md`, `validity_domain.md`, `implementation_plan.md` | **AGENT DRAFT templates with placeholder bullets**. | No actual content extraction. Plan §Phase 4 explicitly forbids treating these as trusted; Phase 5's ModelSpec generation only consumes them after a human reviewer has approved every row. |

### Phase 5 — ModelSpec generation requires reviewed input

`ModelSpecGenerator` will refuse to run unless every interpretation artifact has `edited_by` non-empty AND the agent's "AGENT DRAFT — NEEDS HUMAN REVIEW" banner is gone. This is a feature (Plan §22 Scientific Accuracy Policy), not a bug — but it means the autonomous "paper → working ModelSpec" pipeline always requires a human reviewer in practice. The convention checker has a regression that pins the banner check across all four interpretation Markdown shapes.

### Phase 6 — Code generation is templated, not creative

`CodeGenerator` produces `experiment.py` from a fixed template parameterised by the spec. It produces:
- A deterministic `experiment.py` that calls the Phase-1 runner.
- Per-output diagnostic helpers from the spec's diagnostic declarations.
- Generated tests (unit / dimensional / smoke / regression / convergence-when-applicable) — also templated.
- A README header citing the source paper, ModelSpec hash, generation timestamp.

It does **not** invent new numerical methods, write a novel solver, or compose modules that don't already exist in the registry.

### Phase 7 — Validated module library is six toy benchmarks

The registry has slots for laser, plasma, species, spectroscopy, molecular_dynamics, phase_transition, pde, monte_carlo. Six modules are at `validated` (table above). Everything else is `candidate` skeleton or absent. The "full Phase 7B laser-species family" exists as candidate/validated stubs but the validated set is the six listed.

### Phase 8 — Backends are mostly capability descriptors

| Backend | Status | What ships |
|---|---|---|
| `python_cpu` | Validated | Real SciPy LSODA solver. |
| `numba_cpu` | Validated | Real Numba JIT path; agrees with python_cpu within `rtol=1e-6`. |
| `cpp` | In-progress | **One reference kernel: `axpy`**. CMake build + ctypes ABI wrapper. Not a solver suite. |
| `cuda` | Planned | Capability probe + memory estimator + determinism warning. **No GPU kernel ships.** |
| `fortran`, `kokkos`, `petsc`, `amrex` | Planned | Capability descriptors only. |
| `slurm` (HPC bundle) | Real | `SlurmJob.write` produces a real `submit.sh` + payload. The remote node still needs `simworkbench-core` installed. |
| `ray` (HPC adapter) | Stub | `RayAdapter` exists; remote execution is not wired. |
| `external_pic` | Stub | `StubPICAdapter` is in the name. Input-deck writer + result importer are placeholders. |

### Phase 10 — "Agents" are heuristics

There is no LLM in the loop. Every class in `simworkbench.autonomy` is a Python heuristic:

| Agent | What it actually does |
|---|---|
| `ExperimentDesigner.design(spec)` | Returns an `ExperimentPlan` with: a string-format MVP, a fixed two-or-three-rung fidelity ladder (`screening` / `reference` / `converged`), a heuristic CPU-second cost (`O(N_species) × dim^100`), `density_<species>` + `mass_balance` + `energy_balance` diagnostics, and a domain-keyed validation path lookup (e.g. `"species" → "rate-equation steady-state matches analytic limit"`). |
| `SmokeRunner.run(experiment)` | Calls the real Phase-1 `Runner`. "Diagnostic interpretation" is `min/max/final` summary. "Instability detection" is `math.isnan` / `math.isinf` plus a 10×-per-step blow-up check. Suggested adjustments are hand-keyed responses to flag categories ("blow-up → halve dt"). |
| `ControlledSweepAgent` | Real budget-bounded sweep + real failure-rate observer. The `next_sweep_recommendation` is the literal string `"tighten the parameter ranges around the best observed point ..."` parameterised by the best row. |
| `ScientificReviewer.review(capsule)` | Regex matching for absolutist words (`always`, `guaranteed`, `exact`, `fully validated`, `first principles`) across `README.md`, `model_spec.yaml`, `validation_summary.md`. Domain → canonical-solver lookup table for "literature alignment". The review IS structured and useful for catching low-hanging issues; it is NOT a domain expert. |
| `ApprovalGate` | Real single-use file-backed tokens. The "human in the loop" IS real — a token only exists because a human ran `grant_autonomy_approval`. |

The autonomy layer's real value is the *structure*: every autonomous decision lands in `<capsule>/provenance/agent_trace.md`, every privileged action requires a human-issued token, every plan with placeholder coefficients pins the capsule to `exploratory`. It is a safe surface to plug a real LLM into. **It is not itself a real LLM-driven autonomy system.**

---

## Concrete things that won't work today

A short, brutal list of cases where you'd hit a wall. Each is a real consequence of the limitations above.

1. **"Import this PIC paper and run a 1D sim."** Phase 4 extracts text/equations/parameters; Phase 5 needs a human to review and clean up the four interpretation artifacts; Phase 6 can only generate code that calls a registered module. There is no PIC module. End of road.
2. **"Run this on the GPU."** `cuda` is a capability descriptor with a determinism warning. There's no GPU kernel for any solver.
3. **"Sweep over rate constants for a real KrF laser."** No real plasma-laser module ships. The `species/rate_equation_0d` solver works but `python_cpu` can only honor explicit `placeholder:` coefficient sources unless a validated module/backend supplies a real numeric rate. A placeholder-rate run remains `exploratory`.
4. **"Have the agent critique my spec and fix the issues."** The reviewer flags absolutist phrasing and missing-physics categories. It does not propose code changes, and does not have any model of *what physics is missing for your specific problem*.
5. **"Submit to a real Slurm cluster from the workbench."** `SlurmJob.write` writes a real bundle. The remote node needs `simworkbench-core` installed and `PYTHONPATH` configured; the bundle is "self-contained" only for the workbench's own payload + entrypoint, not for the runtime. ADR documents this.
6. **"Run the full `examples/autonomous_experiment_kr` pipeline against a real paper."** The example uses a stand-in quadratic objective. The four-stage pipeline runs end-to-end, but the objective it sweeps is `(x - 0.7)^2`, not anything tied to the spec.
7. **"Have multiple researchers share a production workspace."** Partial. The Phase 0.5 auth gateway at `apps/workbench-gateway/` is the new public entry; secure-core's login, session, CSRF, audit, approval, and capability stack now run against real HTTP traffic, and the FastAPI workbench is loopback-bound behind it. What's *not* yet done: WebAuthn / TOTP enrollment for the platform admin (password-only at aal2 in this cut), workspace-scoped imported-tool registries (the `local_cache/imported_tools/` cache stays cross-tenant), and the deployment cut-over to a target-runtime CI lane that exercises the live probes. The browser flow (login → workspace switcher → `/api/{slug}/*` proxied to FastAPI) works end-to-end on a developer machine; production multi-user operation still requires the live-probe lanes to pass.
8. **"Run this on a production sandboxed worker."** Not from the default local scientific runtime. Secure-core has worker-token/upload paths and sandbox launch-spec guards; `simworkbench.runtime.python_cpu` still runs in-process for local examples. Production worker execution requires a `runsc`-capable target runtime and green live probes.

---

## Authentication gateway: no break-glass, manual re-bootstrap

The Phase 0.5 auth gateway (ADR-0014, 2026-05-09) ships with a deliberately
hard recovery story. There is **no code-level break-glass env var**. A
break-glass would be the most-stolen string in the deployment and would
make the WORM seal a lie. The trade-off is that a lost admin is an
operator outage, not a self-service recovery.

### What "sealed" means

Successful first-boot bootstrap writes a write-once marker via the
configured `WORKBENCH_BOOTSTRAP_WORM_PROVIDER`:

- **Production** (`s3`): the marker lives at
  `s3://<bucket>/<key>` with `ObjectLockMode=COMPLIANCE` and a 10-year
  default retention. Even the AWS root account cannot shorten the
  retention or delete the version before the retain-until date. A
  database restore alone CANNOT re-enable bootstrap.
- **Single-node dev** (`fake`): the marker lives in process memory.
  Durable enough for first-boot bootstrap on a developer machine; a
  process restart wipes it. The gateway refuses to start with the
  in-memory fake when `BOOTSTRAP_ALLOWED=1` AND no provider is
  configured, so a production env that forgets to set the provider
  fails loudly instead.

After the seal, `POST /bootstrap` returns 404 — the route is unregistered
on the next process start because `WormMarkerProvider.isBootstrapped()`
returns true.

### Manual re-bootstrap runbook

This is intentionally a human operator workflow, with audit-visible
steps:

1. **Confirm the admin is genuinely lost.** Password reset and recovery
   flows go through the normal `RecoveryService`; only attempt
   re-bootstrap when those are unavailable (the platform admin has no
   email of record by design).
2. **Disable the existing admin row.** Connect to the application
   database with an operator credential (NOT the app role) and set the
   admin user's `disabled_at`. Audit + provenance rows for the lost
   admin remain — the platform record is append-only.
3. **Invalidate the WORM marker.**
   - Production (S3 Object Lock COMPLIANCE): you cannot delete the
     locked object before its retain-until date. Operator options are
     to wait out retention, or to point the gateway at a NEW bucket /
     key combination via `WORKBENCH_BOOTSTRAP_WORM_S3_BUCKET` /
     `_KEY`. The old anchor remains a permanent record.
   - Dev (`fake`): a process restart already wipes it.
4. **Re-run bootstrap.** Set a fresh `BOOTSTRAP_CREDENTIAL_HASH`,
   restart the gateway with `BOOTSTRAP_ALLOWED=1`, POST the new OOB
   credential as in the README's bootstrap walkthrough.
5. **Audit cleanup.** The original admin's audit chain is intact;
   re-bootstrap creates a separate `bootstrap.completed` row tied to a
   new `admin_user_id`. There is no merging of identities.

If you find yourself looking for a flag named `BOOTSTRAP_FORCE`,
`SKIP_WORM`, or equivalent — that's the seal working as designed. The
runbook above is the only authorized path.

### Deferred admin authentication factors

The Phase 0.5 auth gateway is **password-only at aal2** for the platform
admin. WebAuthn (passkey) and TOTP enrollment endpoints are deferred and
tracked under `--include-open-workstreams`. Until then, the platform
admin's defenses are the per-account counter on
`user_credentials.failed_attempts`, the per-IP login rate limit (now
trustworthy because the trust-proxy posture ignores client-supplied
`X-Forwarded-For` by default), and the operator runbook above for true
loss.

### Slug cross-check posture

`packages/core/src/simworkbench/api/auth_middleware.py` accepts a
`slug_prefixed_paths` constructor argument that turns the URL workspace
slug into a third defense against path tampering. It defaults to
empty: today's gateway strips the slug from the URL via `preRewrite`
before proxying to FastAPI, so there is no slug in the FastAPI URL to
cross-check. The defense relies on HMAC + loopback bind. The flag
becomes load-bearing only when FastAPI adopts `/api/{slug}/{rest}`
routes; planning for that is tracked under the secure-core open
workstreams.

---

## What you'd need to ship to bridge each gap

This is the order-of-magnitude estimate. The substrate is solid; the rest is real implementation work, not architectural rework.

| Gap | Effort estimate | Notes |
|---|---|---|
| Wire an LLM into the autonomy heuristics | Days–weeks | The shape is right (data-emitting agents, approval gates around mutation, provenance trail). Replace the heuristic methods with prompts + structured output validators. |
| Real laser-physics module set (cross sections, photoionization, recombination) | Weeks–months | The registry slot exists; the science is the work. |
| GPU kernel for the rate-equation solver | Days–weeks | The C++ build pipeline is real; CUDA capability dump is real. The kernel is the work. |
| PIC / MHD / hydrodynamics solver | Months+ | These are full research codes; the workbench is a wrapper that needs them to exist. |
| Real paper interpretation (not template) | Weeks (LLM-driven) | Same shape as agent wiring — replace the template artifacts with LLM-generated drafts that still require human review per Plan §22. |
| Real solver suite for `cpp` / `fortran` / `kokkos` / `petsc` / `amrex` | Months+ each | Each backend lifecycle gate is gated; promoting them requires real benchmarks. |
| Production multi-user cut-over | Deployment-dependent | The secure-core scaffold is implemented through Layer 5. Remaining work is target-runtime verification, deployment composition, real identity provider integration, operational runbooks, and cut-over from the local single-user FastAPI workbench. |

---

## Maintenance protocol

This file is part of the durable repo memory. Treat it like `bugs_and_fixes/agent_error_patterns.md` — append-mostly, update the dated header at the top of every revision, and never quietly soften a limitation that was previously documented.

**Update on every:**

1. **Phase close.** When a phase status flips to "Complete" in `README.md`, the corresponding section here gets a real Capabilities + Limitations table. Same commit.
2. **Module promotion to `validated` or `trusted`.** Add the module to the "Validated physics modules" table. Same commit as the registry mutation.
3. **Backend promotion.** Update the Phase-8 backend table. Same commit.
4. **Audit fixes that change capability.** If a round-N audit finds something that was claimed-but-not-shipped (e.g. Phase 10 round-2 "smoke endpoint missing"), update the relevant row from "shipped" to "shipped 2026-MM-DD" or remove the false claim.
5. **Real LLM integration.** When the autonomy layer becomes LLM-backed, Phase 10's "agents are heuristics" section gets a major rewrite.

**Do not update on:**
- Routine bug fixes that don't change capability.
- Refactors that preserve the contract.
- Test additions that confirm an already-documented capability.

**Convention checker.** A `check_file_exists LIMITATIONS.md` assertion lives in `scripts/dev/check_repo_conventions.sh` so the file can't quietly disappear. The checker does NOT verify freshness of the dated header — that's the agent's responsibility on phase-close commits.

**Cross-references:**
- `bugs_and_fixes/bugfixes.md` — what actually broke and what was fixed.
- `bugs_and_fixes/agent_error_patterns.md` — recurring patterns to defend against.
- `program_development/timeline.md` — chronological log of phase work.
- `program_development/architectural_decisions/` — why the substrate looks the way it does.

This file is the **outward-facing** map: "what can a user do today, and what should they not believe the marketing about." The other files are **inward-facing**: how we got here and how we don't break what we shipped.
