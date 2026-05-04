# PDE — 1D Linear Reaction-Diffusion (validated)

Phase 7 / 7D generality module. `u_t = D u_xx - k u` solved with Crank-
Nicolson on a uniform 1D grid with Dirichlet BCs. Crank-Nicolson is
unconditionally stable; the benchmark `pure_diffusion_decay` runs at
`k = 0` and exercises a Fourier-mode solution to within 1% L2 error.
