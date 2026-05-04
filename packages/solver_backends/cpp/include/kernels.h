// Phase 8 / 8C — C++ kernel ABI declarations.
//
// Kept tiny on purpose: the kernel here exists to validate the
// build pipeline + ctypes wrapper. Phase 9+ may add real kernels
// (rate-equation RHS, FDTD time-stepper, etc.). Symbols are extern
// "C" so the Python wrapper can resolve them by name.

#ifndef SIMWORKBENCH_KERNELS_H
#define SIMWORKBENCH_KERNELS_H

#include <cstddef>

#ifdef __cplusplus
extern "C" {
#endif

// y[i] = a * x[i] + y[i]  for i in [0, n)
// Returns 0 on success, non-zero on input validation failure.
int simworkbench_axpy(
    double a,
    const double* x,
    double* y,
    size_t n
);

// Probe symbol used by the Python wrapper to verify the .so/.dylib
// is the right ABI. Returns the ABI version (currently 1).
int simworkbench_kernels_abi_version(void);

#ifdef __cplusplus
}
#endif

#endif  // SIMWORKBENCH_KERNELS_H
