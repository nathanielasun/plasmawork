"""Phase 5B — Module Retrieval.

Walks ``packages/physics_modules/<domain>/<name>/module.yaml`` files and
matches them against a ModelSpec's domain + I/O + units + solver
preferences. Plan §Phase 5 / 5B enumerates five task bullets:

  1. Search registry by required physics.
  2. Match domains and regimes.
  3. Compare inputs/outputs.
  4. Check unit compatibility.
  5. Check solver compatibility.

Each match is scored 0..1 with structured per-bullet sub-scores so a
reviewer (or downstream agent) can see WHY a match was preferred.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from simworkbench.model_spec import ModelSpec
from simworkbench.paths import repo_root
from simworkbench.units.registry import get_registry


@dataclass
class ModuleMatch:
    """One row of a match report."""

    name: str
    domain: str
    version: str
    score: float  # 0..1; weighted average of sub_scores
    sub_scores: dict[str, float] = field(default_factory=dict)
    reasons: list[str] = field(default_factory=list)
    directory: str = ""
    # Phase 7 / 7A — Registry v1 lifecycle. Surface the module's
    # status so consumers (ExperimentProposer, GapAnalyzer) can
    # prefer validated over candidate modules at the same score.
    module_status: str = "candidate"

    @property
    def is_compatible(self) -> bool:
        """Strict compatibility — distinct from "this module is in the
        registry and shares a domain". A module is compatible only when:

        - Its domain matches the spec's (``domain_match >= 0.5``).
        - It covers EVERY required output dimension (``unit_compat == 1.0``).

        Aggregate ``score`` can be high (e.g. ``0.625`` for a fake
        species-domain module that emits only ``second``) while
        ``is_compatible`` is False. Carries the post-Phase-5 audit
        finding that the previous "score > 0.5" heuristic let
        dimensionally-wrong modules pass as matches.
        """
        return (
            self.sub_scores.get("domain_match", 0.0) >= 0.5
            and self.sub_scores.get("unit_compat", 0.0) >= 1.0
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "domain": self.domain,
            "version": self.version,
            "score": self.score,
            "sub_scores": dict(self.sub_scores),
            "reasons": list(self.reasons),
            "directory": self.directory,
            "is_compatible": self.is_compatible,
            "module_status": self.module_status,
        }


@dataclass
class ModuleMatchReport:
    """Full output of ``ModuleMatcher.match``."""

    matches: list[ModuleMatch] = field(default_factory=list)
    unmatched_requirements: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "matches": [m.to_dict() for m in self.matches],
            "unmatched_requirements": list(self.unmatched_requirements),
        }


def _modules_root() -> Path:
    return repo_root() / "packages" / "physics_modules"


def _relative_to_repo(path: Path) -> str:
    """Return ``path`` as repo-relative when possible, else absolute."""
    try:
        return str(path.relative_to(repo_root()))
    except ValueError:
        return str(path)


class ModuleMatcher:
    """Match a ModelSpec against the on-disk physics-module registry."""

    def __init__(self, *, modules_root: Path | None = None) -> None:
        self.modules_root = modules_root or _modules_root()

    def match(self, spec: ModelSpec) -> ModuleMatchReport:
        report = ModuleMatchReport()
        for module_yaml in self.modules_root.rglob("module.yaml"):
            # Skip the templates/ tree.
            if "templates" in module_yaml.parts:
                continue
            try:
                metadata = yaml.safe_load(module_yaml.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001
                continue
            if not isinstance(metadata, dict):
                continue
            sub_scores, reasons = _score(metadata, spec)
            score = sum(sub_scores.values()) / max(len(sub_scores), 1)
            report.matches.append(
                ModuleMatch(
                    name=str(metadata.get("name", "?")),
                    domain=str(metadata.get("domain", "?")),
                    version=str(metadata.get("version", "?")),
                    score=score,
                    sub_scores=sub_scores,
                    reasons=reasons,
                    directory=_relative_to_repo(module_yaml.parent),
                    module_status=str(metadata.get("status", "candidate")),
                )
            )
        # Sort highest-scoring first, preferring validated/trusted modules
        # when the scientific fit ties. Phase 7 added `module_status`
        # specifically so consumers do not pick a candidate over validated
        # evidence at the same score.
        status_rank = {
            "trusted": 3,
            "validated": 2,
            "candidate": 1,
            "draft": 0,
            "deprecated": -1,
        }
        report.matches.sort(
            key=lambda m: (m.score, status_rank.get(m.module_status, 0)),
            reverse=True,
        )

        # If no module's domain matches, the spec's domain is unmatched.
        if not any(m.score > 0.5 for m in report.matches):
            report.unmatched_requirements.append(
                f"No physics module found for domain {spec.model.domain!r}"
            )
        # If no module is FULLY compatible (domain match + every required
        # output dim covered), flag that too — a "high-score" partial
        # match is not a real match. Carries the post-Phase-5-audit
        # pattern "Compatibility checks that pattern-match instead of
        # validating dimensionality": the per-port `unit_compat` fix
        # was necessary; this aggregate check is also necessary.
        if not any(m.is_compatible for m in report.matches):
            req_dims = _required_output_dims(spec)
            if req_dims:
                report.unmatched_requirements.append(
                    f"No physics module fully covers the ModelSpec's required "
                    f"output dimensionalities for domain "
                    f"{spec.model.domain!r} (need: "
                    f"{[str(d) for d in req_dims]!r})"
                )
        # If recommended solvers exist but no module of the same name is in
        # the registry, flag.
        recommended = {s.name for s in spec.solvers.recommended}
        available_names = {m.name for m in report.matches}
        for sname in recommended:
            if sname not in available_names:
                report.unmatched_requirements.append(
                    f"Recommended solver {sname!r} not found in module registry"
                )
        return report


def _score(metadata: dict[str, Any], spec: ModelSpec) -> tuple[dict[str, float], list[str]]:
    """Compute per-bullet sub-scores and structured reasons."""
    sub: dict[str, float] = {}
    reasons: list[str] = []

    # 5B.1 + 5B.2 — domain / regime match.
    module_domain = str(metadata.get("domain", "")).lower()
    spec_domain = spec.model.domain.lower()
    if module_domain == spec_domain:
        sub["domain_match"] = 1.0
        reasons.append(f"domain matches ({module_domain})")
    elif spec_domain.startswith(module_domain) or module_domain.startswith(spec_domain):
        sub["domain_match"] = 0.5
        reasons.append(f"domain partial-match ({module_domain} vs {spec_domain})")
    else:
        sub["domain_match"] = 0.0

    # 5B.3 — I/O comparison: every module output port whose `units` is
    # dimensionally compatible with one of the ModelSpec's expected
    # output dimensions (number density for species; field-specific for
    # fields_) counts as a hit. Missing or unparseable units → 0.
    outputs = metadata.get("outputs") or []
    expected_dims = _expected_output_dims(spec)
    if not outputs:
        sub["io_match"] = 0.0
        reasons.append("module declares no outputs")
    else:
        registry = get_registry()
        n_compatible = 0
        for port in outputs:
            unit = port.get("units", "")
            if not unit:
                continue
            try:
                module_dim = registry.parse_units(unit).dimensionality
            except Exception:  # noqa: BLE001
                continue
            if any(module_dim == d for d in expected_dims):
                n_compatible += 1
        sub["io_match"] = (
            min(1.0, n_compatible / max(len(expected_dims), 1))
            if expected_dims
            else 0.5
        )
        reasons.append(
            f"{n_compatible}/{len(outputs)} output port(s) match an expected "
            f"ModelSpec dimensionality"
        )

    # 5B.4 — Unit compatibility: REQUIRED spec dims must each be covered
    # by some module output. The earlier implementation accepted any
    # parseable unit (including a single `second`-port module for a
    # number-density spec) as 1.0. The fix: check coverage of the spec's
    # *required* output dims (species → number density) and unparseable
    # units. Carries `agent_error_patterns.md` "Compatibility checks that
    # pattern-match instead of validating dimensionality".
    registry = get_registry()
    bad_units: list[str] = []
    module_dims = []
    for port in outputs:
        unit = port.get("units", "")
        if not unit:
            continue
        try:
            module_dims.append(registry.parse_units(unit).dimensionality)
        except Exception:  # noqa: BLE001
            bad_units.append(unit)
    required_dims = _required_output_dims(spec)
    if bad_units:
        sub["unit_compat"] = 0.0
        reasons.append(f"unparseable unit(s): {bad_units!r}")
    elif not required_dims:
        sub["unit_compat"] = 1.0
    else:
        n_required_covered = sum(
            1 for rd in required_dims if any(md == rd for md in module_dims)
        )
        sub["unit_compat"] = n_required_covered / len(required_dims)
        if n_required_covered == 0:
            reasons.append(
                f"module covers 0/{len(required_dims)} of the spec's "
                "required output dimensionalities"
            )
        elif n_required_covered < len(required_dims):
            reasons.append(
                f"module covers {n_required_covered}/{len(required_dims)} "
                "required output dimensionalities (partial)"
            )

    # 5B.5 — Solver compatibility.
    recommended = {s.name for s in spec.solvers.recommended}
    if not recommended:
        sub["solver_match"] = 0.5
    elif metadata.get("name") in recommended:
        sub["solver_match"] = 1.0
        reasons.append(f"matches recommended solver {metadata['name']!r}")
    else:
        sub["solver_match"] = 0.0

    return sub, reasons


def _required_output_dims(spec: ModelSpec) -> list:
    """The dimensionalities a module MUST cover to count as compatible.

    For species-domain specs the required output is number density —
    runtime needs species trajectories in number density. Time is
    accepted as part of `_expected_output_dims` (a module's auxiliary
    output) but is not required at this gate; modules that ONLY emit
    time should not score 1.0 against a species spec.
    """
    registry = get_registry()
    required: list = []
    if spec.species:
        required.append(registry.parse_units("1 / m^3").dimensionality)
    return required


def _expected_output_dims(spec: ModelSpec) -> list:
    """Collect the dimensionalities a module would need to produce to be
    compatible with this ModelSpec.

    For species-domain specs the canonical output is number density
    (``1 / [length]^3``) — the runtime returns species trajectories in
    that unit. Plus a time axis (``[time]``). For field-bearing specs we
    also accept the field's declared init-units when present.
    """
    registry = get_registry()
    expected: list = []
    # Species → number density.
    if spec.species:
        expected.append(registry.parse_units("1 / m^3").dimensionality)
    # Always accept a time axis.
    expected.append(registry.parse_units("second").dimensionality)
    # Field-specific dimensionalities, if any field declares units in
    # initialization.
    for field_def in spec.fields_:
        init = field_def.initialization or {}
        for value in init.values():
            if isinstance(value, str):
                try:
                    expected.append(registry.parse_units(value).dimensionality)
                except Exception:  # noqa: BLE001
                    continue
    return expected


__all__ = ["ModuleMatch", "ModuleMatchReport", "ModuleMatcher"]
