"""Lambert-Beer closed-form transmission benchmark.

Plan §Phase 7 / 7B requires every validated laser-species module to
ship a benchmark that pins behaviour against an analytic / paper
reference. Lambert-Beer is exactly solvable, so the benchmark
compares the module's output to ``math.exp(-alpha * z)`` directly,
to machine precision.
"""

from __future__ import annotations

import math
from collections.abc import Iterable

from simworkbench.units import Q
from simworkbench.validation_library import PaperReproduction, ValidationReport

from ..src import LambertBeerAbsorber

# (alpha [1/m], z [m], expected T = exp(-alpha*z))
CASES: tuple[tuple[float, float], ...] = (
    (0.0, 1.0),       # No absorption — T = 1
    (1.0, 0.5),       # tau = 0.5
    (50.0, 0.02),     # tau = 1 — anchor at 1/e
    (10.0, 0.5),      # tau = 5
)


def run_benchmark() -> Iterable[ValidationReport]:
    """Yield a ``ValidationReport`` per case. Caller asserts ``passed``."""
    for alpha, z in CASES:
        absorber = LambertBeerAbsorber(
            incident_intensity=Q(1.0, "watt / meter ** 2"),
            absorption_coefficient=Q(alpha, "1 / meter"),
        )
        observed = absorber.transmission(Q(z, "meter"))
        expected = math.exp(-alpha * z)
        check = PaperReproduction(
            name=f"alpha={alpha}/m z={z}m",
            observed=lambda r, _o=observed: float(_o),
            expected=expected,
            tolerance_relative=1e-12,
            reference="Lambert-Beer closed form",
        )
        yield check.evaluate(None)


__all__ = ["CASES", "run_benchmark"]
