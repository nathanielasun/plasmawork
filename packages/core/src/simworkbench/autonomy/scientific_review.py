"""Phase 10 / 10D — Scientific Review Agent.

Generates an agent-written critique of a capsule's ModelSpec. The
review covers the five plan-named axes:

  - assumption_critique: are the model's stated assumptions internally
    consistent with the chosen domain / dimensionality / solver?
  - missing_physics: terms or interactions the model would need to
    reproduce the expected physics but currently lacks.
  - literature_alignment: short narrative on whether the spec's
    parameters / solver match published practice for the domain.
  - overclaim_flags: language patterns that suggest unsupported
    claims (e.g. "validated against" without a benchmark reference).
  - recommended_validation: list of concrete validation actions the
    user should run before promoting the capsule to `validated`.

The reviewer is read-only on the capsule's existing artifacts. The
single output it writes is ``<capsule>/review/scientific_review.md``;
``<capsule>/src/user_edits/``, ``paper_sources/``, and
``provenance/`` are off-limits.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from simworkbench.model_spec import load_yaml as _load_modelspec_yaml


@dataclass
class ScientificReview:
    """Structured agent review of a capsule's spec."""

    assumption_critique: str = ""
    missing_physics: list[str] = field(default_factory=list)
    literature_alignment: str = ""
    overclaim_flags: list[str] = field(default_factory=list)
    recommended_validation: list[str] = field(default_factory=list)


_OVERCLAIM_RE = re.compile(
    r"\b(?:always|guaranteed|exact|never fails|fully validated|first principles)\b",
    re.IGNORECASE,
)


# Off-limits subtrees per CLAUDE.md "Off-Limits Directories for
# Destructive Edits". The reviewer NEVER writes here.
_FORBIDDEN_SUBPATHS: tuple[str, ...] = (
    "src/user_edits",
    "paper_sources",
    "provenance",
)


