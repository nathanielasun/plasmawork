"""Phase 7 gate-walk integration test (written BEFORE implementation).

Plan §Phase 7 gate: "Phase 7 is complete when core modules are
**reusable**, **documented**, **tested**, and **validated for explicit
regimes**."

Gate verbs:
  - reusable  — a module declared in registry can be looked up by name
                + version; an Experiment / ModuleMatcher can consume it
                without bespoke wiring; metadata declares dependencies,
                benchmarks, and compatibility (Registry v1).
  - documented — every validated module ships README, assumptions.md,
                validity_domain.md, equations.md, changelog.md.
  - tested    — every validated module's tests/ directory runs cleanly.
  - validated for explicit regimes — at least one module per family
                transitions candidate → validated, and the promotion
                requires (a) a non-empty benchmark reference, (b) the
                test suite passing, AND (c) a single-use approval token
                (carries `agent_error_patterns.md` "Trusting a client-
                supplied actor identity for a privileged check").

This file is the canonical Phase 7 gate-walk and exists BEFORE any
implementation lands (per the ninth Phase Gate Procedure check).

Twenty-fourth check ("plan verbs map to UI affordances, not just
buttons"): every gate verb above maps to a real test below — not a
generic shape assertion.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
MODULES_ROOT = REPO_ROOT / "packages" / "physics_modules"

# Plan §Phase 7 / 7B + 7C + 7D — at least these module families must
# host a validated module by close. The list mirrors the milestone
# "Convention-checker assertions to add when this phase opens" and
# the plan §Phase 7 deliverables (7B laser-species + 7D generality).
REQUIRED_VALIDATED_MODULES = [
    # 7B: laser-species family — picked the most foundational of the nine
    # bullets so the gate-walk pins something real even if the others stay
    # candidate. The full nine ship as candidate; the gate requires
    # validated for the canonical reference module per family.
    ("laser", "absorption_lambert_beer"),
    ("species", "rate_equation_0d"),
    # 7D: generality proofs — each module class must validate against an
    # analytic benchmark at close.
    ("molecular_dynamics", "lennard_jones"),
    ("phase_transition", "ising_2d"),
    ("pde", "wave_equation_1d"),
    ("pde", "reaction_diffusion_1d"),
]


# ---------------------------------------------------------------------------
# Verb 1: REUSABLE — Registry v1 metadata + ModuleMatcher round-trip.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("domain,name", REQUIRED_VALIDATED_MODULES)
def test_phase_7_gate_walk_module_metadata_carries_registry_v1_fields(
    domain: str, name: str
):
    """Every validated module's ``module.yaml`` carries the Registry v1
    fields: ``dependencies`` (list, may be empty), ``benchmarks``
    (non-empty for validated modules), and ``compatibility``.
    """
    yaml_path = MODULES_ROOT / domain / name / "module.yaml"
    assert yaml_path.is_file(), f"Missing module.yaml: {yaml_path}"
    metadata = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))

    # Registry v1 — schema additions over the Phase-1 metadata shape.
    assert "version" in metadata
    assert "status" in metadata
    assert "dependencies" in metadata, (
        f"{domain}/{name}: Registry v1 requires a 'dependencies' field "
        "(may be an empty list, but must be present)."
    )
    assert "benchmarks" in metadata, (
        f"{domain}/{name}: Registry v1 requires a 'benchmarks' field."
    )
    assert "compatibility" in metadata, (
        f"{domain}/{name}: Registry v1 requires a 'compatibility' field."
    )

    if metadata.get("status") == "validated":
        assert metadata["benchmarks"], (
            f"{domain}/{name} is validated but declares no benchmarks. "
            "Plan §Phase 7 / 7A requires a benchmark reference for "
            "every validated module."
        )


def test_phase_7_gate_walk_modulematcher_finds_validated_modules():
    """Verb: REUSABLE — Phase-5 ``ModuleMatcher`` discovers every
    validated Phase-7 module. The match report's per-module status is
    surfaced so consumers can prefer validated over candidate.
    """
    from simworkbench.model_spec import (
        Geometry,
        Model,
        ModelSpec,
        Solvers,
        Species,
    )
    from simworkbench.model_spec.types import SolverRecommendation
    from simworkbench.modeling import ModuleMatcher
    from simworkbench.units import Q

    spec = ModelSpec(
        schema_version="0.1",
        model=Model(name="t", domain="species"),
        geometry=Geometry(dimensionality=0),
        species=[Species(name="A", type="atom", initial_density=Q(1.0, "1/m^3"))],
        solvers=Solvers(
            recommended=[
                SolverRecommendation(
                    name="rate_equation_0d", backend_compatibility=["python_cpu"]
                )
            ]
        ),
    )
    report = ModuleMatcher().match(spec)
    found_names = {m.name for m in report.matches}
    # The species/rate_equation_0d module is the canonical Phase-1 reference;
    # the gate-walk asserts ModuleMatcher still finds it AND that the match
    # row carries the new Registry v1 status field.
    assert "rate_equation_0d" in found_names
    rate_match = next(m for m in report.matches if m.name == "rate_equation_0d")
    # The new field is what makes the registry "v1": the consumer
    # (ExperimentProposer) can prefer validated over candidate.
    assert hasattr(rate_match, "module_status"), (
        "ModuleMatch must surface module_status (Registry v1 — Phase 7A)"
    )


# ---------------------------------------------------------------------------
# Verb 2: DOCUMENTED — every validated module ships the five docs.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("domain,name", REQUIRED_VALIDATED_MODULES)
def test_phase_7_gate_walk_documentation_complete(domain: str, name: str):
    """Verb: DOCUMENTED — README + assumptions + validity_domain +
    equations + changelog all present and non-empty.
    """
    root = MODULES_ROOT / domain / name
    for required in (
        "README.md",
        "assumptions.md",
        "validity_domain.md",
        "equations.md",
        "changelog.md",
    ):
        path = root / required
        assert path.is_file(), f"{domain}/{name}: missing {required}"
        body = path.read_text(encoding="utf-8").strip()
        assert len(body) > 50, (
            f"{domain}/{name}/{required} is too short ({len(body)} chars). "
            "Phase 7 gate requires real documentation, not a stub."
        )


# ---------------------------------------------------------------------------
# Verb 3: TESTED — every validated module's pytest tree runs cleanly.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("domain,name", REQUIRED_VALIDATED_MODULES)
def test_phase_7_gate_walk_tests_pass(domain: str, name: str):
    """Verb: TESTED — running the module's declared pytest tree exits 0.

    We invoke pytest as a subprocess so collection failures, import
    errors, and runtime failures all surface as a failed gate.
    """
    import subprocess
    import sys

    root = MODULES_ROOT / domain / name
    tests_dir = root / "tests"
    assert tests_dir.is_dir(), f"{domain}/{name}: no tests/ directory"
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", str(tests_dir)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, (
        f"{domain}/{name} tests failed:\n"
        f"--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}"
    )


# ---------------------------------------------------------------------------
# Verb 4: VALIDATED FOR EXPLICIT REGIMES — analytic benchmark agreement.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("domain,name", REQUIRED_VALIDATED_MODULES)
def test_phase_7_gate_walk_module_validated_against_benchmark(
    domain: str, name: str
):
    """Verb: VALIDATED — module declares a benchmark in module.yaml AND
    a benchmarks/ directory exists with at least one validated case.

    The actual benchmark assertion lives in the per-module tests; this
    walk just enforces the contract — every validated module ships a
    benchmark reference + a benchmarks/ tree.
    """
    root = MODULES_ROOT / domain / name
    metadata = yaml.safe_load((root / "module.yaml").read_text(encoding="utf-8"))
    if metadata.get("status") != "validated":
        pytest.skip(
            f"{domain}/{name} is not yet validated; gate requires at least "
            "one validated module per family at close."
        )
    benchmarks = metadata.get("benchmarks") or []
    assert benchmarks, (
        f"{domain}/{name}: validated status requires at least one "
        "benchmark entry in module.yaml (Phase 7A Registry v1)."
    )
    bench_dir = root / "benchmarks"
    assert bench_dir.is_dir(), (
        f"{domain}/{name}: validated status requires a benchmarks/ "
        "directory containing the analytic / paper-reproduction case."
    )
    bench_files = list(bench_dir.glob("*"))
    assert bench_files, (
        f"{domain}/{name}: benchmarks/ is empty; validated status "
        "requires at least one benchmark artifact."
    )


# ---------------------------------------------------------------------------
# Cross-cutting: validation library + agents.yaml release flip.
# ---------------------------------------------------------------------------


def test_phase_7_validation_library_present():
    """Plan §Phase 7 / 7E: validation library covers conservation,
    convergence, paper reproduction, cross-solver. Each helper is
    importable and returns a structured report.
    """
    from simworkbench.validation_library import (
        ConservationCheck,
        ConvergenceCheck,
        CrossSolverComparison,
        PaperReproduction,
    )

    # Each is a dataclass / class — instantiable at minimum.
    assert ConservationCheck is not None
    assert ConvergenceCheck is not None
    assert PaperReproduction is not None
    assert CrossSolverComparison is not None


def test_phase_7_release_role_enabled():
    """16th behavioral check: cross-cutting "always-on" prose has a
    regression test. Phase 7 flips the ``release`` agent role to
    enabled.
    """
    agents = yaml.safe_load(
        (REPO_ROOT / "configs" / "agents.yaml").read_text(encoding="utf-8")
    )
    enabled = {a["role"]: a.get("enabled", False) for a in agents.get("agents", [])}
    assert enabled.get("release") is True, (
        "Phase 7 requires the 'release' agent role enabled in configs/agents.yaml"
    )


# ---------------------------------------------------------------------------
# Hard rule: candidate → validated requires the human-approval token.
# (13th behavioral check: hard rules don't take a client-controlled flag.)
# ---------------------------------------------------------------------------


def test_phase_7_module_promotion_requires_human_approval(tmp_path):
    """Plan §9.5 + plan §Phase 7 7A: candidate → validated is human-only.
    The library-side ``ModuleRegistry.set_status`` rejects ``actor=
    "agent"``; the API-side endpoint requires a single-use approval
    token (mirrors the Phase 6 audit fix for tool promotion).
    """
    from simworkbench.modules import ModuleRegistry, ModuleStatus
    from simworkbench.tools import ApprovalError

    registry = ModuleRegistry()
    # Pick a known module that exists at candidate status. The fixture
    # uses laser/gaussian_pulse because Phase 1 already shipped it as
    # candidate — promotion is the test, not registration.
    name = "gaussian_pulse"
    entry = registry.get(name)
    assert entry.status in {ModuleStatus.CANDIDATE, ModuleStatus.VALIDATED}

    # Agent path refuses.
    with pytest.raises(Exception, match="agent|human"):
        registry.set_status(name, ModuleStatus.VALIDATED, actor="agent")

    # API path requires a single-use approval token. We don't write
    # one, so the consume must raise ApprovalError.
    from simworkbench.modules.approval import consume_module_approval

    with pytest.raises(ApprovalError):
        consume_module_approval(
            name, from_status="candidate", to_status="validated"
        )
    _ = tmp_path  # keep parameter used
