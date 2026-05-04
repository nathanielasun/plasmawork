"""Phase 8 / 8B — ``numba_cpu`` solver backend.

Drop-in for ``python_cpu`` that JIT-compiles the right-hand side of
the 0D rate equation through Numba when available. When Numba is
missing the backend falls back to a plain NumPy implementation that
produces bit-identical results, so the backend is always runnable
(carries `agent_error_patterns.md` "Shipping the structured error
without shipping the success path" forward into Phase 8).

Both paths use the same ``scipy.integrate.solve_ivp`` integrator with
identical tolerances; only the right-hand side differs in
implementation. Cross-backend agreement vs. ``python_cpu`` is
verified in ``tests/integration/test_phase_8_gate_walk.py``.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
from scipy.integrate import solve_ivp

from simworkbench.experiment import Experiment

from .python_cpu import PythonCpuBackend, _RateState
from .seeds import SeedSet
from .solver_backend import BackendCapabilities, SolverBackend


def _build_rhs(rate_matrix: np.ndarray) -> tuple[Callable[..., np.ndarray], str]:
    """Return ``(rhs, kind)`` where ``kind`` is "numba" or "numpy"."""
    K = rate_matrix.copy()
    try:
        import numba  # type: ignore[import-untyped]

        @numba.njit(cache=True, fastmath=False)
        def _rhs(_t: float, n: np.ndarray) -> np.ndarray:
            return K @ n

        return _rhs, "numba"
    except Exception:  # noqa: BLE001 — any import failure → NumPy fallback
        def _rhs_numpy(_t: float, n: np.ndarray) -> np.ndarray:
            return K @ n

        return _rhs_numpy, "numpy"


class NumbaCpuBackend(SolverBackend):
    """0D rate-equation backend using a Numba-JITed RHS when available."""

    name: str = "numba_cpu"
    CAPABILITIES: BackendCapabilities = BackendCapabilities(
        domains=("species", "laser_species", "rate_equations", "phase_transition"),
        geometries=(0,),
        precisions=("float64",),
        deterministic=True,
        determinism_warning="",
    )

    def __init__(self) -> None:
        self._delegate = PythonCpuBackend()
        self._jit_kind: str = "uninitialized"

    def initialize(self, experiment: Experiment, seeds: SeedSet) -> _RateState:
        return self._delegate.initialize(experiment, seeds)

    def step(self, state: _RateState, dt: float) -> tuple[_RateState, dict[str, Any]]:
        if dt <= 0:
            return state, {
                name: float(n)
                for name, n in zip(state.species_names, state.densities, strict=True)
            }
        rhs, kind = _build_rhs(state.rate_matrix)
        self._jit_kind = kind
        sol = solve_ivp(
            rhs,
            t_span=(0.0, dt),
            y0=state.densities,
            method="LSODA",
            rtol=1e-8,
            atol=1e-12,
            dense_output=False,
        )
        if not sol.success:
            raise RuntimeError(f"solve_ivp failed: {sol.message}")
        new_densities = sol.y[:, -1].copy()
        new_state = _RateState(
            species_names=list(state.species_names),
            densities=new_densities,
            rate_matrix=state.rate_matrix.copy(),
            placeholders_used=list(state.placeholders_used),
            laser_intensity=state.laser_intensity,
        )
        samples = {
            name: float(n)
            for name, n in zip(state.species_names, new_densities, strict=True)
        }
        return new_state, samples

    def is_complete(self, state: _RateState) -> bool:  # noqa: ARG002
        return False

    def serialize_state(self, state: _RateState) -> Any:
        return self._delegate.serialize_state(state)

    def deserialize_state(self, payload: Any) -> _RateState:
        return self._delegate.deserialize_state(payload)


__all__ = ["NumbaCpuBackend"]
