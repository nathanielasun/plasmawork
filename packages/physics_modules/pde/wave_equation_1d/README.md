# PDE — 1D Linear Wave Equation (validated)

Phase 7 / 7D generality module. `u_tt = c^2 u_xx` solved with explicit
leapfrog + central differences on a uniform grid, Dirichlet BCs.
The benchmark `standing_wave_period` exercises a full period and
asserts L2 agreement with the closed-form solution to within 5%.
