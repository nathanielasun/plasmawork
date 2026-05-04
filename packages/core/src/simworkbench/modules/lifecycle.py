"""Phase 7 — Module lifecycle (draft / candidate / validated / trusted /
deprecated). Mirrors the Phase-3 tool lifecycle so reviewers get one
mental model across the workbench.

Plan §Phase 7 / 7A bullet "Add module status lifecycle".
"""

from __future__ import annotations

from enum import StrEnum


class ModuleStatus(StrEnum):
    DRAFT = "draft"
    CANDIDATE = "candidate"
    VALIDATED = "validated"
    TRUSTED = "trusted"
    DEPRECATED = "deprecated"


ORDER: tuple[ModuleStatus, ...] = (
    ModuleStatus.DRAFT,
    ModuleStatus.CANDIDATE,
    ModuleStatus.VALIDATED,
    ModuleStatus.TRUSTED,
)


# Allowed transitions. Every module can be deprecated from any status.
ALLOWED_TRANSITIONS: dict[ModuleStatus, frozenset[ModuleStatus]] = {
    ModuleStatus.DRAFT: frozenset({ModuleStatus.CANDIDATE, ModuleStatus.DEPRECATED}),
    ModuleStatus.CANDIDATE: frozenset(
        {ModuleStatus.DRAFT, ModuleStatus.VALIDATED, ModuleStatus.DEPRECATED}
    ),
    ModuleStatus.VALIDATED: frozenset(
        {ModuleStatus.CANDIDATE, ModuleStatus.TRUSTED, ModuleStatus.DEPRECATED}
    ),
    ModuleStatus.TRUSTED: frozenset(
        {ModuleStatus.VALIDATED, ModuleStatus.DEPRECATED}
    ),
    ModuleStatus.DEPRECATED: frozenset({ModuleStatus.CANDIDATE}),
}


# Agent-allowed targets. Agents can move modules through draft / candidate /
# deprecated — promotions to validated / trusted are human-only and gated
# by a single-use approval token.
AGENT_ALLOWED: frozenset[ModuleStatus] = frozenset(
    {ModuleStatus.DRAFT, ModuleStatus.CANDIDATE, ModuleStatus.DEPRECATED}
)


class ModuleLifecycleError(ValueError):
    """Raised on illegal module transitions or agent-driven promotion."""


def can_transition(from_state: ModuleStatus, to_state: ModuleStatus) -> bool:
    return to_state in ALLOWED_TRANSITIONS.get(from_state, frozenset())


def require_module_transition(
    from_state: ModuleStatus,
    to_state: ModuleStatus,
    *,
    actor: str = "agent",
) -> None:
    if not can_transition(from_state, to_state):
        raise ModuleLifecycleError(
            f"Illegal module lifecycle transition: "
            f"{from_state.value} → {to_state.value}. Allowed from "
            f"{from_state.value}: "
            f"{sorted(s.value for s in ALLOWED_TRANSITIONS[from_state])}."
        )
    if to_state not in AGENT_ALLOWED and actor != "human":
        raise ModuleLifecycleError(
            f"Actor {actor!r} may not promote a module to {to_state.value}; "
            "human approval required (plan §Phase 7 / 7A). The HTTP "
            "API consumes a single-use token written by "
            "simworkbench.modules.grant_module_approval."
        )


__all__ = [
    "AGENT_ALLOWED",
    "ALLOWED_TRANSITIONS",
    "ModuleLifecycleError",
    "ModuleStatus",
    "ORDER",
    "can_transition",
    "require_module_transition",
]
