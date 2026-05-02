# ising_2d

2D Ising model with Metropolis single-spin-flip MC. Phase 1D `candidate` module.

Domain reduction is intentional: every quantity is dimensionless (in units of
the coupling $J$). This is the second-domain proof-of-concept per ADR-0001 —
demonstrates that the workbench abstractions handle a non-laser model.

## Equation

Hamiltonian: $H = -J \sum_{\langle i, j \rangle} s_i s_j - h \sum_i s_i$, with
$s_i \in \{-1, +1\}$.

Reduced units: $T^* = k_B T / J$, $h^* = h / J$. Onsager critical temperature:
$T_c^* = 2 / \ln(1 + \sqrt{2}) \approx 2.269$.

## Use

```python
from packages.physics_modules.phase_transition.ising_2d.src import simulate

result = simulate(lattice_size=16, temperature_reduced=2.0,
                  n_sweeps=2000, equilibration_sweeps=500, seed=0)
print(result["magnetization_per_spin"])      # near 1 below T_c
print(result["energy_per_spin"])
```

## Validity

Square lattice with periodic BCs. Single-spin-flip Metropolis. Slow near the
critical point — increase `n_sweeps` for L ≥ 16 to control autocorrelation.

## Status

`candidate` (Phase 1D). Generality proof per ADR-0001.
