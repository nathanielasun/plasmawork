"""Phase 7 registry metadata integrity regressions."""

from __future__ import annotations

from pathlib import Path

import yaml
from simworkbench.model_spec import Geometry, Model, ModelSpec, Species
from simworkbench.modeling import ModuleMatcher
from simworkbench.units import Q

REPO_ROOT = Path(__file__).resolve().parents[2]
MODULES_ROOT = REPO_ROOT / "packages" / "physics_modules"


def test_phase_7b_plan_named_modules_exist():
    required = [
        "laser/gaussian_pulse",
        "laser/absorption",
        "laser/absorption_lambert_beer",
        "laser/emission",
        "laser/excitation",
        "laser/ionization",
        "laser/recombination",
        "species/electron_temperature",
        "species/species_density",
        "species/rate_equation_0d",
    ]
    missing = [
        rel for rel in required
        if not (MODULES_ROOT / rel / "module.yaml").is_file()
    ]
    assert not missing, f"Missing Phase 7B plan-named module(s): {missing}"


def test_phase_7b_plan_named_modules_have_required_artifacts():
    required_modules = [
        "laser/gaussian_pulse",
        "laser/absorption",
        "laser/absorption_lambert_beer",
        "laser/emission",
        "laser/excitation",
        "laser/ionization",
        "laser/recombination",
        "species/electron_temperature",
        "species/species_density",
        "species/rate_equation_0d",
    ]
    required_files = [
        "module.yaml",
        "README.md",
        "assumptions.md",
        "validity_domain.md",
        "equations.md",
        "changelog.md",
        "src/__init__.py",
    ]
    missing = []
    for rel in required_modules:
        root = MODULES_ROOT / rel
        for file in required_files:
            if not (root / file).is_file():
                missing.append(f"{rel}/{file}")
        if not (root / "tests").is_dir():
            missing.append(f"{rel}/tests/")
        if not (root / "benchmarks").is_dir():
            missing.append(f"{rel}/benchmarks/")
    assert not missing, "Incomplete Phase 7B module artifacts:\n" + "\n".join(missing)


def test_declared_module_tests_and_benchmark_artifacts_exist():
    missing: list[str] = []
    for module_yaml in sorted(MODULES_ROOT.glob("*/*/module.yaml")):
        metadata = yaml.safe_load(module_yaml.read_text(encoding="utf-8"))
        status = metadata.get("status")
        if status in {"validated", "trusted"}:
            for benchmark in metadata.get("benchmarks") or []:
                artifact = benchmark.get("artifact")
                if artifact and not (module_yaml.parent / artifact).is_file():
                    missing.append(f"{module_yaml}: benchmark {artifact}")

        tests = metadata.get("tests") or {}
        if isinstance(tests, dict):
            for group, paths in tests.items():
                if not isinstance(paths, list):
                    continue
                for rel in paths:
                    if not (
                        (module_yaml.parent / rel).is_file()
                        or (REPO_ROOT / rel).is_file()
                    ):
                        missing.append(f"{module_yaml}: {group} test {rel}")
    assert not missing, "Stale module metadata paths:\n" + "\n".join(missing)


def test_module_matcher_prefers_validated_at_equal_score(tmp_path):
    spec = ModelSpec(
        schema_version="0.1",
        model=Model(name="rank_probe", domain="species"),
        geometry=Geometry(dimensionality=0),
        species=[Species(name="A", type="atom", initial_density=Q(1, "1/m^3"))],
    )
    module_yaml = (
        "name: {name}\n"
        "version: 0.1.0\n"
        "domain: species\n"
        "status: {status}\n"
        "outputs:\n"
        "  - name: density\n"
        "    units: '1 / meter ** 3'\n"
    )
    # Lexicographic order puts the candidate first unless status is part of
    # the sort key.
    for dirname, name, status in [
        ("aaa_candidate", "same_score_candidate", "candidate"),
        ("zzz_validated", "same_score_validated", "validated"),
    ]:
        directory = tmp_path / "species" / dirname
        directory.mkdir(parents=True)
        (directory / "module.yaml").write_text(
            module_yaml.format(name=name, status=status),
            encoding="utf-8",
        )

    report = ModuleMatcher(modules_root=tmp_path).match(spec)
    assert report.matches[0].name == "same_score_validated"
    assert report.matches[0].module_status == "validated"
