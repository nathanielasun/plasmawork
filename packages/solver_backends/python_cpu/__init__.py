"""Phase 8 / 8B — ``python_cpu`` solver-backend package.

The Phase-1 ``simworkbench.runtime.python_cpu.PythonCpuBackend`` is
the implementation. This package re-exports it under the formal
Phase-8 ``SolverBackend`` interface and registers it with the global
runtime registry on import. The Phase-8 promotion ratchet expects the
package directory to exist (rule 19: "plan-named module families are
enumerated exactly").
"""

from __future__ import annotations

from simworkbench.runtime.python_cpu import PythonCpuBackend
from simworkbench.runtime.runner import register_backend
from simworkbench.runtime.solver_backend import BackendCapabilities

# Phase 8 capability declaration. The Phase-1 backend already
# self-described informally; Phase 8A makes the capabilities a
# first-class attribute the registry can introspect without
# instantiating the backend.
PythonCpuBackend.CAPABILITIES = BackendCapabilities(  # type: ignore[attr-defined]
    domains=("species", "laser_species", "rate_equations", "phase_transition"),
    geometries=(0,),
    precisions=("float64",),
    deterministic=True,
    determinism_warning="",
)


_INSTANCE = PythonCpuBackend()
register_backend(_INSTANCE)


def get_backend() -> PythonCpuBackend:
    """Return the singleton ``PythonCpuBackend`` instance."""
    return _INSTANCE


__all__ = ["PythonCpuBackend", "get_backend"]
