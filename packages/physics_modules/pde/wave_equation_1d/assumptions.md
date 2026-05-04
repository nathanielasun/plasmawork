# Assumptions

1. **Linear wave equation** `u_tt = c^2 u_xx`. No nonlinear advection,
   no dispersion, no dissipation, no source terms.
2. **Uniform 1D grid.** `dx` constant; positions `x_i = i * dx`.
3. **Dirichlet BCs** `u(0,t) = u(L,t) = 0`. Periodic / Neumann BCs
   require a different module.
4. **Explicit leapfrog** scheme, second-order in space and time.
5. **CFL bound** `c * dt / dx <= 1` for stability. Above the bound the
   scheme blows up. The module raises `ValueError` if the user
   supplies a violating combination.
6. **Initial condition.** `u(x, 0)` and optionally `u_t(x, 0)`. A
   missing velocity is treated as zero.
