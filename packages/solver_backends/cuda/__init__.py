"""Phase 8 / 8D — CUDA solver-backend adapter.

Phase 8 ships the adapter shape, capability detection, and a memory
estimator. The adapter does NOT auto-fall-back to CPU — that would
hide a missing GPU. Instead, ``detect_capability()`` returns a
structured ``GPUCapability`` and ``CUDABackend.is_available()``
exposes the result so callers can pick a different backend.

Determinism is hardware-dependent (atomic add ordering, cuBLAS
parameter choices). The capability dump carries an explicit warning
string; ADR-0006 documents the workbench policy.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class GPUCapability:
    """Result of a GPU capability probe."""

    available: bool
    device_count: int
    runtime_version: str
    notes: str


@dataclass(frozen=True)
class GPUMemoryEstimate:
    """Result of ``estimate_memory()`` for a given problem size."""

    state_bytes: int
    workspace_bytes: int
    total_bytes: int

    @property
    def total_megabytes(self) -> float:
        return self.total_bytes / (1024 * 1024)


def detect_capability() -> GPUCapability:
    """Probe for a CUDA runtime + visible devices.

    Returns ``available=False`` when CUDA isn't installed or no devices
    are visible. The probe never raises — capability detection is the
    happy path even on machines without GPUs.
    """
    try:  # cuda-python (pycuda / cupy / jax) is the runtime probe of
        # choice. We try cupy first because it's the most common in
        # scientific Python; the probe is pure import + count.
        import cupy  # type: ignore[import-untyped]

        n = int(cupy.cuda.runtime.getDeviceCount())
        return GPUCapability(
            available=n > 0,
            device_count=n,
            runtime_version=str(getattr(cupy, "__version__", "unknown")),
            notes="cupy.cuda probe",
        )
    except Exception:  # noqa: BLE001 — capability detection never raises
        return GPUCapability(
            available=False,
            device_count=0,
            runtime_version="",
            notes=(
                "CUDA runtime not detected (no cupy / pycuda / jax found). "
                "The cuda backend remains in registry but is_available() is False."
            ),
        )


def estimate_memory(
    *,
    grid_points: int,
    fields: int,
    dtype_bytes: int = 8,
    workspace_factor: float = 2.0,
) -> GPUMemoryEstimate:
    """Estimate GPU memory for a structured-grid PDE problem.

    Parameters
    ----------
    grid_points
        Total number of grid points (product of nx * ny * nz).
    fields
        Number of independent field components stored per grid point.
    dtype_bytes
        8 for float64, 4 for float32. Default float64.
    workspace_factor
        Solver workspace as a multiple of the state. Most explicit
        time-steppers need 2x state (current + next); implicit steppers
        can grow the factor. Default 2.0.
    """
    if grid_points <= 0 or fields <= 0:
        raise ValueError("grid_points and fields must be positive")
    state = int(grid_points) * int(fields) * int(dtype_bytes)
    workspace = int(state * workspace_factor)
    return GPUMemoryEstimate(
        state_bytes=state,
        workspace_bytes=workspace,
        total_bytes=state + workspace,
    )


class CUDAUnavailable(RuntimeError):
    """No CUDA runtime / device on the current machine."""


class CUDABackend:
    """Phase 8 CUDA adapter.

    The class exposes capability detection + memory estimation up
    front so callers can choose a different backend when CUDA isn't
    present. ``run`` is a Phase 8+ extension point — Phase 8 ships
    the contract (no auto-fallback), Phase 9+ wires real kernels.
    """

    name: str = "cuda"

    def __init__(self) -> None:
        self.capability = detect_capability()

    def is_available(self) -> bool:
        return bool(self.capability.available)

    def memory_estimate(
        self,
        *,
        grid_points: int,
        fields: int,
        dtype_bytes: int = 8,
    ) -> GPUMemoryEstimate:
        return estimate_memory(
            grid_points=grid_points,
            fields=fields,
            dtype_bytes=dtype_bytes,
        )

    def determinism_warning(self) -> str:
        return (
            "CUDA bitwise determinism is hardware-dependent. Atomic add "
            "ordering, cuBLAS algorithm choice, and CUDA version drift "
            "all change results within representable rounding. The "
            "workbench's policy is documented in "
            "program_development/architectural_decisions/"
            "ADR-0006-determinism-policy.md."
        )

    def run(self, *_args: object, **_kwargs: object) -> None:
        """Phase 8 ships the adapter shape; not the kernels."""
        raise CUDAUnavailable(
            "CUDABackend.run is a Phase 8 contract; kernel implementations "
            "land per-module in Phase 9+. Use is_available() and "
            "memory_estimate() in Phase 8."
        )


__all__ = [
    "CUDABackend",
    "CUDAUnavailable",
    "GPUCapability",
    "GPUMemoryEstimate",
    "detect_capability",
    "estimate_memory",
]
