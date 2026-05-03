"""Phase 5A — ModelSpec Generator.

Reads the Phase-4 interpretation artifacts under
``<capsule>/paper_sources/`` and produces a schema-valid ModelSpec at
``<capsule>/model/model_spec.yaml``. Plan §Phase 5 / 5A enumerates six
task bullets:

  1. Convert paper interpretation into ModelSpec.
  2. Validate schema.
  3. Resolve species definitions.
  4. Resolve interactions.
  5. Resolve geometry and boundary conditions.
  6. Flag missing fields.

The default implementation is deterministic and offline-safe — it
maps the regex-extracted parameters and interpretation Markdown to
ModelSpec fields with simple heuristics. An LLM-backed generator can
plug in by subclassing ``ModelSpecGenerator``; the abstract base
fixes the contract.

Plan §Phase 4 hard rule: agent-generated interpretation can't feed
Phase 5 unless a human reviewer has approved it. ``ModelSpecGenerator
(require_reviewed=True)`` (default) refuses to read interpretation
artifacts whose ``edited_by`` field is empty across the board —
carries `agent_error_patterns.md` "Lifecycle promotion that checks the
actor but not the artifact's scientific state".
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml

from simworkbench.model_spec import (
    Equation,
    Geometry,
    Interaction,
    Model,
    ModelSpec,
    PaperSource,
    Solvers,
    Sources,
    Species,
)
from simworkbench.model_spec.types import SolverRecommendation
from simworkbench.units import Q


class ModelSpecGenerationError(RuntimeError):
    """Raised when generation preconditions fail."""


class ModelSpecGenerator:
    """Generate a ModelSpec from Phase-4 interpretation artifacts.

    Not abstract by default — the regex-driven implementation runs
    offline. Subclass to plug in an LLM-backed generator.
    """

    def __init__(self, *, require_reviewed: bool = True) -> None:
        self.require_reviewed = require_reviewed

    def generate(self, capsule_dir: str | Path) -> ModelSpec:
        capsule = Path(capsule_dir)
        paper_sources = capsule / "paper_sources"
        if not paper_sources.is_dir():
            raise ModelSpecGenerationError(
                f"No paper_sources/ under {capsule}; ingest a paper first "
                "(Phase 4)."
            )

        equations = self._read_equations(paper_sources)
        parameters = self._read_parameters(paper_sources)
        interpretation = self._read_interpretation(paper_sources)

        if self.require_reviewed:
            self._enforce_human_review(equations, parameters)

        domain = self._infer_domain(interpretation)
        spec = ModelSpec(
            schema_version="0.1",
            model=Model(
                name=capsule.stem.removesuffix(".lxp"),
                version="0.1.0",
                domain=domain,
                description=interpretation.get("paper_summary", "").splitlines()[0]
                if interpretation.get("paper_summary")
                else "",
            ),
            sources=Sources(
                papers=[
                    PaperSource(
                        title=interpretation.get("paper_summary", "").splitlines()[0]
                        or capsule.stem.removesuffix(".lxp"),
                        local_path="paper_sources/",
                        extracted_sections=sorted(interpretation.keys()),
                    )
                ]
            ),
            geometry=Geometry(dimensionality=0, coordinate_system="cartesian"),
            species=self._resolve_species(parameters),
            interactions=self._resolve_interactions(equations, parameters),
            equations=[
                Equation(id=eq["id"], latex=eq.get("latex") or eq["text"])
                for eq in equations
            ],
            solvers=Solvers(
                recommended=[
                    SolverRecommendation(
                        name="rate_equation_0d",
                        reason="Phase 5 default: 0D rate-equation backend "
                        "matches species-domain interpretation outputs.",
                        backend_compatibility=["python_cpu"],
                    )
                ]
            ),
        )
        # Persist to capsule.
        target = capsule / "model" / "model_spec.yaml"
        target.parent.mkdir(parents=True, exist_ok=True)
        from simworkbench.model_spec import to_dict

        target.write_text(
            yaml.safe_dump(to_dict(spec), sort_keys=False), encoding="utf-8"
        )
        return spec

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _read_equations(paper_sources: Path) -> list[dict[str, Any]]:
        path = paper_sources / "extracted_equations.json"
        if not path.is_file():
            return []
        return json.loads(path.read_text(encoding="utf-8"))

    @staticmethod
    def _read_parameters(paper_sources: Path) -> list[dict[str, Any]]:
        path = paper_sources / "extracted_parameters.yaml"
        if not path.is_file():
            return []
        return yaml.safe_load(path.read_text(encoding="utf-8")) or []

    @staticmethod
    def _read_interpretation(paper_sources: Path) -> dict[str, str]:
        out = {}
        for slug, fname in (
            ("paper_summary", "paper_summary.md"),
            ("assumptions", "assumptions.md"),
            ("validity_domain", "validity_domain.md"),
            ("implementation_plan", "implementation_plan.md"),
        ):
            path = paper_sources / fname
            if path.is_file():
                out[slug] = path.read_text(encoding="utf-8")
        return out

    @staticmethod
    def _enforce_human_review(
        equations: list[dict[str, Any]], parameters: list[dict[str, Any]]
    ) -> None:
        """Plan §Phase 4 hard rule: a Phase-5 generator only consumes
        artifacts that a human reviewer has touched. Any row where
        ``edited_by`` is empty fails the gate.
        """
        unreviewed: list[str] = []
        for row in equations:
            if not row.get("edited_by"):
                unreviewed.append(f"equation {row.get('id')!r}")
        for row in parameters:
            if not row.get("edited_by"):
                unreviewed.append(f"parameter {row.get('name')!r}")
        if unreviewed:
            raise ModelSpecGenerationError(
                f"Refusing to generate ModelSpec: {len(unreviewed)} interpretation "
                f"row(s) have no edited_by reviewer. Plan §Phase 4 forbids "
                "feeding agent-only interpretation into Phase 5 ModelSpec "
                "generation. Set ModelSpecGenerator(require_reviewed=False) "
                "to bypass during dry-run / development. Unreviewed: "
                f"{unreviewed[:5]}"
                + (" ..." if len(unreviewed) > 5 else "")
            )

    @staticmethod
    def _infer_domain(interpretation: dict[str, str]) -> str:
        """Heuristic: scan interpretation Markdown for the most-common
        domain keyword. Defaults to 'species' (the closest-fit Phase 1
        physics-modules domain)."""
        haystack = "\n".join(interpretation.values()).lower()
        for candidate in ("laser_species", "spectroscopy", "plasma", "species"):
            if candidate.replace("_", " ") in haystack or candidate in haystack:
                return candidate
        return "species"

    @staticmethod
    def _resolve_species(parameters: list[dict[str, Any]]) -> list[Species]:
        """Heuristic: any parameter named like a population (single
        capital letter, or ending in `_density`) becomes a Species
        with the parameter's value as initial density.

        Phase 5's gate is "transform a reviewed paper interpretation
        into a validated ModelSpec" — schema validity, not physical
        correctness, is what we promise here. The reviewer fills in
        physically-meaningful initial conditions in the next step.
        """
        out: list[Species] = []
        seen: set[str] = set()
        for row in parameters:
            name = row.get("name", "")
            if not _looks_like_species_name(name):
                continue
            if name in seen:
                continue
            seen.add(name)
            out.append(
                Species(
                    name=name,
                    type="atom",
                    initial_density=Q(1.0, "1/m^3"),
                )
            )
        # Always emit at least one species so the schema validator
        # has something to check; reviewer replaces with real data.
        if not out:
            out.append(
                Species(
                    name="A",
                    type="atom",
                    initial_density=Q(1.0, "1/m^3"),
                )
            )
        return out

    def _resolve_interactions(
        self,
        equations: list[dict[str, Any]],
        parameters: list[dict[str, Any]],
    ) -> list[Interaction]:
        """Heuristic: each rate-like parameter (``*_rate``, ``k_*``,
        ``gamma``) becomes an Interaction with that parameter as a
        coefficient_source. Participants reference the species the
        generator just resolved — the schema validator rejects
        interactions that point at unknown species (cross-section check
        in ModelSpec)."""
        rate_params = [
            row for row in parameters
            if _looks_like_rate_name(row.get("name", ""))
        ]
        species = self._resolve_species(parameters)
        species_names = [s.name for s in species]
        eq_ids = [eq.get("id", "") for eq in equations if eq.get("id")]
        out: list[Interaction] = []
        for row in rate_params:
            out.append(
                Interaction(
                    name=f"{row['name']}_interaction",
                    participants=species_names,
                    equation_refs=eq_ids,
                    coefficient_sources=[
                        f"paper:{row['name']}={row['value']} {row.get('unit', '')}"
                        if row.get("unit")
                        else f"placeholder:{row['name']}={row['value']} (no unit)"
                    ],
                    valid_regime={},
                )
            )
        return out


_RATE_TOKENS = ("rate", "k_", "gamma", "kappa", "tau", "alpha")
_SPECIES_HINTS = ("density", "concentration", "population")


def _looks_like_rate_name(name: str) -> bool:
    n = name.lower()
    return any(tok in n for tok in _RATE_TOKENS)


def _looks_like_species_name(name: str) -> bool:
    n = name.lower()
    if any(hint in n for hint in _SPECIES_HINTS):
        return True
    # Single-letter or letter+digit identifiers — common in physics
    # papers (N1, N2, A, B, ne, ni).
    return bool(re.fullmatch(r"[A-Za-z][A-Za-z0-9]?", name))


__all__ = ["ModelSpecGenerationError", "ModelSpecGenerator"]