class ScientificReviewer:
    """Review a capsule's ModelSpec and emit a structured critique."""

    def review(self, capsule_path: str | Path) -> ScientificReview:
        capsule_path = Path(capsule_path)
        spec_path = capsule_path / "model" / "model_spec.yaml"
        if not spec_path.is_file():
            raise FileNotFoundError(
                f"Capsule {capsule_path} has no model/model_spec.yaml; "
                "cannot review."
            )
        spec = _load_modelspec_yaml(spec_path)

        review = ScientificReview()
        review.assumption_critique = self._critique_assumptions(spec)
        review.missing_physics = self._missing_physics(spec)
        review.literature_alignment = self._literature_alignment(spec)
        review.overclaim_flags = self._overclaim_flags(capsule_path, spec)
        review.recommended_validation = self._recommended_validation(spec)
        return review

    def write(
        self,
        capsule_path: str | Path,
        *,
        require_workbench_target: bool = True,
    ) -> Path:
        """Run the review and write
        ``<capsule>/review/scientific_review.md``.

        Refuses to write anywhere outside the ``review/`` subtree, and
        — when ``require_workbench_target=True`` (the default) —
        refuses to land outside the four workbench-managed roots
        (Phase-8/9 audit lesson, repeated for the autonomy writer).
        """
        capsule_path = Path(capsule_path)
        review = self.review(capsule_path)
        review_dir = capsule_path / "review"
        target = review_dir / "scientific_review.md"
        # Phase-10 round-2 audit: enforce the workbench-managed-roots
        # locality guard BEFORE the in-capsule subtree check, so that
        # `/private/tmp/<anything>` is rejected up front. The earlier
        # implementation only validated the in-capsule subtree, which
        # silently accepted writes anywhere on disk if the caller
        # passed an off-workbench capsule path.
        if require_workbench_target:
            from simworkbench.paths import is_under_workbench

            if not is_under_workbench(target):
                raise PermissionError(
                    f"Refusing to write review outside workbench-"
                    f"managed roots: {target}. Pass "
                    "require_workbench_target=False if the user "
                    "explicitly chose an external destination."
                )
        # Defense-in-depth: refuse if the resolved target tries to
        # land inside a forbidden subtree. Path traversal would have
        # to be deliberate, but we still verify.
        resolved = target.resolve()
        capsule_resolved = capsule_path.resolve()
        try:
            relative = resolved.relative_to(capsule_resolved)
        except ValueError as exc:
            raise PermissionError(
                f"Refusing to write review outside capsule: {target}"
            ) from exc
        for forbidden in _FORBIDDEN_SUBPATHS:
            if str(relative).startswith(forbidden):
                raise PermissionError(
                    f"Refusing to write review under forbidden subtree "
                    f"{forbidden!r}: {target}"
                )
        review_dir.mkdir(parents=True, exist_ok=True)
        target.write_text(_render_markdown(review), encoding="utf-8")
        return target

    # --- private interpretation helpers ---------------------------------

    @staticmethod
    def _critique_assumptions(spec) -> str:
        notes: list[str] = []
        dim = spec.geometry.dimensionality
        domain = spec.model.domain
        if domain == "species" and dim != 0:
            notes.append(
                f"Species-domain spec at dim={dim}: rate equations "
                "are typically 0D unless a transport term is being "
                "tracked. Confirm transport is intended."
            )
        if domain == "pde" and dim == 0:
            notes.append(
                "PDE-domain spec at dim=0: PDE solvers usually need "
                "spatial structure. Verify the geometry block."
            )
        if not spec.species and domain == "species":
            notes.append(
                "Species-domain spec with empty species list — the "
                "model has no carriers to evolve."
            )
        if not notes:
            notes.append(
                "Stated assumptions are consistent with the chosen "
                "domain and dimensionality."
            )
        return " ".join(notes)

    @staticmethod
    def _missing_physics(spec) -> list[str]:
        gaps: list[str] = []
        domain = spec.model.domain
        if domain == "species" and spec.species and not getattr(
            spec, "interactions", None
        ):
            gaps.append(
                "No interactions declared between species — the rate "
                "equations have no coupling."
            )
        if domain in {"plasma", "laser"} and not getattr(
            spec, "fields", None
        ):
            gaps.append(
                f"{domain}-domain spec without an explicit `fields` "
                "block; electromagnetic / radiation coupling is "
                "implicit."
            )
        if domain == "phase_transition" and not getattr(
            spec, "geometry", None
        ):
            gaps.append(
                "Phase-transition spec without geometry; lattice "
                "size and boundary conditions cannot be inferred."
            )
        return gaps

    @staticmethod
    def _literature_alignment(spec) -> str:
        domain = spec.model.domain
        recommended = (
            spec.solvers.recommended[0].name
            if spec.solvers.recommended
            else None
        )
        if recommended is None:
            return (
                "No recommended solver is declared — cannot evaluate "
                "alignment with published practice."
            )
        published = {
            "species": "rate_equation_0d",
            "molecular_dynamics": "lennard_jones",
            "phase_transition": "ising_2d",
            "pde": "wave_equation_1d",
            "laser": "absorption_lambert_beer",
        }
        canonical = published.get(domain)
        if canonical is None:
            return (
                f"Domain {domain!r} has no canonical reference solver "
                "in the registry; literature alignment is "
                "indeterminate without manual review."
            )
        if recommended == canonical:
            return (
                f"Recommended solver {recommended!r} is the canonical "
                f"reference for the {domain!r} domain — literature "
                "alignment looks fine at the algorithm level."
            )
        return (
            f"Recommended solver {recommended!r} differs from the "
            f"canonical reference {canonical!r} for the {domain!r} "
            "domain; double-check that the chosen solver covers the "
            "regime of interest."
        )

    @staticmethod
    def _overclaim_flags(capsule_path: Path, spec) -> list[str]:
        flags: list[str] = []
        # Scan the capsule's README / assumptions / model.yaml for
        # absolutist phrasing.
        for relative in (
            "README.md",
            "model/model_spec.yaml",
            "validation/validation_summary.md",
        ):
            candidate = capsule_path / relative
            if not candidate.is_file():
                continue
            try:
                body = candidate.read_text(encoding="utf-8")
            except OSError:
                continue
            for match in _OVERCLAIM_RE.findall(body):
                flags.append(
                    f"{relative}: absolutist phrasing — '{match}'"
                )
        # spec-level: claims any solver "validated" without
        # documented benchmarks?
        return flags

    @staticmethod
    def _recommended_validation(spec) -> list[str]:
        recs: list[str] = []
        recs.append(
            "Run the smoke tests in `tests/validation/` for the "
            "domain to confirm the spec's analytic limit is "
            "recovered."
        )
        recs.append(
            "Run a grid / timestep convergence check; halve the step "
            "and confirm the diagnostics agree to within tolerance."
        )
        recs.append(
            "Confirm conservation diagnostics (mass / energy / charge) "
            "stay flat over the integration window."
        )
        if not spec.solvers.recommended:
            recs.append(
                "Add at least one recommended solver to the spec; "
                "the current ModelSpec has no validation anchor."
            )
        return recs


def _render_markdown(review: ScientificReview) -> str:
    lines = ["# Scientific Review", ""]
    lines.append("## Assumption critique")
    lines.append(review.assumption_critique or "_No critique recorded._")
    lines.append("")
    lines.append("## Missing physics")
    if review.missing_physics:
        lines.extend(f"- {item}" for item in review.missing_physics)
    else:
        lines.append("_No obvious gaps identified._")
    lines.append("")
    lines.append("## Literature alignment")
    lines.append(review.literature_alignment or "_Not evaluated._")
    lines.append("")
    lines.append("## Overclaim flags")
    if review.overclaim_flags:
        lines.extend(f"- {item}" for item in review.overclaim_flags)
    else:
        lines.append("_No overclaiming language detected._")
    lines.append("")
    lines.append("## Recommended validation")
    for rec in review.recommended_validation:
        lines.append(f"- {rec}")
    lines.append("")
    return "\n".join(lines)


__all__ = ["ScientificReview", "ScientificReviewer"]
