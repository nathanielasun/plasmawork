"""Phase 1D — Smoke test for the module template.

Real modules add a much richer test suite. The template's test exists only so
the convention checker has something to assert, and so a copy-and-adapt
workflow doesn't accidentally start with empty tests.
"""

from __future__ import annotations

import pytest


def test_template_is_importable():
    """The module template is importable as a Python package."""
    pytest.importorskip("simworkbench.units")
    # We don't import the template itself by package name (it's not on the
    # Python path), so just assert the dependency exists.
    from simworkbench.units import Q
    assert Q(1.0, "joule").magnitude == 1.0
