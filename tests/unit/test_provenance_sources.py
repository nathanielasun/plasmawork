"""Phase 2B — Source-file hash registry tests."""

from __future__ import annotations

import pytest
from simworkbench.provenance import FileHash, SourceRegistry


@pytest.fixture
def capsule_with_sources(tmp_path):
    """Build a tiny on-disk capsule structure with model/ and configs/ files."""
    capsule = tmp_path / "tiny.lxp"
    (capsule / "model").mkdir(parents=True)
    (capsule / "configs").mkdir(parents=True)
    (capsule / "src" / "generated").mkdir(parents=True)
    (capsule / "model" / "model_spec.yaml").write_text("hello\n")
    (capsule / "configs" / "run_config.yaml").write_text("backend: python_cpu\n")
    (capsule / "src" / "generated" / "runner.py").write_text("# stub\n")
    return capsule


def test_hash_files_returns_one_per_file(capsule_with_sources):
    registry = SourceRegistry(capsule_with_sources)
    hashes = registry.hash_files()
    paths = {h.path for h in hashes}
    assert paths == {
        "model/model_spec.yaml",
        "configs/run_config.yaml",
        "src/generated/runner.py",
    }


def test_hashes_are_stable_across_calls(capsule_with_sources):
    registry = SourceRegistry(capsule_with_sources)
    a = registry.hash_files()
    b = registry.hash_files()
    assert a == b


def test_hashes_change_when_content_changes(capsule_with_sources):
    registry = SourceRegistry(capsule_with_sources)
    before = {h.path: h.sha256 for h in registry.hash_files()}
    (capsule_with_sources / "model" / "model_spec.yaml").write_text("hello world\n")
    after = {h.path: h.sha256 for h in registry.hash_files()}
    assert before["model/model_spec.yaml"] != after["model/model_spec.yaml"]
    # Other files unchanged.
    assert before["configs/run_config.yaml"] == after["configs/run_config.yaml"]


def test_aggregate_hash_is_deterministic(capsule_with_sources):
    registry = SourceRegistry(capsule_with_sources)
    h1 = registry.aggregate_hash()
    h2 = registry.aggregate_hash()
    assert h1 == h2
    assert len(h1) == 64  # SHA-256 hex


def test_aggregate_hash_changes_with_any_file(capsule_with_sources):
    registry = SourceRegistry(capsule_with_sources)
    before = registry.aggregate_hash()
    (capsule_with_sources / "configs" / "run_config.yaml").write_text("backend: numba_cpu\n")
    after = registry.aggregate_hash()
    assert before != after


def test_find_missing_reports_missing_file(capsule_with_sources):
    registry = SourceRegistry(capsule_with_sources)
    expected = registry.hash_files()
    # Delete one.
    (capsule_with_sources / "model" / "model_spec.yaml").unlink()
    missing = registry.find_missing(expected)
    assert "model/model_spec.yaml" in missing


def test_find_missing_reports_hash_mismatch(capsule_with_sources):
    registry = SourceRegistry(capsule_with_sources)
    expected = registry.hash_files()
    # Modify one file.
    (capsule_with_sources / "configs" / "run_config.yaml").write_text("changed\n")
    missing = registry.find_missing(expected)
    assert "configs/run_config.yaml" in missing


def test_subtree_filter(capsule_with_sources):
    registry = SourceRegistry(capsule_with_sources)
    only_configs = registry.hash_files(subtrees=["configs"])
    assert {h.path for h in only_configs} == {"configs/run_config.yaml"}


def test_filehash_is_immutable():
    """FileHash dataclass is frozen so tampering during round-trip raises."""
    fh = FileHash(path="x", sha256="0" * 64, size_bytes=4)
    with pytest.raises(AttributeError):
        fh.sha256 = "1" * 64  # type: ignore[misc]
