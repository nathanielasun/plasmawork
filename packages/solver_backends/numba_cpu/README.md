# numba_cpu — Phase 8 validated CPU backend (Numba-accelerated)

Drop-in for `python_cpu` that JIT-compiles the right-hand side of the
0D rate equation through Numba when available. Falls back to a plain
NumPy implementation when Numba is missing.

## Capability

- Domains: species, laser_species, rate_equations, phase_transition
- Geometries: 0D
- Precision: float64
- Deterministic: yes — both NumPy and Numba paths use the same `scipy.integrate.solve_ivp(method="LSODA")` integrator with identical tolerances

## Validation

Cross-backend agreement: the Phase 8 gate-walk asserts `numba_cpu` and
`python_cpu` agree to within `1e-6` relative error on the canonical
2-species conversion experiment. The integrator is shared; only the
right-hand side differs.

## Usage

```python
from simworkbench.experiment import BackendConfig, Experiment, RunConfig
from simworkbench.runtime import Runner

experiment = Experiment.from_model_spec(
    spec, run_config=RunConfig(end_time="1 s", max_steps=20),
    backend_config=BackendConfig(name="numba_cpu"),
)
result = Runner(experiment, base_seed=0).run()
```
