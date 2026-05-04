# ADR-0006: Determinism Policy for Solver Backends

## Status
Accepted

## Date
2026-05-04

## Context

Plan §Phase 8 introduces multiple solver backends (CPU NumPy/SciPy,
Numba-JIT CPU, compiled C++/Fortran kernels, GPU/CUDA, HPC adapters).
Each carries different determinism guarantees:

- **CPU + scipy LSODA + fixed seeds**: bitwise reproducible across
  identical Python + NumPy + SciPy versions on the same architecture.
  This is the workbench's reference standard.
- **Numba-JIT**: bitwise reproducible when the JIT cache + LLVM
  version + NumPy version are identical.
- **C++ / Fortran kernels (`-O3`, no `-ffast-math`)**: bitwise
  reproducible per (compiler, version, architecture) tuple.
- **GPU / CUDA**: bitwise reproducibility is not promised. Atomic add
  ordering, cuBLAS algorithm choice, and CUDA driver / runtime drift
  all introduce variation within representable rounding.
- **External PIC codes** (Phase 8 / 8F): determinism depends on the
  external simulator; the workbench records the simulator's claim
  but does not enforce it.

The `provenance.lock` schema must declare a determinism flag per run
so reviewers reading the capsule know whether bitwise comparisons
across runs are valid. The Phase-7 audit lesson (rule 16,
"Cross-cutting always-on prose has a regression test") applies here:
the determinism flag is read from the registered backend's
``CAPABILITIES.deterministic`` field, NOT free-text claimed by the
caller.

## Decision

1. **Each backend declares its determinism class** as a structured
   capability in ``BackendCapabilities.deterministic`` plus
   ``determinism_warning``. Three classes:

   - ``deterministic=True, warning=""`` — bitwise reproducible across
     runs on the same machine + library versions. Default for the
     CPU backends.
   - ``deterministic=False, warning="..."`` — results are not bitwise
     reproducible across runs. The warning string explains the source
     (atomic add ordering, BLAS algorithm choice, etc.) and is
     surfaced to the user.

2. **The runtime stamps `provenance.lock` with the backend's
   determinism class on every save.** The capsule writer (Phase 2B
   ``ProvenanceLock``) gains a ``determinism`` field whose value is
   read from ``backend.CAPABILITIES.deterministic`` at save time —
   not from a user-supplied claim.

3. **Cross-backend comparison tolerance**:
   - Two ``deterministic=True`` backends agree to floating-point
     precision: ``rtol = 1e-12`` for shared kernels.
   - Mixing a ``True`` and ``False`` backend allows looser tolerance:
     ``rtol = 1e-3`` is the default, configurable per cross-solver
     comparison.
   - Two ``False`` backends require explicit user-set tolerance; no
     default is provided.

4. **GPU and external-PIC paths must surface the warning at run-
   submission time**, not after the fact. The orchestrator (Phase 8E)
   reads the backend's capability dump and includes the warning in
   the run's pre-flight log so the user opts in deliberately.

5. **`-ffast-math` is forbidden** in all compiled-kernel build flags
   (CMake + meson). Reordering / contraction breaks reproducibility
   even for nominally-deterministic backends. The Phase-8 CMake
   sets ``-fno-fast-math`` explicitly.

## Alternatives considered

- **Single global determinism flag.** Rejected — different backends
  have different guarantees, and a single flag forces one of them
  (usually GPU) to silently degrade its claim.
- **Bit-perfect across backends.** Rejected — would require pinning
  one BLAS / one LSODA implementation across backends, which kills
  performance on GPU and external simulators.
- **Skip the determinism field in `provenance.lock`.** Rejected —
  the field is the source of truth a reviewer reads when comparing
  two runs. Without it the comparison is unreliable.

## Consequences

- **Positive**:
  - The capsule's `provenance.lock` carries explicit determinism
    metadata; cross-run comparisons can be run-validated automatically.
  - Each backend declares its class once; the runtime stamps the
    capsule from the live capability dump (no duplicated string
    field).
  - GPU / external-PIC users see the determinism warning at submission
    rather than discovering it post hoc.

- **Negative**:
  - Cross-backend comparison tolerances grow conditionally; tests
    that mix CPU and GPU need to declare the looser tolerance
    explicitly.
  - The `provenance.lock` schema gained a new field; the Phase-2A
    capsule format-version remains `0.1` because the field defaults
    to True (CPU baseline) for older capsules without it.

- **Neutral**:
  - Build scripts gain `-fno-fast-math` flags; no measurable
    performance regression on the reference axpy kernel.

## Implementation notes

- Phase 8 / 8A: ``BackendCapabilities`` carries ``deterministic`` +
  ``determinism_warning`` fields.
- Phase 8 / 8D: ``CUDABackend.determinism_warning()`` returns the
  documented warning; the registry's metadata declares
  ``determinism: false``.
- Phase 8 close: ``provenance.lock`` writer reads
  ``backend.CAPABILITIES.deterministic`` and stamps the field. A
  regression test (`tests/regression/test_determinism_marker.py`)
  asserts the field round-trips for the python_cpu + numba_cpu
  paths.
- Phase 9+: Cross-backend comparison helpers in
  ``simworkbench.validation_library`` accept a ``tolerance_relative``
  override that defaults to the policy in this ADR (1e-12 for two
  deterministic backends, 1e-3 mixed).
