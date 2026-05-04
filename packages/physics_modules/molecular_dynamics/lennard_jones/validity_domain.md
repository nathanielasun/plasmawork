# Validity Domain

## Where this module applies

- **Reduced temperatures** in the LJ liquid/gas range
  (`T* = k_B T / eps` between ~0.5 and ~3).
- **Reduced densities** below close-pack
  (`rho* = N sigma^2 / L^2` < ~0.9 in 2D).
- **Small particle counts** (N <= ~64) — the kernel is `O(N^2)` per
  step. Phase 8 brings neighbor-list and vectorized pair-force kernels.
- **Microcanonical (NVE) runs** of bounded duration. The benchmark
  enforces total-energy drift < 1% over 200 steps.

## Where this module does NOT apply

- **Crystal phase** (`T* < ~0.4` and high density). The Verlet step
  size needs to shrink with the increasing oscillation frequency near
  equilibrium positions; the default `dt_reduced=0.005` may not be
  short enough.
- **Long-range physics**. Truncated LJ misses the corrections that
  matter for thermodynamic properties (pressure, surface tension).
- **Constant-T or constant-P ensembles**. NVT / NPT need a thermostat
  or barostat; this module is NVE.
- **3D systems** — the kernel is 2D-only by design.

## Numerical tolerances

- Verlet integrator: 2nd-order in `dt`; 4th-order in energy with the
  symplectic property.
- Energy drift benchmark: 1% relative over 200 steps at `dt* = 0.005`,
  `T* = 1.2`. Tighter tolerances require a smaller `dt`.
