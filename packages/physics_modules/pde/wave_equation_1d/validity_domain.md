# Validity Domain

## Where this module applies

- **Linear wave propagation** in 1D with Dirichlet boundaries — fixed
  ends, like a string clamped at both edges.
- **CFL ratio** `r = c * dt / dx` between 0 and 1. Optimal `r = 0.9` for
  the validated benchmark; smaller `r` is fine but slower; `r = 1`
  hits the stability boundary.
- **Smooth initial conditions** (sin / cosine / Gaussian profiles).
  Discontinuous initial data produces ringing and benchmark
  agreement may degrade.

## Where this module does NOT apply

- **Periodic, Neumann, or radiating boundaries.** Not implemented.
- **Nonlinear waves** (KdV, Burgers, etc.).
- **Multi-dimensional** waves — the 2D / 3D extension uses the same
  kernel idea but is not exposed.
- **Wave speeds varying in space**. `c` is a single scalar.

## Numerical tolerances

- The benchmark asserts < 5% L2 relative error after one full period
  on a 51-point grid with `r = 0.9`. Tighter tolerance requires a
  finer grid + smaller `dt`.
