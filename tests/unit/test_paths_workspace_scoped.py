"""Phase 0.5 auth gateway / Phase E (2026-05-09).

Pin the workspace-scoped path helpers added to
``simworkbench.paths`` so the FastAPI workbench can isolate capsule /
temp-run / temp-import storage by workspace slug:

    simulation_capsules_root_for(workspace_slug)
    temp_runs_root_for(workspace_slug)
    temp_imports_root_for(workspace_slug)

These tests also pin the slug-validator alphabet so a tampered slug
from a request body or query string can't traverse out of the
workspace prefix.
"""

from __future__ import annotations

from pathlib import Path

import pytest

import simworkbench.paths as paths


def test_simulation_capsules_root_for_appends_slug():
    out = paths.simulation_capsules_root_for("shared-public-experiments")
    assert out == paths.simulation_capsules_root() / "shared-public-experiments"
    assert out.is_dir()


def test_temp_runs_root_for_appends_slug():
    out = paths.temp_runs_root_for("shared-public-experiments")
    assert out == paths.temp_runs_root() / "shared-public-experiments"
    assert out.is_dir()


def test_temp_imports_root_for_appends_slug():
    out = paths.temp_imports_root_for("shared-public-experiments")
    assert out == paths.temp_imports_root() / "shared-public-experiments"
    assert out.is_dir()


def test_slug_validator_accepts_alphanumeric_and_underscore_and_hyphen():
    # Smallest valid slug (3 chars) and largest valid (64 chars).
    paths.simulation_capsules_root_for("abc")
    paths.simulation_capsules_root_for("a" * 64)
    paths.simulation_capsules_root_for("rootadmin42x9k")
    paths.simulation_capsules_root_for("shared_internal_tools")


@pytest.mark.parametrize(
    "bad_slug",
    [
        "",  # empty
        "ab",  # too short
        "a" * 65,  # too long
        "with spaces",
        "../etc",
        "trailing/",
        "trailing.",
        "with$dollar",
        "with/slash",
        "with..dots",
        "with\nnewline",
    ],
)
def test_slug_validator_refuses_unsafe_input(bad_slug: str):
    with pytest.raises(ValueError):
        paths.simulation_capsules_root_for(bad_slug)


def test_slug_validator_refuses_non_string_input():
    with pytest.raises(ValueError):
        paths.simulation_capsules_root_for(123)  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        paths.simulation_capsules_root_for(None)  # type: ignore[arg-type]


def test_workspace_root_is_under_workbench():
    """The workspace-scoped root MUST land inside the
    `simulation_capsules_root()` parent — it's a defense-in-depth
    invariant that ``is_under_workbench`` consumers rely on."""
    p = paths.simulation_capsules_root_for("shared-public-experiments")
    assert paths.is_under_workbench(p)
    assert Path(p).resolve().is_relative_to(
        paths.simulation_capsules_root().resolve()
    )
