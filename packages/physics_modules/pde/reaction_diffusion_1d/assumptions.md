# Assumptions

1. **Linear reaction-diffusion** `u_t = D u_xx - k u`. No nonlinear
   reaction terms (no `u^2`, no `u (1-u)`, etc.). Nonlinear models
   need an explicit / IMEX scheme, out of scope here.
2. **Uniform 1D grid** with constant `dx`.
3. **Dirichlet BCs** `u(0,t) = u(L,t) = 0`.
4. **Crank-Nicolson scheme.** Unconditionally stable, but accuracy
   degrades when `dt` is much larger than the diffusive timescale
   `dx^2 / D`.
5. **Constant coefficients.** `D` and `k` are scalars; spatial /
   temporal variation is out of scope.
