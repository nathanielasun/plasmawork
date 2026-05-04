# fortran — Phase 8 Fortran kernel pathway (skeleton)

Phase 8 ships the directory + interface contract; a validated Fortran
build (meson + gfortran) lands when a downstream physics module needs
a Fortran kernel. Until then, calling `load()` raises
`FortranKernelsUnavailable` so consumers detect the unimplemented
state explicitly.

The interface mirrors the C++ pathway so the extension story is
uniform: a Fortran source under `src/`, a meson build script that
produces a shared library, a `ctypes` wrapper that loads it.
