"""Phase 3A — Tool lifecycle state-machine tests."""

from __future__ import annotations

import pytest
from simworkbench.tools import (
    LifecycleError,
    ToolStatus,
    can_transition,
    require_transition,
)


def test_lifecycle_states_match_plan():
    """Plan §9.5 enumerates exactly five states."""
    assert {s.value for s in ToolStatus} == {
        "draft",
        "candidate",
        "validated",
        "trusted",
        "deprecated",
    }


def test_forward_transitions_allowed():
    assert can_transition(ToolStatus.DRAFT, ToolStatus.CANDIDATE)
    assert can_transition(ToolStatus.CANDIDATE, ToolStatus.VALIDATED)
    assert can_transition(ToolStatus.VALIDATED, ToolStatus.TRUSTED)


def test_backward_transitions_refused():
    """draft → candidate is allowed; candidate → draft is not."""
    assert not can_transition(ToolStatus.CANDIDATE, ToolStatus.DRAFT)
    with pytest.raises(LifecycleError, match="Illegal"):
        require_transition(ToolStatus.CANDIDATE, ToolStatus.DRAFT, actor="human")


def test_skipping_states_refused():
    """candidate → trusted (skipping validated) is refused."""
    assert not can_transition(ToolStatus.CANDIDATE, ToolStatus.TRUSTED)
    with pytest.raises(LifecycleError, match="Illegal"):
        require_transition(ToolStatus.CANDIDATE, ToolStatus.TRUSTED, actor="human")


def test_deprecated_is_terminal():
    """Once deprecated, no further transitions."""
    for target in ToolStatus:
        assert not can_transition(ToolStatus.DEPRECATED, target)


def test_any_state_can_be_deprecated():
    """Deprecation is always allowed (any state → deprecated)."""
    for source in (
        ToolStatus.DRAFT,
        ToolStatus.CANDIDATE,
        ToolStatus.VALIDATED,
        ToolStatus.TRUSTED,
    ):
        assert can_transition(source, ToolStatus.DEPRECATED)


def test_agent_cannot_promote_to_validated_or_trusted():
    """Plan §9.5 — agents may produce draft/candidate but not validated/trusted."""
    with pytest.raises(LifecycleError, match="human approval"):
        require_transition(ToolStatus.CANDIDATE, ToolStatus.VALIDATED, actor="agent")
    with pytest.raises(LifecycleError, match="human approval"):
        require_transition(ToolStatus.VALIDATED, ToolStatus.TRUSTED, actor="agent")


def test_human_can_promote_to_trusted():
    require_transition(ToolStatus.VALIDATED, ToolStatus.TRUSTED, actor="human")


def test_agent_can_demote_to_deprecated():
    """Deprecation does not require human approval."""
    require_transition(ToolStatus.CANDIDATE, ToolStatus.DEPRECATED, actor="agent")
