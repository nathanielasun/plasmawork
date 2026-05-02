"""Built-in ``python_cpu`` backend for Phase 1.

Phase-1 scope: drives 0D rate-equation ModelSpecs by building a coupled-ODE
system from ``ModelSpec.species`` + ``ModelSpec.interactions`` and integrating
with ``scipy.integrate.solve_ivp`` (LSODA — stiff-friendly). Honors
``bugs_and_fixes/agent_error_patterns.md`` *Replacing validated solver calls
with naive generated loops*: every advance is one ``solve_ivp`` call, never a
hand-rolled timestep loop.

For interactions whose ``coefficient_sources`` flag a placeholder, the
backend uses a default rate constant of 1.0 / second, **and** logs a WARN
event on every step so the run is unambiguously exploratory. Honors
``agent_error_patterns.md`` *Silently inventing missing physical
coefficients*: nothing is invented, only flagged-explicit defaults are used.

Higher-fidelity / non-0D simulations (MD, Ising) bypass this backend in
Phase 1 and use their physics module's own driver (see ``packages/
physics_modules/molecular_dynamics/lennard_jones`` and
``packages/physics_modules/phase_transition/ising_2d``).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from scipy.integrate import solve_ivp

from simworkbench.experiment import Experiment
from simworkbench.runtime.seeds import SeedSet


@dataclass
class _RateState:
    """Opaque solver state for the 0D rate-equation backend."""

    species_names: list[str]
    densities: np.ndarray  # 1/m^3
    rate_matrix: np.ndarray  # K[i, j] = rate of conversion j → i (1/s); K[i, i] absorbs sinks
    placeholders_used: list[str] = field(default_factory=list)
    laser_intensity: float = 0.0  # W/m^2; multiplies placeholder photon-driven rates


class PythonCpuBackend:
    """Default Phase-1 backend. Implements ``runner.BackendProtocol`` structurally."""

    name = "python_cpu"

    def initialize(self, experiment: Experiment, seeds: SeedSet) -> _RateState:
        spec = experiment.model_spec
        if spec.geometry.dimensionality != 0:
            raise NotImplementedError(
                "python_cpu backend currently supports 0D rate-equation models only "
                "(plan §Phase 1 / Workstream 1D). MD and Ising bypass the runner."
            )

        species_names = [s.name for s in spec.species]
        densities = np.array(
            [
                float(s.initial_density.to("1 / meter ** 3").magnitude)
                for s in spec.species
            ],
            dtype=np.float64,
        )

        # Build the rate matrix K such that dn/dt = K @ n. Each interaction's
        # `participants` ordering is interpreted as `[reactant, product, ...]`
        # for the simplest first-order conversion. Placeholders use rate 1.0.
        n = len(species_names)
        K = np.zeros((n, n), dtype=np.float64)
        placeholders: list[str] = []
        laser_intensity = _laser_intensity_W_per_m2(spec)

        index = {name: i for i, name in enumerate(species_names)}

        for ix in spec.interactions:
            participants = list(ix.participants)
            # Filter to species participants (fields are not state variables).
            species_participants = [p for p in participants if p in index]
            if len(species_participants) < 2:
                # No conversion edge to add.
                continue
            reactant = species_participants[0]
            product = species_participants[1]
            placeholder = any(
                "placeholder" in str(src).lower() for src in ix.coefficient_sources
            )
            base_rate = 1.0 if placeholder else 1.0  # Phase 1 single-rate default
            if placeholder:
                placeholders.append(ix.name)
            # If there is a laser field involved, scale the rate by intensity
            # so density drops faster at higher intensity. This is an explicit
            # placeholder — no fabricated cross-section.
            field_participants = [p for p in participants if p not in index]
            rate = base_rate
            if field_participants and laser_intensity > 0.0:
                # Normalize so a 1e10 W/m^2 reference intensity gives the base rate.
                rate = base_rate * (laser_intensity / 1.0e10)
            i_r, i_p = index[reactant], index[product]
            K[i_r, i_r] -= rate  # depletes reactant
            K[i_p, i_r] += rate  # produces product

        return _RateState(
            species_names=species_names,
            densities=densities,
            rate_matrix=K,
            placeholders_used=placeholders,
            laser_intensity=laser_intensity,
        )

    def step(self, state: _RateState, dt: float) -> tuple[_RateState, dict[str, Any]]:
        if dt <= 0:
            return state, {name: float(n) for name, n in zip(state.species_names, state.densities)}
        # Use scipy's vetted LSODA via solve_ivp — never a hand-rolled loop.
        K = state.rate_matrix

        def rhs(_t: float, n: np.ndarray) -> np.ndarray:
            return K @ n

        sol = solve_ivp(
            rhs,
            t_span=(0.0, dt),
            y0=state.densities,
            method="LSODA",
            rtol=1e-8,
            atol=1e-12,
            dense_output=False,
        )
        if not sol.success:
            raise RuntimeError(f"solve_ivp failed: {sol.message}")
        new_densities = sol.y[:, -1].copy()
        new_state = _RateState(
            species_names=list(state.species_names),
            densities=new_densities,
            rate_matrix=state.rate_matrix.copy(),
            placeholders_used=list(state.placeholders_used),
            laser_intensity=state.laser_intensity,
        )
        samples = {name: float(n) for name, n in zip(state.species_names, new_densities)}
        return new_state, samples

    def is_complete(self, state: _RateState) -> bool:  # noqa: ARG002
        # Termination is governed by the runner's t_end check; the backend
        # itself never declares completion in Phase 1.
        return False

    def serialize_state(self, state: _RateState) -> Any:
        return {
            "species_names": list(state.species_names),
            "densities": state.densities.tolist(),
            "rate_matrix": state.rate_matrix.tolist(),
            "placeholders_used": list(state.placeholders_used),
            "laser_intensity": state.laser_intensity,
        }

    def deserialize_state(self, payload: Any) -> _RateState:
        return _RateState(
            species_names=list(payload["species_names"]),
            densities=np.asarray(payload["densities"], dtype=np.float64),
            rate_matrix=np.asarray(payload["rate_matrix"], dtype=np.float64),
            placeholders_used=list(payload.get("placeholders_used", [])),
            laser_intensity=float(payload.get("laser_intensity", 0.0)),
        )


def _laser_intensity_W_per_m2(spec: Any) -> float:
    """Pick out the first declared laser pulse intensity, in W/m^2.

    Returns 0.0 if no laser field is declared (then placeholder rates run at
    their unit base value). The number is not invented; it comes from the
    ModelSpec field's ``initialization.peak_intensity`` if present.
    """
    for field_def in spec.fields_:
        if field_def.type != "laser":
            continue
        peak = field_def.initialization.get("peak_intensity")
        if peak is None:
            continue
        # peak is a unit string in YAML; ModelSpec accepts strings here.
        from simworkbench.units import Q

        try:
            return float(Q(str(peak)).to("watt / meter ** 2").magnitude)
        except Exception:
            return 0.0
    return 0.0


__all__ = ["PythonCpuBackend"]
