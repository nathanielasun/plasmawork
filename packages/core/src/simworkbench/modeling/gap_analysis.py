"""Phase 5C — Gap Analysis.

Plan §Phase 5 / 5C enumerates five categories the gap report MUST
cover:

  1. Missing modules.
  2. Missing data.
  3. Unsupported regimes.
  4. Invalid solver choices.
  5. Validation gaps.

Every category appears in the report, even when empty — downstream
consumers (the experiment-proposal generator, the UI) can iterate
deterministically.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from simworkbench.model_spec import ModelSpec

from .module_match import ModuleMatchReport


@dataclass
class GapReport:
    """Structured five-category gap report."""

    missing_modules: list[str] = field(default_factory=list)
    missing_data: list[str] = field(default_factory=list)
    unsupported_regimes: list[str] = field(default_factory=list)
    invalid_solver_choices: list[str] = field(default_factory=list)
    validation_gaps: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "missing_modules": list(self.missing_modules),
            "missing_data": list(self.missing_data),
            "unsupported_regimes": list(self.unsupported_regimes),
            "invalid_solver_choices": list(self.invalid_solver_choices),
            "validation_gaps": list(self.validation_gaps),
        }

    def is_empty(self) -> bool:
        return not any(
            (
                self.missing_modules,
                self.missing_data,
                self.unsupported_regimes,
                self.invalid_solver_choices,
                self.validation_gaps,
            )
        )


class GapAnalyzer:
    """Compute a structured gap report from a ModelSpec + match report."""

    def analyze(
        self, spec: ModelSpec, matches: ModuleMatchReport
    ) -> GapReport:
        report = GapReport()

        # 5C.1 — Missing modules: the match report's unmatched_requirements
        # column already enumerates these for the matcher's perspective.
        # We also independently re-derive "no compatible module" — the
        # matcher's flag fires on aggregate, but the gap analyzer is the
        # consumer and should not trust that the matcher always populates
        # the field. Defense-in-depth on a cross-cutting invariant.
        for req in matches.unmatched_requirements:
            report.missing_modules.append(req)
        if matches.matches and not any(m.is_compatible for m in matches.matches):
            report.missing_modules.append(
                f"No fully-compatible physics module for ModelSpec domain "
                f"{spec.model.domain!r}: best aggregate score = "
                f"{matches.matches[0].score:.2f}, but unit_compat / "
                "domain_match thresholds were not met. The reviewer must "
                "either add a new module under "
                "packages/physics_modules/ or pin a different domain on "
                "the ModelSpec."
            )

        # 5C.2 — Missing data: any species without a finite initial density,
        # any interaction whose coefficient_sources list a placeholder.
        for species in spec.species:
            if species.initial_density is None:
                report.missing_data.append(
                    f"Species {species.name!r}: missing initial_density"
                )
        for ix in spec.interactions:
            if any(
                src.startswith("placeholder:") for src in ix.coefficient_sources
            ):
                report.missing_data.append(
                    f"Interaction {ix.name!r}: rate uses placeholder coefficient "
                    "(plan §22 — runtime refuses unsourced rates)"
                )

        # 5C.3 — Unsupported regimes: any interaction declares a regime
        # whose required key is empty (best-effort heuristic).
        for ix in spec.interactions:
            if ix.valid_regime == {}:
                report.unsupported_regimes.append(
                    f"Interaction {ix.name!r}: valid_regime is empty; "
                    "reviewer must declare bounds before runtime."
                )

        # 5C.4 — Invalid solver choices: recommended solver doesn't appear
        # as a module in the match report.
        recommended = {s.name for s in spec.solvers.recommended}
        available_names = {m.name for m in matches.matches}
        for sname in recommended:
            if sname not in available_names:
                report.invalid_solver_choices.append(
                    f"Recommended solver {sname!r} has no matching module in "
                    "packages/physics_modules/"
                )

        # 5C.5 — Validation gaps: spec.validation has no acceptance criteria
        # or conservation checks; flag both. (We use the model's defaults
        # for the criteria — empty lists trip the gap.)
        if not getattr(spec.validation, "acceptance_criteria", []) and not getattr(
            spec.validation, "conservation_checks", []
        ):
            report.validation_gaps.append(
                "ModelSpec declares no acceptance_criteria or conservation_checks; "
                "Phase 7 promotion to validated requires both."
            )

        return report


__all__ = ["GapAnalyzer", "GapReport"]
