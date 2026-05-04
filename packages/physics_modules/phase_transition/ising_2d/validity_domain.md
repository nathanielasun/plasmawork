# Validity Domain

## Where this module applies

- **Reduced temperatures** `T* > 0`. The benchmarks pin behaviour at
  `T* = 1.0` (deep ferromagnetic) and `T* = 4.0` (deep paramagnetic).
- **Lattice sizes** `L >= 4`. Smaller lattices are dominated by finite-
  size corrections that distort the phase transition.
- **Sweep counts** large enough for the regime: a few hundred for
  `T* < 1.5` or `T* > 3.0`, several thousand near `T_c ≈ 2.269`.

## Where this module does NOT apply

- **Critical region (T* ≈ 2.269)** with insufficient sampling. Single-
  spin-flip Metropolis is critically slowed; use cluster algorithms
  (Wolff, Swendsen-Wang) for high-precision critical exponents. Phase
  7+ may add a Wolff variant.
- **Other lattice geometries.** Triangular, honeycomb, hexagonal lattices
  have different `T_c` and critical exponents.
- **Quantum effects.** Pure classical MC; no transverse-field Ising.

## Numerical tolerances

- The benchmarks use generous tolerances (|m| > 0.95 deep below T_c;
  |m| < 0.2 deep above T_c) so finite-N statistical fluctuations stay
  within bounds at L=8 with 1000 sweeps.
