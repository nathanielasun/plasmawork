# Validity Domain

## Where this module applies

- **Linear** reaction-diffusion in 1D with Dirichlet BCs.
- **Smooth initial conditions** — Fourier modes, Gaussians, smooth
  pulses. Discontinuous data converges in L2 but pointwise error
  near the discontinuity decays slowly.
- **Time scales** comparable to the diffusion time `L^2 / D`. Long
  runs (`t >> L^2/D`) decay to zero; the benchmark uses one
  diffusion time at the dominant Fourier-mode level.

## Where this module does NOT apply

- **Nonlinear reaction terms** (Fisher-KPP, Allen-Cahn, etc.).
- **Spatially varying** D or k.
- **Periodic / Neumann** boundaries.
- **Multi-dimensional** problems.

## Numerical tolerances

- Benchmark passes to 1% L2 relative error after one diffusion time
  on a 51-point grid with `dt = 0.01 * L^2 / D`.
