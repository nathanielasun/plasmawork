"""Phase 7C particle-pusher interface — candidate.

Boris algorithm reference: dt < 0.1 / omega_c stability bound. Phase
7 ships the kinematic step (no collisions, no field self-consistency);
Phase 8 wires it into a PIC loop.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class ParticlePusherStep:
    """Single Boris step on a particle bundle.

    All arrays SI: positions in m, velocities in m/s, mass in kg,
    charge in C, fields in V/m and T.
    """

    mass_kg: np.ndarray  # shape (N,)
    charge_C: np.ndarray  # shape (N,)

    def step(
        self,
        positions: np.ndarray,
        velocities: np.ndarray,
        E: np.ndarray,
        B: np.ndarray,
        dt_seconds: float,
    ) -> tuple[np.ndarray, np.ndarray]:
        """Advance ``(x, v)`` by ``dt`` under sampled E and B.

        Parameters share leading shape ``(N, 3)`` with a 3-vector axis.
        Returns the new ``(x, v)`` pair.
        """
        if dt_seconds <= 0:
            raise ValueError("dt must be positive")
        m = self.mass_kg[:, None]
        q = self.charge_C[:, None]
        # Boris half-electric kick.
        v_minus = velocities + (q * E / m) * (dt_seconds / 2)
        # Magnetic rotation.
        t = (q * B / m) * (dt_seconds / 2)
        s = 2 * t / (1 + np.sum(t * t, axis=1, keepdims=True))
        v_prime = v_minus + np.cross(v_minus, t)
        v_plus = v_minus + np.cross(v_prime, s)
        # Final half-electric kick.
        v_new = v_plus + (q * E / m) * (dt_seconds / 2)
        x_new = positions + v_new * dt_seconds
        return x_new, v_new


__all__ = ["ParticlePusherStep"]
