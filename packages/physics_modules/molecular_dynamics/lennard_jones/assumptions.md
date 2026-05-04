# Assumptions

The `lennard_jones` MD module assumes:

1. **Classical, non-relativistic dynamics.** The Velocity-Verlet
   integrator uses Newton's equations directly. Quantum effects (de
   Broglie wavelength comparable to interparticle distance) are
   ignored.
2. **Pairwise LJ 12-6 potential only.**
   `V(r) = 4 * eps * ((sigma/r)^12 - (sigma/r)^6)`.
   No three-body terms, no long-range corrections beyond
   minimum-image truncation.
3. **2D geometry.** Particles live in a square box; positions are
   2-vectors. The 3D extension uses the same kernel with a 3-component
   vector axis but is not exposed in this module.
4. **Periodic boundaries with minimum image.** Pair distances use
   `r - L * round(r / L)` per axis. The cutoff is implicit in the
   minimum-image convention; no explicit pair-list neighbour cutoff.
5. **Microcanonical ensemble.** No thermostat / barostat; total
   energy should be conserved by the Verlet integrator.
6. **dt is short enough.** `dt_reduced = dt / tau_LJ` should be small
   compared to the inverse of the highest LJ frequency. The benchmark
   uses `dt_reduced = 0.005` which keeps energy drift below 1% over
   200 steps.
