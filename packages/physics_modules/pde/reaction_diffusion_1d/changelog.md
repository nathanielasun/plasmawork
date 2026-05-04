# Changelog

## 0.1.0 — 2026-05-03 — Phase 7 / 7D

- Initial release. Status: `validated`.
- Crank-Nicolson scheme for `u_t = D u_xx - k u`, Dirichlet BCs.
- Benchmark `pure_diffusion_decay` exercises a sin Fourier mode at
  `k = 0` to within 1% L2 relative error after one diffusion time.
