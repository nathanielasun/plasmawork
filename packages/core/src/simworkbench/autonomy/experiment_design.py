"""Phase 10 / 10A — Experiment Design Agent.

Turns a ``ModelSpec`` into a structured ``ExperimentPlan`` with an
explicit minimum viable model, an ordered fidelity ladder, a cost
estimate, a list of diagnostics, and a validation path. The plan is
data, not a side-effecting run; the agent does NOT touch the
filesystem here.

Carries plan §22 (Scientific Accuracy Policy):
  - When a plan flags any placeholder coefficient, the resulting
    capsule must be `exploratory`, not `validated`.
  - The designer never fabricates coefficients; missing data is
    reported, not invented.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from simworkbench.model_spec import ModelSpec

CapsuleStatus = Literal["exploratory", "validated"]


@dataclass(frozen=True)
class FidelityStep:
    """One rung on the fidelity ladder."""

    label: str
    description: str
    cpu_cost_factor: float  # multiplier vs the MVP baseline


@dataclass(frozen=True)
class CostEstimate:
    """Coarse cost estimate for the planned experiment."""

    total_cpu_seconds: float
    backend: str
    notes: str = ""


@dataclass
class ExperimentPlan:
    """Structured plan for one experiment.

    Plan §Phase 10 / 10A bullets:
      - minimum_viable_model: the smallest model that exercises the
        physics in question.
      - fidelity_ladder: ordered list of fidelity levels (low → high).
      - cost_estimate: coarse cost (CPU-seconds) on the chosen backend.
      - diagnostics: list of diagnostic names that will be measured.
      - validation_path: list of validation strategies (analytical
        limit, paper figure, conservation check, etc.).
      - placeholders: coefficient names that the designer flagged as
        missing/placeholder. Non-empty → capsule status `exploratory`.
    """

    minimum_viable_model: str
    fidelity_ladder: list[FidelityStep]
    cost_estimate: CostEstimate
    diagnostics: list[str]
    validation_path: list[str]
    placeholders: list[str] = field(default_factory=list)

    def with_placeholder_coefficient(self, name: str) -> ExperimentPlan:
        """Return a copy of the plan flagged with one missing coefficient."""
        return ExperimentPlan(
            minimum_viable_model=self.minimum_viable_model,
            fidelity_ladder=list(self.fidelity_ladder),
            cost_estimate=self.cost_estimate,
            diagnostics=list(self.diagnostics),
            validation_path=list(self.validation_path),
            placeholders=[*self.placeholders, name],
        )


def capsule_status_for_plan(plan: ExperimentPlan) -> CapsuleStatus:
    """Plan §22: any placeholder → exploratory; otherwise validated."""
    return "exploratory" if plan.placeholders else "validated"


class ExperimentDesigner:
    """Designer that emits an ``ExperimentPlan`` from a ``ModelSpec``."""

    def design(self, spec: ModelSpec) -> ExperimentPlan:
        """Translate a ModelSpec into a structured plan.

        Refuses if the spec carries no recommended solver (the
        validation path can't be articulated without one).
        """
        if not spec.solvers.recommended:
            raise ValueError(
                "ExperimentDesigner refuses to design without a "
                "recommended solver: no validation path can be "
                "articulated. Add at least one solver recommendation "
                "to the ModelSpec."
            )

        recommended = spec.solvers.recommended[0]
        backend = (
            recommended.backend_compatibility[0]
            if recommended.backend_compatibility
            else "python_cpu"
        )

        # Minimum viable model: the spec's own name + recommended solver.
        mvp = (
            f"{spec.model.name} ({spec.model.domain}, dim="
            f"{spec.geometry.dimensionality}) on {recommended.name}"
        )

        # Fidelity ladder: scale by problem size proxies.
        ladder = self._build_fidelity_ladder(spec)

        # Cost estimate: rough scaling from species/grid count.
        cost = self._estimate_cost(spec, backend)

        # Diagnostics: density per species, plus standard health checks.
        diagnostics = [f"density_{s.name}" for s in spec.species]
        diagnostics.extend(["mass_balance", "energy_balance"])

        # Validation path: pulled from the spec's domain. Never empty
        # for a spec with a recommended solver.
        validation_path = self._validation_path(spec)
        if not validation_path:
            raise ValueError(
                f"ExperimentDesigner could not build a validation path "
                f"for spec {spec.model.name!r}. Add a domain-specific "
                "validation strategy."
            )

        # Phase-10 audit (round 2): walk the spec's interactions and
        # surface any `coefficient_sources` entries prefixed with
        # `"placeholder:"`. Without this propagation, a spec built
        # entirely from placeholder rates was reported as `validated`
        # by capsule_status_for_plan() — exactly the failure plan §22
        # exists to prevent.
        placeholders = self._collect_placeholders(spec)

        return ExperimentPlan(
            minimum_viable_model=mvp,
            fidelity_ladder=ladder,
            cost_estimate=cost,
            diagnostics=diagnostics,
            validation_path=validation_path,
            placeholders=placeholders,
        )

    @staticmethod
    def _collect_placeholders(spec: ModelSpec) -> list[str]:
        """Extract every interaction whose coefficient_sources flag a
        placeholder rate (matches the runtime's convention in
        ``simworkbench.runtime.python_cpu``: any source string whose
        lowercased form starts with ``placeholder``).
        """
        flagged: list[str] = []
        for ix in getattr(spec, "interactions", []) or []:
            sources = getattr(ix, "coefficient_sources", []) or []
            for src in sources:
                if str(src).lower().startswith("placeholder"):
                    flagged.append(ix.name)
                    break
        return flagged

    @staticmethod
    def _build_fidelity_ladder(spec: ModelSpec) -> list[FidelityStep]:
        dim = spec.geometry.dimensionality
        ladder = [
            FidelityStep(
                label="screening",
                description="Coarse exploratory run; few species, large timestep.",
                cpu_cost_factor=1.0,
            ),
            FidelityStep(
                label="reference",
                description="Baseline fidelity; matches the published study.",
                cpu_cost_factor=4.0,
            ),
        ]
        if dim >= 1:
            ladder.append(
                FidelityStep(
                    label="converged",
                    description="Grid-converged solution; halved timestep.",
                    cpu_cost_factor=16.0,
                )
            )
        return ladder

    @staticmethod
    def _estimate_cost(spec: ModelSpec, backend: str) -> CostEstimate:
        species_count = max(len(spec.species), 1)
        dim = spec.geometry.dimensionality
        # Rough heuristic: O(N_species) for 0D, scaled by 100 per
        # dimension. Real cost models live in the backend metadata;
        # this is a planning estimate.
        base = 0.01 * species_count
        scaling = 1.0 if dim == 0 else 100.0 ** dim
        total = base * scaling
        return CostEstimate(
            total_cpu_seconds=total,
            backend=backend,
            notes=(
                f"Heuristic estimate: O({species_count} species) × "
                f"dim={dim}. Refine after one screening run."
            ),
        )

    @staticmethod
    def _validation_path(spec: ModelSpec) -> list[str]:
        domain = spec.model.domain
        path: list[str] = []
        # Every spec gets dimensional + smoke tests.
        path.append("dimensional consistency check on every public output")
        path.append("smoke run with conservation diagnostics")
        # Domain-specific validation steps.
        if domain == "species":
            path.append("rate-equation steady-state matches analytic limit")
        elif domain == "molecular_dynamics":
            path.append("energy drift < 1e-3 over 1000 steps")
        elif domain == "phase_transition":
            path.append("critical exponent matches Onsager / known value")
        elif domain == "pde":
            path.append("grid convergence at 2nd order")
        elif domain == "monte_carlo":
            path.append("estimator variance halves with 4× samples")
        elif domain == "laser":
            path.append("Lambert-Beer absorption recovers analytic limit")
        else:
            path.append(
                f"benchmark reproduction (domain={domain!r} requires a "
                "domain-specific validation reference)"
            )
        return path


__all__ = [
    "CapsuleStatus",
    "CostEstimate",
    "ExperimentDesigner",
    "ExperimentPlan",
    "FidelityStep",
    "capsule_status_for_plan",
]
