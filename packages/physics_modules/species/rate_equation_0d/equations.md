# Equations

## State vector and rate matrix

For `n` species, the state is

    N = [N_1, N_2, …, N_n]^T   (1/m^3)

and the rate equations are written as a linear matrix-vector product:

    dN/dt = K @ N

where `K[i, j]` is the rate at which species `j` produces (positive)
or depletes (negative on the diagonal) species `i`.

## First-order decay

A single-participant interaction (`participants=[A]`) with rate
constant `k` contributes

    K[A, A] -= k

so `dN_A/dt = -k N_A` ⇒ `N_A(t) = N_A(0) * exp(-k t)`.

## Two-species conversion (A → B)

A two-participant interaction (`participants=[A, B]`) with rate `k`
contributes

    K[A, A] -= k
    K[B, A] += k

so `dN_A/dt = -k N_A`, `dN_B/dt = +k N_A`. Total `N_A + N_B` is
conserved exactly (the diagonals cancel). The benchmark
`two_species_conversion` verifies this invariant.

## Laser-intensity coupling (placeholder)

If the interaction declares a non-species participant whose name
matches a laser field, the backend scales `k` by the laser intensity
relative to a 1e10 W/m^2 reference:

    rate = base_rate * (I_laser / 1e10)

This is a Phase-7 placeholder; a proper photoionization rate awaits
the Phase-7+ cross-section module.

## Numerical scheme

`scipy.integrate.solve_ivp(method='LSODA', rtol=1e-8, atol=1e-12)`.
LSODA switches automatically between Adams (non-stiff) and BDF (stiff)
methods; no hand-rolled timestep loop.
