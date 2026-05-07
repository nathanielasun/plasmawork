# Validity Domain

## Where this module applies (validated regime)

- **0D species kinetics** with up to 2 species per interaction.
- **Mass-action kinetics** with first-order rate constants.
- **Decay (1 reactant)**: `dN/dt = -k N`.
- **Conversion (A → B)**: `dN_A/dt = -k N_A`, `dN_B/dt = +k N_A`.
- **Optional laser intensity scaling**: rate proportional to laser
  intensity when a field participant is declared.

## Where this module does NOT apply

- **Higher-order kinetics** (3+ species per interaction). The runtime
  refuses these explicitly — declare a coupled multi-step interaction
  network or use a validated higher-order kinetics module/backend.
- **Inhomogeneous systems**. The 0D approximation breaks down when the
  characteristic transport time is comparable to or shorter than the
  reaction time. Use a 1D / PDE module.
- **Saturable transitions**. Linear rate constants miss saturation
  effects above the saturation intensity. Use a coupled field-
  population module.
- **Coupled radiation transport**. Outside the scope of a 0D rate
  solver — pair with `laser/absorption_lambert_beer` or a field
  module.

## Numerical tolerances

- LSODA `rtol=1e-8`, `atol=1e-12`. Adequate for densities spanning
  ~10 orders of magnitude (limited by atol vs the smallest density
  the user cares about).
- The `first_order_decay` benchmark passes to 1e-4 relative — the
  bottleneck is `max_steps` granularity, not the integrator.
