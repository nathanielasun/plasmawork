# Equations

## Hamiltonian

For spins `s_i ∈ {-1, +1}` on a square lattice with periodic boundary
conditions:

    H = -J * sum_<i,j> s_i s_j  -  h * sum_i s_i

where `<i,j>` ranges over nearest-neighbor pairs. The reduced
temperature is `T* = k_B T / J` and the reduced field is `h* = h / J`.

## Metropolis update

For a randomly selected spin `s_i`:

1. Compute the proposed energy change `dE = 2 s_i * (neighbour_sum + h)`.
2. If `dE <= 0`: flip with probability 1.
3. Else: flip with probability `exp(-dE / T*)`.

## Onsager's exact `T_c`

For the 2D square-lattice Ising model in zero field:

    T_c* = 2 / ln(1 + sqrt(2)) ≈ 2.269185

`T* < T_c*` is the ferromagnetic phase (broken symmetry, |m| > 0).
`T* > T_c*` is the paramagnetic phase (|m| → 0 in the thermodynamic
limit).

## Observables

- **Energy per spin**: `E/N = <H> / N`.
- **Magnetization per spin**: `|m| = <|sum s_i|> / N`.
- **Heat capacity per spin**: `C/N = beta^2 * var(E) / N`.
- **Susceptibility per spin**: `chi/N = beta * var(M) / N`.

The implementation tracks `M` and `E` traces during the production
phase and reports time-averaged values plus variances.
