# lennard_jones

2D Lennard-Jones MD with Velocity Verlet. Phase 1D `candidate` module.

Bypasses the runner because MD's natural integration unit isn't a sample
output dt — it's a tiny solver dt. The module exposes its own driver and
reports diagnostics directly.

## Equation

LJ 12-6: $V(r) = 4 \epsilon \left[ \left(\dfrac{\sigma}{r}\right)^{12} - \left(\dfrac{\sigma}{r}\right)^{6} \right]$

Velocity Verlet: $r_{t+dt} = r_t + v_t dt + \dfrac{1}{2} a_t dt^2$, then
$v_{t+dt} = v_t + \dfrac{1}{2} (a_t + a_{t+dt}) dt$.

## Use

```python
import numpy as np
from simworkbench.units import Q
from packages.physics_modules.molecular_dynamics.lennard_jones.src import simulate

# Argon-like (epsilon ≈ 120 K * k_B, sigma ≈ 0.34 nm).
result = simulate(
    n_particles=64,
    box_size=Q("3.4 nm"),
    temperature=Q("100 K"),
    epsilon=Q(1.66e-21, "J"),
    sigma=Q("0.34 nm"),
    mass=Q("39.948 amu"),
    n_steps=1000,
    dt=Q("4 fs"),
    seed=0,
)
print(result["energy_drift_relative"])  # should be < 1e-3
```

## Validity

Classical, non-relativistic. Pairwise LJ only. Minimum-image PBC. Energy
drift < 0.1% over the test window (asserted by validation test).

## Status

`candidate` (Phase 1D). Generality proof for ADR-0001's "abstractions
support more than just laser-species".
