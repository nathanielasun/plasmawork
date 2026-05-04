"""Phase 7C electromagnetic-field interface — candidate.

Data structure + unit contract only. Numerical FDTD/FFT evolution lands
in Phase 8 with the HPC backends. The shape contract is what
upstream/downstream modules (PIC adapter, particle pusher) bind to.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pint
from simworkbench.units import Q, magnitude, require_dimensionality


@dataclass(frozen=True)
class ElectromagneticField:
    """E and B field samples on a structured Cartesian grid.

    The arrays are shape ``(nx, ny, nz, 3)`` with the trailing axis the
    vector component. 1D / 2D grids use unit-length axes. Units are
    SI: V/m for E, T for B.
    """

    domain_extent: pint.Quantity  # 3-vector of meters
    grid_resolution: pint.Quantity  # 3-vector of meters
    E: np.ndarray  # shape (nx, ny, nz, 3), V/m
    B: np.ndarray  # shape (nx, ny, nz, 3), T

    def __post_init__(self) -> None:
        require_dimensionality(self.domain_extent, "[length]")
        require_dimensionality(self.grid_resolution, "[length]")
        if self.E.shape != self.B.shape:
            raise ValueError(
                f"E and B shape mismatch: {self.E.shape} vs {self.B.shape}"
            )
        if self.E.shape[-1] != 3:
            raise ValueError(
                f"E/B must carry 3 vector components; got trailing axis "
                f"{self.E.shape[-1]}"
            )

    @property
    def grid_shape(self) -> tuple[int, int, int]:
        return tuple(self.E.shape[:3])  # type: ignore[return-value]

    @classmethod
    def zeros(
        cls,
        *,
        domain_extent: pint.Quantity,
        grid_resolution: pint.Quantity,
    ) -> ElectromagneticField:
        extent = np.asarray(magnitude(domain_extent, "meter"), dtype=np.float64)
        dx = np.asarray(magnitude(grid_resolution, "meter"), dtype=np.float64)
        if extent.size != 3 or dx.size != 3:
            raise ValueError(
                "domain_extent and grid_resolution must be 3-vectors"
            )
        nx, ny, nz = (
            max(1, int(round(extent[i] / dx[i])))
            for i in range(3)
        )
        E = np.zeros((nx, ny, nz, 3), dtype=np.float64)
        B = np.zeros((nx, ny, nz, 3), dtype=np.float64)
        return cls(
            domain_extent=Q(extent, "meter"),
            grid_resolution=Q(dx, "meter"),
            E=E,
            B=B,
        )


__all__ = ["ElectromagneticField"]
