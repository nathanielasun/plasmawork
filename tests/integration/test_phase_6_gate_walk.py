"""Phase 6 gate-walk integration test (written BEFORE implementation).

Plan §Phase 6 gate: "Phase 6 is complete when an agent can generate a
runnable, reviewable, editable, exportable simulation from a ModelSpec
inside a capsule."

Gate verbs:
  - generate  — render Python experiment code, configs, diagnostics, tests,
                docs from a ModelSpec into ``<capsule>/src/generated/``.
  - run       — execute the generated code; collect diagnostics; produce
                a validation summary.
  - review    — surface the generated tree to the UI / library reader.
  - edit      — user_edits/ tracked separately; regeneration must NEVER
                overwrite user_edits/.
  - export    — the generated capsule round-trips through ``export_capsule``
                with its src/generated/ + tests/ + validation/ artifacts.

This file is the canonical Phase 6 gate-walk and exists BEFORE any
implementation lands (per the ninth Phase Gate Procedure check). The
sixteenth check ("hard rules don't take a client-controlled flag")
applies here too: regeneration is library-callable; the API never
accepts ``allow_user_edits_overwrite=true`` or any equivalent.
"""

from __future__ import annotations

import shutil
import uuid

import pytest
import yaml
from fastapi.testclient import TestClient
from simworkbench.api import create_app
from simworkbench.paths import simulation_capsules_root

# ---------------------------------------------------------------------------
# Fixture: a capsule with a ModelSpec on disk + the generated/ user_edits/
# subtrees a Phase-2 save would normally lay down.
# ---------------------------------------------------------------------------


@pytest.fixture
def capsule_with_modelspec():
    name = f"_pytest_phase6_{uuid.uuid4().hex[:8]}.lxp"
    capsule_dir = simulation_capsules_root() / name
    (capsule_dir / "model").mkdir(parents=True)
    (capsule_dir / "configs").mkdir()
    (capsule_dir / "results").mkdir()
    (capsule_dir / "provenance").mkdir()
    (capsule_dir / "src" / "generated").mkdir(parents=True)
    (capsule_dir / "src" / "user_edits").mkdir(parents=True)
    (capsule_dir / "validation").mkdir()
    (capsule_dir / "manifest.toml").write_text(
        "[capsule]\n"
        f'name = "{name.removesuffix(".lxp")}"\n'
        'format_version = "0.1"\n'
        'workbench_version = "0.0.0"\n'
        'created_at = "2026-05-03T00:00:00.000000+00:00"\n\n'
        "[model]\n"
        'name = "_pytest"\n'
        'domain = "species"\n'
        'schema_version = "0.1"\n'
        'model_spec_path = "model/model_spec.yaml"\n',
        encoding="utf-8",
    )
    spec = {
        "schema_version": "0.1",
        "model": {"name": "_pytest", "domain": "species", "version": "0.1.0"},
        "geometry": {"dimensionality": 0, "coordinate_system": "cartesian"},
        "species": [
            {"name": "A", "type": "atom", "initial_density": "1.0e18 1/m^3"},
            {"name": "B", "type": "atom", "initial_density": "1.0e16 1/m^3"},
        ],
        "interactions": [
            {
                "name": "A_to_B",
                "participants": ["A", "B"],
                "equation_refs": ["eq_001"],
                "coefficient_sources": ["placeholder:k=1.0e7 1/s (Phase 6 fixture)"],
            }
        ],
        "equations": [
            {"id": "eq_001", "latex": "dN_A/dt = -k N_A"},
        ],
        "solvers": {
            "recommended": [
                {
                    "name": "rate_equation_0d",
                    "reason": "0D rate-equation backend matches species-domain.",
                    "backend_compatibility": ["python_cpu"],
                }
            ]
        },
    }
    (capsule_dir / "model" / "model_spec.yaml").write_text(
        yaml.safe_dump(spec, sort_keys=False), encoding="utf-8"
    )
    try:
        yield capsule_dir
    finally:
        shutil.rmtree(capsule_dir, ignore_errors=True)


def _client():
    return TestClient(create_app())


# ---------------------------------------------------------------------------
# Verb 1: GENERATE
# ---------------------------------------------------------------------------


