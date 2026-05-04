"""Phase 8 / 8B — ``numba_cpu`` solver-backend package.

The implementation lives at
``simworkbench.runtime.numba_cpu_backend.NumbaCpuBackend``. This
package re-exports it under the canonical
``packages/solver_backends/numba_cpu/`` location so the
plan-named family is enumerated on disk (rule 19: "plan-named module
families are enumerated exactly").

Importing the runtime package registers the backend automatically;
this module's only job is to provide a stable import path.
"""

from __future__ import annotations

from simworkbench.runtime.numba_cpu_backend import NumbaCpuBackend


def get_backend() -> NumbaCpuBackend:
    from simworkbench.runtime import get_backend as _get_backend

    backend = _get_backend("numba_cpu")
    assert isinstance(backend, NumbaCpuBackend)
    return backend


__all__ = ["NumbaCpuBackend", "get_backend"]
