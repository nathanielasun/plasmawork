"""Phase 3A — Tool lifecycle states.

Per plan §9.5 every internal tool moves through

    draft → candidate → validated → trusted → deprecated

with strict ordering: agents may produce ``draft`` and ``candidate`` tools
without human review; promotion to ``validated`` requires the tool's tests
+ benchmark cases to pass; promotion to ``trusted`` requires explicit
human approval and is the only state agents are allowed to use by default;
``deprecated`` is terminal.

The state machine is encoded here so registry / UI / agents share one
authoritative definition.
"""

from __future__ import annotations

from enum import StrEnum


class ToolStatus(StrEnum):
    """Lifecycle state. ``StrEnum`` so YAML/JSON serialization yields the
    bare token (e.g. ``"candidate"``) without an enum prefix.
    """

    DRAFT = "draft"
    CANDIDATE = "candidate"
    VALIDATED = "validated"
    TRUSTED = "trusted"
    DEPRECATED = "deprecated"


# Canonical forward order. Used by the registry's promotion logic and by
# the UI to render the lifecycle bar.
ORDER: tuple[ToolStatus, ...] = (
    ToolStatus.DRAFT,
    ToolStatus.CANDIDATE,
    ToolStatus.VALIDATED,
    ToolStatus.TRUSTED,
    ToolStatus.DEPRECATED,
)


# Allowed transitions: each state lists the states a tool may be moved to
# from there. Backward moves and skipping are rejected — promotion to
# ``trusted`` from ``candidate`` skips the ``validated`` step and is
# refused (a tool that hasn't passed validation cannot be trusted).
ALLOWED_TRANSITIONS: dict[ToolStatus, frozenset[ToolStatus]] = {
    ToolStatus.DRAFT: frozenset({ToolStatus.CANDIDATE, ToolStatus.DEPRECATED}),
    ToolStatus.CANDIDATE: frozenset({ToolStatus.VALIDATED, ToolStatus.DEPRECATED}),
    ToolStatus.VALIDATED: frozenset({ToolStatus.TRUSTED, ToolStatus.DEPRECATED}),
    ToolStatus.TRUSTED: frozenset({ToolStatus.DEPRECATED}),
    ToolStatus.DEPRECATED: frozenset(),
}


# States that an agent may set autonomously. Anything outside this set
# requires explicit human approval per plan §9.5.
AGENT_ALLOWED: frozenset[ToolStatus] = frozenset(
    {ToolStatus.DRAFT, ToolStatus.CANDIDATE, ToolStatus.DEPRECATED}
)


class LifecycleError(ValueError):
    """Raised on illegal transitions or unauthorized agent promotions."""


def can_transition(from_state: ToolStatus, to_state: ToolStatus) -> bool:
    """Return True if a tool may move from ``from_state`` to ``to_state``."""
    return to_state in ALLOWED_TRANSITIONS.get(from_state, frozenset())


def require_transition(
    from_state: ToolStatus,
    to_state: ToolStatus,
    *,
    actor: str = "agent",
) -> None:
    """Raise ``LifecycleError`` if the transition is not allowed.

    ``actor`` controls the human-approval gate: agents may not set
    ``trusted`` or ``validated`` (promotion to ``trusted`` requires human
    review per plan §9.5; promotion to ``validated`` requires test +
    benchmark approval which the registry does not auto-grant). Pass
    ``actor="human"`` only when a human reviewer has approved.
    """
    if not can_transition(from_state, to_state):
        raise LifecycleError(
            f"Illegal tool lifecycle transition: {from_state.value} → {to_state.value}. "
            f"Allowed from {from_state.value}: "
            f"{sorted(s.value for s in ALLOWED_TRANSITIONS[from_state])}."
        )
    if actor == "agent" and to_state not in AGENT_ALLOWED:
        raise LifecycleError(
            f"Agent may not promote a tool to {to_state.value}; "
            "human approval required (plan §9.5). Pass actor='human' "
            "from a reviewer-driven UI/CLI flow."
        )


__all__ = [
    "AGENT_ALLOWED",
    "ALLOWED_TRANSITIONS",
    "LifecycleError",
    "ORDER",
    "ToolStatus",
    "can_transition",
    "require_transition",
]
