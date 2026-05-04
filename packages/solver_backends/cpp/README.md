# cpp — Phase 8 compiled-kernel pathway

CMake-based C++ build pipeline that compiles a shared library
(`libsimworkbench_kernels.{so,dylib}`) loaded through `ctypes`. The
reference kernel `axpy` is small enough to validate by hand
(`y[i] = a*x[i] + y[i]`) and large enough to exercise:

- the CMake build,
- the C++ → Python ABI wrapper,
- the ctypes loader,
- the test that compares the kernel against a NumPy reference.

## Build

```bash
bash scripts/build/kernels.sh
```

The output lands in `local_cache/build/cpp/`. Override the location
with `SIMWORKBENCH_CPP_BUILD_DIR=...`.

## Usage

```python
import numpy as np
from packages.solver_backends.cpp import axpy

x = np.array([1.0, 2.0, 3.0])
y = np.zeros_like(x)
axpy(2.0, x, y)
# y == [2.0, 4.0, 6.0]
```

## Determinism

The CMake build forbids `-ffast-math` and uses the standard `-O3`
optimization level only. Bitwise reproducibility is not guaranteed
across compilers / architectures but is preserved within one
compiler + platform combination.
