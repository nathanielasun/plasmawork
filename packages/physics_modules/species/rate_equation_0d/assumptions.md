# Assumptions

The `rate_equation_0d` module models species kinetics under these
assumptions:

1. **Spatial homogeneity (0D).** The species densities depend only on
   time. Spatial gradients require a transport-augmented module
   (Phase 8+).
2. **Mass-action kinetics.** `dn_i/dt = sum_j k_ij n_j n_k …` where the
   rate is proportional to the product of reactant densities. Phase 7
   validates the linear regime (1- and 2-participant interactions);
   higher-order kinetics (3-participant + ternary collisions) raise an
   explicit error rather than silently dropping.
3. **First-order rate constants.** Time-independent rate constants
   sourced from the spec. Time-dependent rates (e.g. pumped systems)
   require a coupled field module (Phase 7+).
4. **No saturation.** Rate constants are intensity-independent at this
   level; saturable transitions need a coupled field-population module.
5. **Placeholder discipline.** Every interaction whose coefficient is
   not pre-validated must declare a `placeholder:` source. The runtime
   refuses to silently fabricate rate constants.
6. **Backend choice.** Uses `scipy.integrate.solve_ivp(method='LSODA')`,
   which adapts between Adams (non-stiff) and BDF (stiff) automatically.
   Hand-rolled timestep loops are explicitly forbidden (plan §15.2).
