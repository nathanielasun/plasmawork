"""Phase 2A — Manifest schema tests."""

from __future__ import annotations

import pytest
from simworkbench.serialization.manifest import (
    CAPSULE_FORMAT_VERSION,
    CapsuleSection,
    Manifest,
    ModelSection,
    RuntimeSection,
    load_manifest,
    write_manifest,
)


def _sample_manifest() -> Manifest:
    return Manifest(
        capsule=CapsuleSection(
            name="example",
            workbench_version="0.1.0",
            created_at="2026-05-02T00:00:00.000000+00:00",
        ),
        model=ModelSection(name="m", domain="laser_species", schema_version="0.1"),
        runtime=RuntimeSection(
            backend="python_cpu",
            default_seed=0,
            final_state="completed",
            final_simulation_time_seconds=1.0e-7,
            elapsed_seconds=0.05,
            placeholder_used=True,
            placeholders=["A_to_B_photoexcitation"],
        ),
    )


def test_manifest_round_trip_through_toml(tmp_path):
    m = _sample_manifest()
    write_manifest(m, tmp_path / "manifest.toml")
    reloaded = load_manifest(tmp_path / "manifest.toml")
    assert reloaded.capsule.name == "example"
    assert reloaded.capsule.format_version == CAPSULE_FORMAT_VERSION
    assert reloaded.runtime.backend == "python_cpu"
    assert reloaded.runtime.placeholder_used is True
    assert reloaded.runtime.placeholders == ["A_to_B_photoexcitation"]


def test_manifest_rejects_unsupported_format_version():
    with pytest.raises(ValueError, match="not supported"):
        Manifest(
            capsule=CapsuleSection(
                name="x",
                format_version="99.0",
                workbench_version="0.1.0",
                created_at="2026-05-02T00:00:00+00:00",
            ),
            model=ModelSection(name="m", domain="d", schema_version="0.1"),
            runtime=RuntimeSection(
                backend="python_cpu",
                default_seed=0,
                final_state="completed",
                final_simulation_time_seconds=0.0,
                elapsed_seconds=0.0,
            ),
        )


def test_manifest_extra_keys_rejected():
    """Capsule sections use ConfigDict(extra="forbid"); typos must fail.

    Asserts ``ValidationError`` specifically (Pydantic v2's structured error)
    rather than blind Exception so the test fails for the right reason.
    """
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        CapsuleSection(
            name="x",
            workbench_version="0.1.0",
            created_at="2026-05-02T00:00:00+00:00",
            myster_field="oops",  # type: ignore[call-arg]
        )


def test_manifest_default_provenance_section():
    m = _sample_manifest()
    assert m.provenance.lockfile == "provenance/provenance.lock"
    assert m.provenance.agent_trace == "provenance/agent_trace.md"
    assert m.provenance.parent_capsule_hash == ""


def test_manifest_paper_section_optional():
    m = _sample_manifest()
    assert m.paper.title == ""
    assert m.paper.doi == ""


def test_write_manifest_emits_quoted_strings(tmp_path):
    m = _sample_manifest()
    write_manifest(m, tmp_path / "manifest.toml")
    text = (tmp_path / "manifest.toml").read_text(encoding="utf-8")
    assert 'name = "example"' in text
    assert 'backend = "python_cpu"' in text
    assert "placeholder_used = true" in text


def test_write_manifest_round_trip_with_special_chars(tmp_path):
    m = _sample_manifest()
    m.paper.title = 'Title with "quotes" and a \\ backslash'
    write_manifest(m, tmp_path / "manifest.toml")
    reloaded = load_manifest(tmp_path / "manifest.toml")
    assert reloaded.paper.title == 'Title with "quotes" and a \\ backslash'
