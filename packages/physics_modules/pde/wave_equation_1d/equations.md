# Equations

## PDE

    u_tt = c^2 u_xx,    0 < x < L,    t > 0
    u(0, t) = u(L, t) = 0
    u(x, 0) = f(x)
    u_t(x, 0) = g(x)

## Discretization

Uniform grid `x_i = i * dx` for `i = 0, …, nx-1`, with `nx = L/dx + 1`.
Time levels `t^n = n * dt`.

Explicit leapfrog + central differences:

    (u_i^{n+1} - 2 u_i^n + u_i^{n-1}) / dt^2
        = c^2 (u_{i+1}^n - 2 u_i^n + u_{i-1}^n) / dx^2

Solving for `u_i^{n+1}`:

    u_i^{n+1} = 2 u_i^n - u_i^{n-1} + r^2 * (u_{i+1}^n - 2 u_i^n + u_{i-1}^n)

with `r = c * dt / dx` (the CFL number).

## Stability

The scheme is stable iff `r <= 1`. The module raises `ValueError`
for `r > 1`.

## Closed-form benchmark

For the standing wave `f(x) = sin(pi x / L)`, `g(x) = 0`:

    u(x, t) = sin(pi x / L) * cos(c pi t / L)

with period `T = 2 L / c`. The benchmark integrates one period and
compares the L2 norm of the numerical solution against the analytic
profile.
