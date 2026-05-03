"""Phase 2B — provenance.lock writer/reader tests."""

from __future__ import annotations

import pytest
from pydantic import ValidationError
from simworkbench.provenance import ProvenanceLock, load_lock, write_lock


def _sample_lock() -> ProvenanceLock:
    return ProvenanceLock(
        workbench_version="0.1.0",
        python_version="3.12.8",
        platform="macOS-15.2-arm64",
        capsule_format_version="0.1",
        run_id="abc123",
        base_seed=0,
        backend="python_cpu",
        model_spec_hash="deadbeef",
        placeholders=["A_to_B_photoexcitation"],
        created_at="2026-05-02T00:00:00.000000+00:00",
    )


def test_round_trip_through_toml(tmp_path):
    lock = _sample_lock()
    path = tmp_path / "provenance.lock"
    write_lock(lock, path)
    reloaded = load_lock(path)
    assert reloaded == lock


def test_extra_keys_rejected():
    """ConfigDict(extra="forbid") so typos fail loudly."""
    with pytest.raises(ValidationError):
        ProvenanceLock(
            workbench_version="0.1.0",
            python_version="3.12.8",
            platform="x",
            capsule_format_version="0.1",
            run_id="r",
            base_seed=0,
            backend="python_cpu",
            created_at="2026-05-02T00:00:00+00:00",
            mystery="oops",  # type: ignore[call-arg]
        )


def test_default_optional_fields(tmp_path):
    """parent_capsule_hash and model_spec_hash default to "" and []."""
    lock = ProvenanceLock(
        workbench_version="0.1.0",
        python_version="3.12.8",
        platform="x",
        capsule_format_version="0.1",
        run_id="r",
        base_seed=0,
        backend="python_cpu",
        created_at="2026-05-02T00:00:00+00:00",
    )
    assert lock.parent_capsule_hash == ""
    assert lock.placeholders == []


def test_writer_handles_special_chars(tmp_path):
    lock = _sample_lock()
    lock.platform = 'macOS with "quotes" and \\ backslash'
    path = tmp_path / "provenance.lock"
    write_lock(lock, path)
    reloaded = load_lock(path)
    assert reloaded.platform == 'macOS with "quotes" and \\ backslash'


def test_writer_handles_list_field(tmp_path):
    lock = _sample_lock()
    lock.placeholders = ["a", "b", "c"]
    path = tmp_path / "provenance.lock"
    write_lock(lock, path)
    reloaded = load_lock(path)
    assert reloaded.placeholders == ["a", "b", "c"]
