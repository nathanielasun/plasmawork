"""Phase 8 — Backend lifecycle.

Five states: ``planned → in_progress → validated → trusted →
deprecated``. Mirrors the Phase 7 module + Phase 3 tool registries
so reviewers learn one model. Lifecycle promotion gates LIVE AT the
``BackendRegistry.set_status`` mutation boundary (rule 18) — the
HTTP API/UI may not bypass them with a flag.
"""

from __future__ import annotations

from enum import StrEnum


class BackendStatus(StrEnum):
    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    VALIDATED = "validated"
    TRUSTED = "trusted"
    DEPRECATED = "deprecated"


ALLOWED_TRANSITIONS: dict[BackendStatus, frozenset[BackendStatus]] = {
    BackendStatus.PLANNED: frozenset(
        {BackendStatus.IN_PROGRESS, BackendStatus.DEPRECATED}
    ),
    BackendStatus.IN_PROGRESS: frozenset(
        {BackendStatus.PLANNED, BackendStatus.VALIDATED, BackendStatus.DEPRECATED}
    ),
    BackendStatus.VALIDATED: frozenset(
        {BackendStatus.IN_PROGRESS, BackendStatus.TRUSTED, BackendStatus.DEPRECATED}
    ),
    BackendStatus.TRUSTED: frozenset(
        {BackendStatus.VALIDATED, BackendStatus.DEPRECATED}
    ),
    BackendStatus.DEPRECATED: frozenset({BackendStatus.PLANNED}),
}


# Agents may move backends through planned / in_progress / deprecated;
# validated / trusted require human approval.
AGENT_ALLOWED: frozenset[BackendStatus] = frozenset(
    {BackendStatus.PLANNED, BackendStatus.IN_PROGRESS, BackendStatus.DEPRECATED}
)


class BackendLifecycleError(ValueError):
    """Illegal backend transition or unauthorized agent promotion."""


def can_transition(from_state: BackendStatus, to_state: BackendStatus) -> bool:
    return to_state in ALLOWED_TRANSITIONS.get(from_state, frozenset())


def require_backend_transition(
    from_state: BackendStatus,
    to_state: BackendStatus,
    *,
    actor: str = "agent",
) -> None:
    if not can_transition(from_state, to_state):
        raise BackendLifecycleError(
            f"Illegal backend lifecycle transition: "
            f"{from_state.value} → {to_state.value}. Allowed from "
            f"{from_state.value}: "
            f"{sorted(s.value for s in ALLOWED_TRANSITIONS[from_state])}."
        )
    if actor == "agent" and to_state not in AGENT_ALLOWED:
        raise BackendLifecycleError(
            f"Agent may not promote a backend to {to_state.value}; "
            "human approval required (plan §Phase 8 / 8A). The HTTP "
            "API consumes a single-use token written by "
            "simworkbench.backends.grant_backend_approval."
        )


__all__ = [
    "AGENT_ALLOWED",
    "ALLOWED_TRANSITIONS",
    "BackendLifecycleError",
    "BackendStatus",
    "can_transition",
    "require_backend_transition",
]