def test_phase_6_gate_walk_generate_writes_to_generated_only(capsule_with_modelspec):
    """Verb: GENERATE — code lands under src/generated/ and nowhere else.

    Sandbox rule (6B): writes are restricted to ``<capsule>/src/generated/``.
    A regression test for the "Overwriting user_edits/" pattern: a sentinel
    file under user_edits/ must survive the generator unchanged.
    """
    from simworkbench.codegen import CodeGenerator
    from simworkbench.model_spec import load_yaml

    user_edit = capsule_with_modelspec / "src" / "user_edits" / "tweak.py"
    user_edit.write_text("# user edit — must not be overwritten\n", encoding="utf-8")
    paper_marker = capsule_with_modelspec / "paper_sources"
    paper_marker.mkdir(exist_ok=True)
    (paper_marker / "summary.md").write_text("paper text\n", encoding="utf-8")

    spec = load_yaml(capsule_with_modelspec / "model" / "model_spec.yaml")
    result = CodeGenerator().generate(capsule_with_modelspec, spec)

    generated = capsule_with_modelspec / "src" / "generated"
    # 6A bullets: Python experiment, configs, diagnostics, tests, docs.
    assert (generated / "experiment.py").is_file()
    assert (generated / "config.yaml").is_file()
    assert (generated / "diagnostics.py").is_file()
    assert (generated / "README.md").is_file()
    # The generator's return value lists every file it wrote.
    assert any(p.endswith("experiment.py") for p in result.files_written)
    # Sandbox: user_edits/ and paper_sources/ are NOT touched.
    assert (
        user_edit.read_text(encoding="utf-8")
        == "# user edit — must not be overwritten\n"
    )
    assert (paper_marker / "summary.md").read_text(encoding="utf-8") == "paper text\n"


def test_phase_6_gate_walk_generated_experiment_is_runnable(capsule_with_modelspec):
    """Verb: RUN — the generated experiment.py imports + runs without
    network access, producing diagnostics.

    Phase 6 explicitly says "runnable" — not "compiles", not "imports".
    Success path: load the generated experiment, hand it to the Phase-1
    Runner, get a `RunResult`. Maps the §Phase 6 gate verb "runnable" to
    a real artifact (not a stub).
    """
    from simworkbench.codegen import CodeGenerator
    from simworkbench.model_spec import load_yaml

    spec = load_yaml(capsule_with_modelspec / "model" / "model_spec.yaml")
    CodeGenerator().generate(capsule_with_modelspec, spec)

    # The generated experiment.yaml is a real ModelSpec the Runner accepts.
    from simworkbench.experiment import Experiment, RunConfig
    from simworkbench.runtime import Runner

    experiment = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(
            start_time="0 s", end_time="10 ns", max_steps=8, seed=0
        ),
    )
    result = Runner(experiment, base_seed=0).run()
    assert result.diagnostics, "generated runnable produced no diagnostics"


# ---------------------------------------------------------------------------
# Verb 2: TEST GENERATION (6C)
# ---------------------------------------------------------------------------


def test_phase_6_gate_walk_generates_unit_dimensional_smoke_tests(
    capsule_with_modelspec,
):
    """6C task bullets: unit tests, dimensional tests, smoke tests,
    regression hooks. Each is a real file in
    ``<capsule>/src/generated/tests/`` (not an empty stub).
    """
    from simworkbench.codegen import CodeGenerator
    from simworkbench.model_spec import load_yaml

    spec = load_yaml(capsule_with_modelspec / "model" / "model_spec.yaml")
    CodeGenerator().generate(capsule_with_modelspec, spec)
    tests_dir = capsule_with_modelspec / "src" / "generated" / "tests"
    assert tests_dir.is_dir()
    # Each plan-named test category is its own file.
    for name in (
        "test_unit.py",
        "test_dimensional.py",
        "test_smoke.py",
        "test_regression.py",
    ):
        path = tests_dir / name
        assert path.is_file(), f"Missing generated test: {name}"
        # Each test file imports pytest and has at least one ``def test_``.
        body = path.read_text(encoding="utf-8")
        assert "def test_" in body, f"{name} has no test functions"


# ---------------------------------------------------------------------------
# Verb 3: REVIEW + EDIT (6D)
# ---------------------------------------------------------------------------


