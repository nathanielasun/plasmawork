"""Phase 5D — Experiment Proposal generator.

Plan §Phase 5 / 5D enumerates five task bullets:

  1. Propose minimal simulation.
  2. Propose higher-fidelity extensions.
  3. Estimate computational cost.
  4. Identify validation path.
  5. Recommend backend.

Output: ``<capsule>/experiment_proposal.md``. Deterministic and
offline-safe — synthesizes a Markdown document from the ModelSpec +
match report + gap report.

Plan §Phase 4 hard rule still applies: the proposal is a *draft*. The
agent does not promote it to a validated simulation. The reviewer
turns the proposal into an actual `Experiment` (Phase 1A) when ready.
"""

from __future__ import annotations

from pathlib import Path

from simworkbench.model_spec import ModelSpec

from .gap_analysis import GapReport
from .module_match import ModuleMatchReport

_HUMAN_REVIEW_BANNER = (
    "> **Status: Draft — needs human review.** Plan §Phase 5 produces "
    "an experiment proposal, NOT a validated simulation. The reviewer "
    "approves the proposal and promotes it into an `Experiment` via "
    "the workbench's Run Controls panel.\n"
)


class ExperimentProposer:
    """Render an experiment_proposal.md from Phase-5 outputs."""

    def propose(
        self,
        capsule_dir: str | Path,
        spec: ModelSpec,
        matches: ModuleMatchReport,
        gaps: GapReport,
    ) -> Path:
        capsule = Path(capsule_dir)
        target = capsule / "experiment_proposal.md"
        body = self._render(spec, matches, gaps)
        target.write_text(body, encoding="utf-8")
        return target

    def _render(
        self,
        spec: ModelSpec,
        matches: ModuleMatchReport,
        gaps: GapReport,
    ) -> str:
        top_match = matches.matches[0] if matches.matches else None
        backend = self._recommend_backend(spec, top_match)
        cost = self._estimate_cost(spec)
        return "\n".join(
            [
                f"# Experiment proposal — {spec.model.name}",
                "",
                _HUMAN_REVIEW_BANNER,
                "## Source",
                "",
                "- ModelSpec: `model/model_spec.yaml`",
                f"- Domain: `{spec.model.domain}`",
                f"- Species: {len(spec.species)}",
                f"- Interactions: {len(spec.interactions)}",
                f"- Equations: {len(spec.equations)}",
                "",
                "## Minimal simulation",
                "",
                self._minimal_simulation(spec),
                "",
                "## Higher-fidelity extensions",
                "",
                self._fidelity_extensions(spec, gaps),
                "",
                "## Computational cost",
                "",
                cost,
                "",
                "## Validation path",
                "",
                self._validation_path(spec, gaps),
                "",
                "## Backend",
                "",
                backend,
                "",
                "## Module matches",
                "",
                self._matches_table(matches),
                "",
                "## Open gaps",
                "",
                self._gaps_block(gaps),
                "",
            ]
        )

    @staticmethod
    def _minimal_simulation(spec: ModelSpec) -> str:
        solver = (
            spec.solvers.recommended[0].name
            if spec.solvers.recommended
            else "default"
        )
        return (
            f"Run the {solver} backend on the {spec.model.domain} ModelSpec "
            "for a short window (end_time ≈ 100 ns, max_steps = 50). This "
            "is the smallest experiment that exercises every Species + "
            "Interaction declared in the spec; the reviewer expands to "
            "higher fidelity once the minimal run is green."
        )

    @staticmethod
    def _fidelity_extensions(spec: ModelSpec, gaps: GapReport) -> str:
        lines = []
        if spec.geometry.dimensionality == 0:
            lines.append(
                "- Lift to 1D: declare `geometry.dimensionality = 1`, fill "
                "`geometry.domain_bounds`, and re-run module match (a 1D "
                "physics module replaces the 0D rate-equation backend)."
            )
        if gaps.missing_data:
            lines.append(
                "- Resolve missing data first (see Open gaps); the higher-"
                "fidelity extensions below depend on those values."
            )
        if not lines:
            lines.append("- No obvious extensions; reviewer fills in.")
        return "\n".join(lines)

    @staticmethod
    def _estimate_cost(spec: ModelSpec) -> str:
        n_species = len(spec.species)
        n_interactions = len(spec.interactions)
        # Order-of-magnitude estimate; reviewer refines.
        if spec.geometry.dimensionality == 0:
            return (
                f"0D rate-equation: ~{n_species + n_interactions} ODEs. "
                "scipy.integrate.solve_ivp (LSODA): seconds on a single CPU "
                "core for a 100 ns window."
            )
        if spec.geometry.dimensionality == 1:
            return (
                f"1D PDE: O({n_species} × N_grid) state. Estimate cost only "
                "after geometry.domain_bounds + grid resolution land."
            )
        return (
            f"{spec.geometry.dimensionality}D simulation: cost depends on "
            "grid resolution + timestep; reviewer adds estimate after a "
            "short benchmark run."
        )

    @staticmethod
    def _validation_path(spec: ModelSpec, gaps: GapReport) -> str:
        lines = [
            "1. Run the minimal simulation; persist as a capsule.",
            "2. Compare diagnostics against the paper's reported values "
            "(see `paper_sources/extracted_parameters.yaml`).",
            "3. Add conservation checks (mass / charge / energy as "
            "appropriate) under `validation/`.",
        ]
        if gaps.validation_gaps:
            lines.append(
                f"4. Resolve: {gaps.validation_gaps[0]}"
            )
        return "\n".join(lines)

    @staticmethod
    def _recommend_backend(spec: ModelSpec, top_match) -> str:
        if spec.geometry.dimensionality == 0:
            return (
                "**python_cpu** (Phase 1F default). 0D rate-equations run on "
                "scipy.integrate.solve_ivp with LSODA — never a hand-rolled "
                "timestep loop (plan §15.2)."
            )
        return (
            "Reviewer to choose; Phase 1F's `python_cpu` covers 0D + simple "
            "1D, Phase 8 brings GPU / HPC backends."
        )

    @staticmethod
    def _matches_table(matches: ModuleMatchReport) -> str:
        if not matches.matches:
            return "_No module matches found._"
        rows = ["| Module | Domain | Score | Reasons |", "|---|---|---|---|"]
        for m in matches.matches[:5]:
            reasons = "; ".join(m.reasons[:3]) or "—"
            rows.append(f"| `{m.name}` | {m.domain} | {m.score:.2f} | {reasons} |")
        return "\n".join(rows)

    @staticmethod
    def _gaps_block(gaps: GapReport) -> str:
        if gaps.is_empty():
            return "_No gaps detected._"
        lines = []
        for cat in (
            "missing_modules",
            "missing_data",
            "unsupported_regimes",
            "invalid_solver_choices",
            "validation_gaps",
        ):
            items = getattr(gaps, cat)
            if items:
                lines.append(f"- **{cat}**:")
                for item in items:
                    lines.append(f"  - {item}")
        return "\n".join(lines) or "_No gaps detected._"


__all__ = ["ExperimentProposer"]
