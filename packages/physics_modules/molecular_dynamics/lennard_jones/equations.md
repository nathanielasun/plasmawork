# Equations

## Lennard-Jones 12-6 potential

For two particles separated by distance `r`:

    V(r) = 4 * epsilon * ((sigma / r)^12 - (sigma / r)^6)

The pair force on particle `i` from particle `j` is

    F_ij = -dV/dr * r_ij / r
         = 24 * epsilon * (2 * (sigma/r)^12 - (sigma/r)^6) / r^2 * r_ij

with the minimum-image convention applied to `r_ij` for periodic
boundaries.

## Velocity-Verlet integrator

For each particle at step `n`:

    x[n+1] = x[n] + v[n] * dt + 0.5 * a[n] * dt^2
    a[n+1] = F(x[n+1]) / m
    v[n+1] = v[n] + 0.5 * (a[n] + a[n+1]) * dt

Velocity-Verlet is symplectic and 2nd-order accurate in `dt`. Total
energy `E = sum 0.5 m v^2 + sum_{pairs} V(r)` should be conserved
within rounding + integration error over the run.

## Reduced units

Internally the integrator operates in LJ-reduced units to avoid
floating-point loss:

- length: `sigma`
- energy: `epsilon`
- mass: particle mass `m`
- time: `tau = sigma * sqrt(m / epsilon)`
- temperature: `T* = k_B T / epsilon`

The public API takes and returns SI-unit quantities; conversion
happens at the boundary.