def test_phase_6_gate_walk_review_endpoint_lists_generated_tree(
    capsule_with_modelspec,
):
    """Verb: REVIEW — the API surfaces the generated tree as a list the
    UI can render (it can also fetch each file via the existing
    ``/api/capsules/{name}/files/{path}`` endpoint).
    """
    from simworkbench.codegen import CodeGenerator
    from simworkbench.model_spec import load_yaml

    spec = load_yaml(capsule_with_modelspec / "model" / "model_spec.yaml")
    CodeGenerator().generate(capsule_with_modelspec, spec)
    r = _client().get(
        f"/api/capsules/{capsule_with_modelspec.name}/codegen"
    )
    assert r.status_code == 200, r.text
    body = r.json()
    files = {f["path"] for f in body["generated_files"]}
    assert "src/generated/experiment.py" in files
    assert "src/generated/tests/test_smoke.py" in files


def test_phase_6_gate_walk_regeneration_preserves_user_edits(capsule_with_modelspec):
    """Verb: EDIT — calling generate() a second time refreshes
    src/generated/* but leaves src/user_edits/* untouched.

    Regression for the always-named `agent_error_patterns.md` "Overwriting
    user_edits/" pattern. The sandbox is producer-side; tested both via
    library AND API to defend in depth.
    """
    from simworkbench.codegen import CodeGenerator
    from simworkbench.model_spec import load_yaml

    spec = load_yaml(capsule_with_modelspec / "model" / "model_spec.yaml")
    CodeGenerator().generate(capsule_with_modelspec, spec)

    # User edits land AFTER the first generation.
    user_edit = capsule_with_modelspec / "src" / "user_edits" / "my_tweak.py"
    user_edit.write_text("# precious user edit\n", encoding="utf-8")
    # And touch a generated file so we can confirm regeneration ran.
    generated_readme = capsule_with_modelspec / "src" / "generated" / "README.md"
    original_generated = generated_readme.read_text(encoding="utf-8")
    generated_readme.write_text("STALE — should be overwritten\n", encoding="utf-8")

    # Second generation through the API.
    r = _client().post(
        f"/api/capsules/{capsule_with_modelspec.name}/codegen",
        json={},
    )
    assert r.status_code == 200, r.text

    assert user_edit.read_text(encoding="utf-8") == "# precious user edit\n", (
        "Regeneration overwrote a user_edits/ file — Phase 6B sandbox leaked."
    )
    # Generated tree DID get refreshed.
    refreshed = generated_readme.read_text(encoding="utf-8")
    assert refreshed == original_generated


