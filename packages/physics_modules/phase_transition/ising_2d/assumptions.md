# Assumptions

The `ising_2d` MC module assumes:

1. **Square lattice with periodic BCs.** Each spin has exactly four
   nearest neighbors. Free boundaries or other lattice geometries
   require a different module.
2. **Single-spin-flip Metropolis dynamics.** No cluster updates.
   Autocorrelation diverges near `T_c`, so the user is responsible for
   choosing `n_sweeps` large enough for the regime they care about
   (or for exiting the critical region).
3. **Two-state spins (Ising).** `s = ±1`. Potts / continuous-spin
   variants are out of scope for this module.
4. **Reduced units throughout.** `T* = k_B T / J`, `E` per spin in
   units of `J`. The module returns plain floats; the caller maps
   reduced units back to physical units if needed.
5. **No external symmetry breaking** by default. The module accepts an
   optional `external_field`; absent that, magnetization sign is
   spontaneous below `T_c`.
