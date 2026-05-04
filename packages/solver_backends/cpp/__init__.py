"""Phase 8 / 8C — C++ kernel pathway.

Loads the shared library produced by ``scripts/build/kernels.sh`` via
``ctypes`` and exposes the kernels as Python callables. The library
file lives under ``<repo>/local_cache/build/cpp/`` (the build script
puts it there to keep build outputs out of the source tree).

Public API:

  - ``axpy(a, x, y) -> y``  — y[i] = a*x[i] + y[i] computed in C++.
  - ``abi_version() -> int`` — sanity-probe used by the test suite.
  - ``CppKernelsUnavailable`` — raised when the library isn't built.

The Python wrapper does NOT auto-build. Callers run
``scripts/build/kernels.sh`` once and the ctypes load picks up the
artifact. This separation matches plan §15.4 ("compiled-kernel
pathways are an opt-in build step").
"""

from __future__ import annotations

import ctypes
import functools
import os
import platform
from collections.abc import Sequence
from pathlib import Path

import numpy as np
from simworkbench.paths import local_cache_root


class CppKernelsUnavailable(RuntimeError):
    """The C++ kernels shared library is not present.

    Build it once with ``bash scripts/build/kernels.sh`` and reload.
    """


_LIB_BASENAME = "libsimworkbench_kernels"
_BUILD_DIR_ENV = "SIMWORKBENCH_CPP_BUILD_DIR"


def _expected_extension() -> str:
    system = platform.system()
    if system == "Darwin":
        return ".dylib"
    if system == "Windows":
        return ".dll"
    return ".so"


def _candidate_paths() -> Sequence[Path]:
    overrides: list[Path] = []
    env = os.environ.get(_BUILD_DIR_ENV)
    if env:
        overrides.append(Path(env))
    # Default canonical build dir.
    overrides.append(local_cache_root() / "build" / "cpp")
    ext = _expected_extension()
    fnames = [_LIB_BASENAME + ext]
    paths: list[Path] = []
    for d in overrides:
        for fname in fnames:
            paths.append(d / fname)
    return paths


def _resolve_lib_path() -> Path:
    for candidate in _candidate_paths():
        if candidate.is_file():
            return candidate
    raise CppKernelsUnavailable(
        "C++ kernels library not found. Build it with "
        "`bash scripts/build/kernels.sh`. Searched: "
        + ", ".join(str(p) for p in _candidate_paths())
    )


@functools.lru_cache(maxsize=1)
def _load() -> ctypes.CDLL:
    """Load the kernels library once per process.

    Uses ``functools.lru_cache(maxsize=1)`` per AGENTS.md "Cached
    singletons use ``@functools.lru_cache(maxsize=1)`` on a factory
    function, not ``global`` declarations on module-level mutable
    state."
    """
    path = _resolve_lib_path()
    lib = ctypes.CDLL(str(path))
    # Bind the ABI signatures.
    lib.simworkbench_axpy.restype = ctypes.c_int
    lib.simworkbench_axpy.argtypes = [
        ctypes.c_double,
        ctypes.POINTER(ctypes.c_double),
        ctypes.POINTER(ctypes.c_double),
        ctypes.c_size_t,
    ]
    lib.simworkbench_kernels_abi_version.restype = ctypes.c_int
    lib.simworkbench_kernels_abi_version.argtypes = []
    _LIB = lib
    return lib


def abi_version() -> int:
    """Return the ABI version of the loaded library."""
    return int(_load().simworkbench_kernels_abi_version())


def axpy(a: float, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """y[i] = a * x[i] + y[i] computed in C++. Mutates ``y`` in place
    and returns it.
    """
    if x.shape != y.shape:
        raise ValueError(f"x and y shape mismatch: {x.shape} vs {y.shape}")
    if x.dtype != np.float64 or y.dtype != np.float64:
        raise TypeError(
            f"x and y must be float64; got {x.dtype} / {y.dtype}"
        )
    x = np.ascontiguousarray(x)
    y = np.ascontiguousarray(y)
    rc = _load().simworkbench_axpy(
        ctypes.c_double(float(a)),
        x.ctypes.data_as(ctypes.POINTER(ctypes.c_double)),
        y.ctypes.data_as(ctypes.POINTER(ctypes.c_double)),
        ctypes.c_size_t(int(x.size)),
    )
    if rc != 0:
        raise RuntimeError(f"simworkbench_axpy returned {rc}")
    return y


__all__ = [
    "CppKernelsUnavailable",
    "abi_version",
    "axpy",
]
