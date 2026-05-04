// Phase 8 / 8C — axpy reference kernel.
//
// y[i] = a*x[i] + y[i]. Validates the build pipeline + ctypes ABI;
// the Python wrapper compares the result against a NumPy reference
// to bitwise tolerance.

#include "kernels.h"

extern "C" int simworkbench_axpy(
    double a,
    const double* x,
    double* y,
    size_t n
) {
    if (x == nullptr || y == nullptr) {
        return 1;
    }
    for (size_t i = 0; i < n; ++i) {
        y[i] = a * x[i] + y[i];
    }
    return 0;
}

extern "C" int simworkbench_kernels_abi_version(void) {
    return 1;
}
