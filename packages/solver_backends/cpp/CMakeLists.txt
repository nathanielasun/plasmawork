# Phase 8 / 8C — C++ kernel build pipeline.
#
# Builds a small shared library that the Python wrapper loads through
# ctypes. The reference kernel (``axpy``) computes y[i] = a*x[i] + y[i]
# for a 1D float64 array — small enough to validate by hand, real
# enough to exercise the build + ABI wrapper end-to-end.
#
# Phase 8 closes when ``scripts/build/kernels.sh`` produces this .so /
# .dylib and the Python tests load and call it.

cmake_minimum_required(VERSION 3.16)
project(simworkbench_cpp_kernels LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# The Python ctypes wrapper looks for libsimworkbench_kernels.{so,dylib}
# under ${CMAKE_BINARY_DIR}. Keep the symbol names stable in
# `include/kernels.h`.
add_library(simworkbench_kernels SHARED
    src/axpy.cpp
)

target_include_directories(simworkbench_kernels PUBLIC include)

# Determinism: -ffast-math is forbidden because it allows reordering
# that breaks bitwise reproducibility.
target_compile_options(simworkbench_kernels PRIVATE
    -O3
    -Wall
    -Wextra
    -fno-fast-math
)

# Don't decorate the symbol on macOS Clang.
set_target_properties(simworkbench_kernels PROPERTIES
    CXX_VISIBILITY_PRESET default
    VISIBILITY_INLINES_HIDDEN OFF
)
