"""Regression for two Phase-6 audit findings:

  1. "Generator skips cleanup, leaving stale artifacts" — regenerating
     after a spec change leaves orphans behind under
     ``<capsule>/src/generated/``.
  2. "Diff endpoint that doesn't compute a diff" — the endpoint
     returned manifest + hashes only; the caller had to compute the
     diff. The test that asserted "regeneration changes" only checked
     for key presence.

Both fixes ship together because the cleanup path uses the prior
manifest and the diff endpoint compares against it; testing them in
one file keeps the contract obvious.
"""

from __future__ import annotations

import shutil
import uuid

import pytest
import yaml
from fastapi.testclient import TestClient
from simworkbench.api import create_app
from simworkbench.codegen import CodeGenerator
from simworkbench.model_spec import load_yaml as load_modelspec_yaml
from simworkbench.paths import simulation_capsules_root


@pytest.fixture
def capsule_with_spec():
    name = f"_pytest_codegen_clean_{uuid.uuid4().hex[:8]}.lxp"
    target = simulation_capsules_root() / name
    (target / "model").mkdir(parents=True)
    (target / "src" / "generated").mkdir(parents=True)
    (target / "src" / "user_edits").mkdir(parents=True)
    (target / "model" / "model_spec.yaml").write_text(
        yaml.safe_dump(
            {
                "schema_version": "0.1",
                "model": {"name": "demo", "domain": "species", "version": "0.1.0"},
                "geometry": {"dimensionality": 0, "coordinate_system": "cartesian"},
                "species": [
                    {"name": "A", "type": "atom", "initial_density": "1e16 1/m^3"},
                    {"name": "B", "type": "atom", "initial_density": "1e15 1/m^3"},
                ],
                "interactions": [
                    {
                        "name": "A_to_B",
                        "participants": ["A", "B"],
                        "equation_refs": ["eq"],
                        "coefficient_sources": ["placeholder:k=1.0e7 1/s"],
                    }
                ],
                "equations": [{"id": "eq", "latex": "dN/dt = -k N"}],
                "solvers": {
                    "recommended": [
                        {
                            "name": "rate_equation_0d",
                            "reason": "0D",
                            "backend_compatibility": ["python_cpu"],
                        }
                    ]
                },
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    try:
        yield target
    finally:
        shutil.rmtree(target, ignore_errors=True)


def test_regeneration_removes_orphan_files(capsule_with_spec):
    """A stale file under src/generated/ that the prior manifest tracked
    but the current run no longer produces must be deleted on
    regenerate. We plant an orphan via a faked prior manifest entry,
    then regenerate."""
    spec = load_modelspec_yaml(capsule_with_spec / "model" / "model_spec.yaml")
    # First generation: real prior state.
    CodeGenerator().generate(capsule_with_spec, spec)

    # Plant an orphan: a file the manifest claims is part of the prior
    # generation but the next CodeGenerator run won't write.
    orphan_rel = "src/generated/tests/test_legacy_convergence.py"
    orphan = capsule_with_spec / orphan_rel
    orphan.parent.mkdir(parents=True, exist_ok=True)
    orphan.write_text("# stale generated file\n", encoding="utf-8")
    import json as _json

    manifest_path = capsule_with_spec / "src" / "generated" / "codegen_manifest.json"
    manifest = _json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["files"].append({"path": orphan_rel, "sha256": "x" * 64})
    manifest_path.write_text(
        _json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )

    # Regenerate. The orphan must be cleaned up.
    result = CodeGenerator().generate(capsule_with_spec, spec)
    assert not orphan.exists(), (
        "Stale generated file survived regeneration. "
        f"removed_files={result.removed_files}"
    )
    assert orphan_rel in result.removed_files


def test_diff_endpoint_returns_added_removed_changed(capsule_with_spec):
    """The endpoint computes a real diff — added / removed / changed
    populated based on the upcoming preview vs prior manifest."""
    spec = load_modelspec_yaml(capsule_with_spec / "model" / "model_spec.yaml")
    CodeGenerator().generate(capsule_with_spec, spec)

    # Mutate spec so the next generation produces different tests
    # (drop a species so test_unit.py changes).
    spec_path = capsule_with_spec / "model" / "model_spec.yaml"
    raw = yaml.safe_load(spec_path.read_text(encoding="utf-8"))
    raw["species"] = [raw["species"][0]]
    raw["interactions"] = []
    spec_path.write_text(yaml.safe_dump(raw, sort_keys=False), encoding="utf-8")

    client = TestClient(create_app())
    r = client.get(f"/api/capsules/{capsule_with_spec.name}/codegen/diff")
    assert r.status_code == 200, r.text
    body = r.json()
    # All four lists are present.
    for key in ("added", "removed", "changed", "unchanged"):
        assert key in body, f"Missing diff field: {key}"
    # Dropping a species changes test_unit.py contents.
    assert any(
        path.endswith("test_unit.py") for path in body["changed"]
    ), f"Expected test_unit.py in changed list; got changed={body['changed']}"


def test_diff_endpoint_does_not_mutate_disk(capsule_with_spec):
    """The diff is a preview — calling /diff must NOT change the
    capsule's actual generated tree."""
    spec = load_modelspec_yaml(capsule_with_spec / "model" / "model_spec.yaml")
    CodeGenerator().generate(capsule_with_spec, spec)
    snapshot = {
        p.name: p.read_text(encoding="utf-8")
        for p in (capsule_with_spec / "src" / "generated").glob("*.py")
    }
    client = TestClient(create_app())
    r = client.get(f"/api/capsules/{capsule_with_spec.name}/codegen/diff")
    assert r.status_code == 200
    after = {
        p.name: p.read_text(encoding="utf-8")
        for p in (capsule_with_spec / "src" / "generated").glob("*.py")
    }
    assert snapshot == after, "diff endpoint mutated the capsule's generated tree"