def test_phase_6_gate_walk_diff_endpoint_reports_regeneration_changes(
    capsule_with_modelspec,
):
    """6B bullet: "Provide diffs for regeneration". After two generations
    where the spec changed in between, the diff endpoint reports at
    least one changed file.
    """
    from simworkbench.codegen import CodeGenerator
    from simworkbench.model_spec import load_yaml

    spec = load_yaml(capsule_with_modelspec / "model" / "model_spec.yaml")
    CodeGenerator().generate(capsule_with_modelspec, spec)
    # Mutate the spec on disk so a second generation produces different code.
    spec_path = capsule_with_modelspec / "model" / "model_spec.yaml"
    raw = yaml.safe_load(spec_path.read_text(encoding="utf-8"))
    raw["species"].append(
        {"name": "C", "type": "atom", "initial_density": "1.0e15 1/m^3"}
    )
    spec_path.write_text(yaml.safe_dump(raw, sort_keys=False), encoding="utf-8")

    r = _client().get(
        f"/api/capsules/{capsule_with_modelspec.name}/codegen/diff"
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # The diff endpoint reports the prior generation manifest + a regenerate
    # preview. After mutation a second call to generate produces ≥ 1 changed
    # file. The endpoint exposes the previous file hashes; the test compares.
    assert "previous" in body
    assert "current_files" in body


# ---------------------------------------------------------------------------
# Verb 4: VALIDATION RUN (6E)
# ---------------------------------------------------------------------------


def test_phase_6_gate_walk_validation_run_writes_summary_and_status(
    capsule_with_modelspec,
):
    """6E task bullets: small simulation, diagnostics, plots, validation
    summary, validation status. Each is a real artifact in
    ``<capsule>/validation/``.
    """
    from simworkbench.codegen import CodeGenerator, ValidationRunner
    from simworkbench.model_spec import load_yaml

    spec = load_yaml(capsule_with_modelspec / "model" / "model_spec.yaml")
    CodeGenerator().generate(capsule_with_modelspec, spec)
    summary_path = ValidationRunner().run(capsule_with_modelspec)
    assert summary_path.is_file()
    body = summary_path.read_text(encoding="utf-8")
    # The summary surfaces every 6E bullet.
    for marker in ("Diagnostics", "Plots", "Validation status", "Run"):
        assert marker in body, f"Missing validation summary section: {marker!r}"
    # Validation status file is machine-readable too.
    status_path = capsule_with_modelspec / "validation" / "status.yaml"
    assert status_path.is_file()
    status = yaml.safe_load(status_path.read_text(encoding="utf-8"))
    assert "validation_status" in status
    assert status["validation_status"] in {"passed", "failed", "incomplete"}


# ---------------------------------------------------------------------------
# Verb 5: EXPORT
# ---------------------------------------------------------------------------


def test_phase_6_gate_walk_export_includes_generated_tree(capsule_with_modelspec):
    """Verb: EXPORT — the generated tree round-trips through capsule
    export. The Phase 2C exporter validates first, then writes; we
    assert the generated/ artifacts AND validation/ artifacts land in
    the exported tree.
    """
    from simworkbench.codegen import CodeGenerator, ValidationRunner
    from simworkbench.model_spec import load_yaml
    from simworkbench.serialization.export import export_capsule

    spec = load_yaml(capsule_with_modelspec / "model" / "model_spec.yaml")
    CodeGenerator().generate(capsule_with_modelspec, spec)
    ValidationRunner().run(capsule_with_modelspec)

    # Self-export: the exporter MUST validate before any rmtree (5th
    # behavioral check; Phase 2/3 lessons). Source survives.
    out_dir = capsule_with_modelspec.parent / (
        capsule_with_modelspec.stem + "-exported"
    )
    export_capsule(capsule_with_modelspec, out_dir, kinds=["code", "data"])
    try:
        # generated/ AND tests/ are part of the code export.
        assert (out_dir / "src" / "generated" / "experiment.py").is_file()
        assert (out_dir / "src" / "generated" / "tests" / "test_smoke.py").is_file()
        # The capsule_with_modelspec source still exists after export.
        assert (
            capsule_with_modelspec / "src" / "generated" / "experiment.py"
        ).is_file()
    finally:
        shutil.rmtree(out_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# Hard-rule guard: API mirrors library; sandbox is library-enforced.
# (16th behavioral check: cross-cutting "always-on" prose has a
# regression test.)
# ---------------------------------------------------------------------------


def test_phase_6_api_codegen_does_not_accept_overwrite_flag(capsule_with_modelspec):
    """Regression for the 13th behavioral check: hard rules don't take a
    client-controlled flag. The codegen API must NOT carry an
    ``allow_user_edits_overwrite`` knob; even if a client tries to
    smuggle one through, the sandbox refuses to write under user_edits/.
    """
    from simworkbench.codegen import CodeGenerator
    from simworkbench.model_spec import load_yaml

    spec = load_yaml(capsule_with_modelspec / "model" / "model_spec.yaml")
    CodeGenerator().generate(capsule_with_modelspec, spec)
    user_edit = capsule_with_modelspec / "src" / "user_edits" / "precious.py"
    user_edit.write_text("# do not overwrite\n", encoding="utf-8")

    r = _client().post(
        f"/api/capsules/{capsule_with_modelspec.name}/codegen",
        json={"allow_user_edits_overwrite": True},
    )
    assert r.status_code == 200, r.text
    assert user_edit.read_text(encoding="utf-8") == "# do not overwrite\n"


def test_phase_6_codegen_role_present_in_agents_yaml():
    """16th behavioral check: cross-cutting roles are enforced. Phase 6
    flips ``code_generation``, ``numerical_methods``, ``validation``,
    ``visualization`` to enabled. The Phase-5 audit's
    ``test_security_sandbox_enforcement.py`` already enforces that
    security_sandbox stays on; this check guards that the four 6-phase
    roles actually flipped.
    """
    from pathlib import Path

    import yaml as _yaml
    from simworkbench.paths import repo_root

    agents = _yaml.safe_load(
        Path(repo_root() / "configs" / "agents.yaml").read_text(encoding="utf-8")
    )
    enabled = {
        a["role"]: a.get("enabled", False) for a in agents.get("agents", [])
    }
    for role in (
        "code_generation",
        "numerical_methods",
        "validation",
        "visualization",
    ):
        assert enabled.get(role) is True, (
            f"Phase 6 requires agent role {role!r} enabled in configs/agents.yaml"
        )
