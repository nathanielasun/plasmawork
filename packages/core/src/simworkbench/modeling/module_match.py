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

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "domain": self.domain,
            "version": self.version,
            "score": self.score,
            "sub_scores": dict(self.sub_scores),
            "reasons": list(self.reasons),
            "directory": self.directory,
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
                    directory=str(module_yaml.parent.relative_to(repo_root())),
                )
            )
        # Sort highest-scoring first.
        report.matches.sort(key=lambda m: m.score, reverse=True)

        # If no module's domain matches, the spec's domain is unmatched.
        if not any(m.score > 0.5 for m in report.matches):
            report.unmatched_requirements.append(
                f"No physics module found for domain {spec.model.domain!r}"
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

    # 5B.3 — I/O comparison: a species-domain spec wants a module with at
    # least one array-shaped output; we don't have a tight contract yet,
    # but presence of a module-level outputs list is a positive signal.
    outputs = metadata.get("outputs") or []
    if outputs:
        sub["io_match"] = 1.0
        reasons.append(f"module declares {len(outputs)} output port(s)")
    else:
        sub["io_match"] = 0.0
        reasons.append("module declares no outputs")

    # 5B.4 — Unit compatibility: every module output unit must be
    # parseable by pint. If any unit fails to parse, it's a mismatch.
    registry = get_registry()
    bad_units: list[str] = []
    for port in outputs:
        unit = port.get("units", "")
        if not unit:
            continue
        try:
            registry.parse_units(unit)
        except Exception:  # noqa: BLE001
            bad_units.append(unit)
    if bad_units:
        sub["unit_compat"] = 0.0
        reasons.append(f"unparseable unit(s): {bad_units!r}")
    else:
        sub["unit_compat"] = 1.0

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


__all__ = ["ModuleMatch", "ModuleMatchReport", "ModuleMatcher"]
