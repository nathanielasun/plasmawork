#!/usr/bin/env bash
#
# scripts/build/kernels.sh
#
# Phase 8 / 8C — Build the workbench's compiled C++ kernels.
#
# Drives a CMake build from `packages/solver_backends/cpp/CMakeLists.txt`
# and places the resulting shared library under
# `local_cache/build/cpp/`. Outputs go into the local cache (gitignored)
# so a build never pollutes the source tree.
#
# Override the build directory with SIMWORKBENCH_CPP_BUILD_DIR.
#
# Usage:
#   bash scripts/build/kernels.sh           # build (default)
#   bash scripts/build/kernels.sh --clean   # remove the build dir
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"

SOURCE_DIR="$REPO_ROOT/packages/solver_backends/cpp"
BUILD_DIR="${SIMWORKBENCH_CPP_BUILD_DIR:-$REPO_ROOT/local_cache/build/cpp}"

if [[ "${1:-}" == "--clean" ]]; then
  echo "kernels.sh: removing $BUILD_DIR"
  rm -rf "$BUILD_DIR"
  exit 0
fi

mkdir -p "$BUILD_DIR"

if ! command -v cmake >/dev/null 2>&1; then
  echo "kernels.sh: cmake not found on PATH; install CMake (>=3.16) and re-run."
  exit 2
fi

echo "kernels.sh: configuring (source=$SOURCE_DIR, build=$BUILD_DIR)"
cmake -S "$SOURCE_DIR" -B "$BUILD_DIR" \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_LIBRARY_OUTPUT_DIRECTORY="$BUILD_DIR" \
      -DCMAKE_RUNTIME_OUTPUT_DIRECTORY="$BUILD_DIR" \
      -DCMAKE_ARCHIVE_OUTPUT_DIRECTORY="$BUILD_DIR"

echo "kernels.sh: building"
cmake --build "$BUILD_DIR" --config Release

echo "kernels.sh: artifact(s):"
ls "$BUILD_DIR" | grep -E "libsimworkbench_kernels" || true
