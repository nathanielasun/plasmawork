# Autonomous Experiment — Kr-like spec

End-to-end Phase 10 example. Runs the four-stage autonomy pipeline:

1. **Design** — `ExperimentDesigner.design(spec)` → `ExperimentPlan`.
   Includes an explicit minimum viable model, ordered fidelity ladder,
   coarse cost estimate, planned diagnostics, and a validation path.
2. **Bounded sweep** — `ControlledSweepAgent(budget=5)` sweeps a small
   parameter grid honoring the hard budget cap; emits a trend summary
   and next-sweep recommendation.
3. **Review** — `ScientificReviewer.write(capsule)` writes
   `<capsule>/review/scientific_review.md` covering assumption critique,
   missing physics, literature alignment, overclaim flags, and
   recommended validation.
4. **Capsule status** — Plan §22 forces `exploratory` (NOT `validated`)
   when any plan flag indicates a placeholder coefficient.

## Running

```bash
python examples/autonomous_experiment_kr/run_autonomous.py
# or with an explicit capsule name:
python examples/autonomous_experiment_kr/run_autonomous.py my_experiment
```

The capsule lands at
`simulation_capsules/<name>.lxp/`. The objective in this example is a
stand-in quadratic so the script runs without external rate-constant
data; a real workflow points the objective at the rate-equation
runner.

## Approval gates

Anything beyond data emission — promoting the resulting module to
`trusted`, exporting the capsule, running expensively-sized sweeps,
deleting files — requires an out-of-band approval token. Tokens are
single-use and action-scoped:

```python
from simworkbench.autonomy import grant_autonomy_approval

grant_autonomy_approval(
    action="external_export",
    subject="autonomous_experiment_kr_demo",
    reviewer="nathaniel",
)
```

The HTTP API never reads `actor` or `role` from the request body.
Approval is server-side only.
