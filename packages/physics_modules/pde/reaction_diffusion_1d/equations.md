# Equations

## PDE

    u_t = D u_xx - k u,    0 < x < L,    t > 0
    u(0, t) = u(L, t) = 0
    u(x, 0) = f(x)

## Discretization

Uniform grid `x_i = i * dx`, `i = 0, …, nx-1`, `nx = L/dx + 1`. The
interior nodes (i = 1, …, nx-2) are unknowns; boundary values are 0.

Crank-Nicolson, with `r = D dt / dx^2`:

    [ I + (r/2) A + (k dt / 2) I ] u^{n+1} =
    [ I - (r/2) A - (k dt / 2) I ] u^n

where `A` is the standard 2nd-order tridiagonal Laplacian with `-2`
on the diagonal and `1` on the off-diagonals. The LHS matrix is
solved with the Thomas algorithm.

## Closed-form benchmark

For `k = 0`, `f(x) = sin(pi x / L)`:

    u(x, t) = sin(pi x / L) * exp(-D pi^2 t / L^2)

The benchmark uses this single Fourier mode; the L2 relative error
between the numerical and analytic profiles at one diffusion time
must be < 1%.
