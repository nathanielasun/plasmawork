# Assumptions

This module assumes:

1. **Homogeneous medium.** The absorption coefficient `alpha` is constant
   along the path. Spatial variation requires either solving the
   inhomogeneous integral form or chaining multiple Lambert-Beer slabs.
2. **Linear absorption.** `dI/dz = -alpha * I` holds. There is no
   saturation, no two-photon absorption, no nonlinear terms.
3. **Single wavelength.** `alpha` is a wavelength-resolved coefficient
   evaluated at the incident wavelength; no dispersion or wavelength
   averaging.
4. **Steady state.** No time-dependence in the absorption coefficient.
   Pulsed-light scenarios still apply if `alpha` is treated as a
   time-frozen value at the pulse's center wavelength.
5. **Non-negative inputs.** `I0 >= 0`, `alpha >= 0`, `z >= 0`. The
   constructor raises `ValueError` on negative inputs.

If any assumption fails, switch to a saturation-aware module (Phase 7+
addition), a multi-slab integrator, or a wavelength-resolved transport
solver.
