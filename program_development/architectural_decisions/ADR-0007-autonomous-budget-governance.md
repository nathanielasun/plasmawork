# ADR-0007: Autonomous-Run Budget Governance

## Status
Accepted

## Date
2026-05-04

## Context

Plan §Phase 10 introduces autonomous loops: experiment design,
exploratory smoke runs, controlled sweeps, scientific review. Each
loop can in principle consume unbounded resources — a sweep agent
without a hard cap is just a fork bomb in disguise. The Phase 6/7/8/9
audits all caught a recurring pattern: client-controlled bypass kwargs
(`ignore_budget`, `unbounded`, `skip_approval`) that turned a
documented hard cap into a polite suggestion.

Plan §22 (Scientific Accuracy Policy) further requires that an
autonomous run with missing or fabricated coefficient data MUST land
as `exploratory`, not `validated`. The autonomy layer must encode
both invariants in code, with regression tests that fail if either
softens.

## Decision

1. **Hard budget caps live on the agent's constructor and the agent's
   call surfaces.** ``ControlledSweepAgent.budget`` is the ceiling.
   ``__init__`` and ``launch`` expose NO ``ignore_budget`` /
   ``unbounded`` / ``skip_budget`` / ``no_budget`` kwargs. A signature
   regression test in
   ``tests/integration/test_phase_10_gate_walk.py`` enforces the
   contract — adding a bypass kwarg breaks the test.

2. **Approval gates use single-use file tokens.** ``ApprovalGate``
   refuses by default. Tokens live under
   ``local_cache/autonomy_approvals/`` and are written by the
   ``grant_autonomy_approval`` helper, which is a CLI / human-in-the-
   loop tool. ``ApprovalGate.consume`` deletes the token on the way
   out — same call cannot be made twice. Tokens are action-scoped AND
   subject-scoped: a token for ``external_export`` on capsule A does
   NOT unlock ``destructive_edits`` or any action on capsule B.

3. **The HTTP API never reads `actor` or `role` from the request
   body.** Approval is server-side only, derived from the token file's
   existence. This carries the Phase-6 audit lesson "Trusting a
   client-supplied actor identity for a privileged check" forward into
   the autonomy surface.

4. **Plan §22 lives in code.** ``capsule_status_for_plan(plan)``
   returns ``"exploratory"`` whenever ``plan.placeholders`` is
   non-empty. The autonomous pipeline does NOT take a "promote anyway"
   shortcut; placeholder coefficients keep the capsule
   ``exploratory`` until a human reviewer signs off through the
   normal validation path.

5. **The autonomous pipeline is data-emission, not state-mutation.**
   ``ExperimentDesigner.design`` returns a Python object; it does not
   write to the filesystem. ``SmokeRunner.run`` returns a report;
   ``ControlledSweepAgent.launch`` returns the same ``SweepReport``
   every other Phase-9 caller sees. Only ``ScientificReviewer.write``
   touches disk, and only inside ``<capsule>/review/``. The Phase-6
   off-limits subtrees (``src/user_edits/``, ``paper_sources/``,
   ``provenance/``) are explicitly refused.

## Alternatives considered

- **Soft caps with override flag.** Rejected — every prior phase
  audit caught a soft-cap bypass kwarg in production. The contract has
  to be unforgeable.
- **Server-derived approval through bearer tokens / OAuth.**
  Rejected for the local workbench because the user runs the
  workbench themselves; a filesystem-backed token gives the same
  auditability without a network dependency. The same pattern can
  be promoted to a service in a follow-up phase.
- **Promote autonomous runs to `validated` when the agent is
  confident.** Rejected — agent self-grading on validation status is
  the failure mode plan §22 exists to prevent.

## Consequences

- **Positive:**
  - The autonomy layer cannot be invoked past its budget by any code
    path inside the workbench. Future phases inherit the contract.
  - Approval tokens are auditable (filesystem mtime, reviewer name).
  - Plan §22 has executable enforcement instead of prose.

- **Negative:**
  - Tests that exercise the autonomy layer must explicitly grant
    approval tokens; the alternative — a "test mode" flag that
    bypassed approval — was rejected as a regression risk.
  - Cross-language clients must script ``grant_autonomy_approval``
    out-of-band rather than passing an actor field; a small UX cost
    with a large safety win.

- **Neutral:**
  - The budget cap is per-agent. Workflows that compose multiple
    agents must reason about the total budget themselves; the
    workbench does not aggregate caps across agents.

## Implementation notes

- ``packages/core/src/simworkbench/autonomy/approval_gates.py``
  defines ``ApprovalGate``, ``ApprovalRequiredError``,
  ``grant_autonomy_approval``, and the ``KNOWN_ACTIONS`` set.
- ``configs/agents.yaml`` `human_approval_gates` block lists the
  same actions; the regression test
  ``tests/regression/test_approval_gates_enforcement.py::
  test_yaml_human_approval_gates_match_known_actions`` keeps the two
  in lockstep.
- ``ControlledSweepAgent.__init__`` clamps the spec's
  ``max_evaluations`` to ``min(spec.max_evaluations, agent.budget)``
  on every launch.
- ``capsule_status_for_plan`` is the single source of truth for the
  exploratory/validated decision; both the example and the regression
  test call it directly.
