"""Phase 8 / 8C — Fortran kernel pathway (skeleton).

Phase 8 ships the directory + interface contract; a real Fortran
build (meson + gfortran) lands when a downstream module needs a
Fortran kernel. The skeleton mirrors the C++ pathway so the
extension story is uniform.

Public API:

  - ``FortranKernelsUnavailable`` — raised by ``load()`` until the
    Fortran build script runs.
  - ``load()`` — placeholder that always raises so callers learn the
    skeleton is not yet implemented (instead of getting a confusing
    ABI mismatch).
"""

from __future__ import annotations


class FortranKernelsUnavailable(RuntimeError):
    """The Fortran kernels pathway is a Phase-8 skeleton.

    A Fortran kernel binding lands when a downstream physics module
    needs one. Until then, calling ``load()`` raises this so callers
    can detect the unimplemented state explicitly.
    """


def load() -> None:
    raise FortranKernelsUnavailable(
        "Fortran kernel pathway is a Phase-8 skeleton. The interface "
        "(meson + gfortran build, ctypes ABI) mirrors the C++ pathway; "
        "implementations land per-module as needed."
    )


__all__ = ["FortranKernelsUnavailable", "load"]
