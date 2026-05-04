# Validity Domain

## Where this module applies

- **Optically thin or moderately thick media** with `alpha * z` up to ~10
  (transmission down to ~5e-5). Numerically stable beyond that, but
  diagnostics relying on transmitted intensity become noise-limited.
- **Linear regime intensities.** Intensity below the saturation
  intensity of the absorbing transition. For typical visible/IR
  electronic transitions this is far below the W/m^2 range.

## Where this module does NOT apply

- **Saturable absorbers.** When intensity approaches the saturation
  intensity, ground-state population depletion makes alpha
  intensity-dependent. Use a saturation-aware Phase 7+ module.
- **Inhomogeneous media.** If `alpha` varies along z, this module
  underestimates absorption near high-density regions. Discretize the
  path and chain multiple slabs, or use a dedicated transport solver.
- **Multi-wavelength sources.** Each wavelength has its own alpha; the
  caller must run the module per spectral channel and weight the
  result.
- **Highly scattering media.** Lambert-Beer ignores scattering; in a
  scattering medium, transmitted intensity is a function of geometry,
  not just path length.

## Numerical limits

- `alpha * z` in single-precision float: accurate to ~1e-7 relative for
  `alpha * z <= 10`.
- `path_length_for_transmission` requires `0 < T <= 1`; numerical
  underflow becomes the limit at `T < 1e-300`.
