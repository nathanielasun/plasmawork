# rate_equation_0d

0D rate-equation driver. Phase 1D `candidate` module.

Wraps `simworkbench.runtime.Runner` + the built-in `python_cpu` backend so
that callers can drive a 0D rate-equation `Experiment` with a single function
call and get back the full per-species trajectory.

## Use

```python
from simworkbench.experiment import Experiment, RunConfig
from simworkbench.model_spec import load_yaml
from packages.physics_modules.species.rate_equation_0d.src import simulate

spec = load_yaml("examples/simple_rate_equations/model.yaml")
exp = Experiment.from_model_spec(
    spec,
    run_config=RunConfig(start_time="0 s", end_time="100 ns", max_steps=100),
)
result = simulate(exp)
print(result.diagnostics["A"][-1])  # final A density
```

## Solver

`scipy.integrate.solve_ivp` with the `LSODA` method (stiff-friendly, automatic
method switching). Per `bugs_and_fixes/agent_error_patterns.md` "Replacing
validated solver calls with naive generated loops" — never hand-rolled.

## Validity

Spatially homogeneous (geometry.dimensionality == 0). First-order rate
constants only. Placeholder rate constants (flagged in
`Interaction.coefficient_sources`) cause the run to be marked `exploratory`.

## Status

`candidate` (Phase 1D).
