"""Phase 8 — Solver-backend registry public API.

The registry walks ``configs/backends.yaml`` and exposes:

  - ``BackendRegistry`` — discovery, capability-aware ``recommend``,
    lifecycle ``set_status`` (gated at the mutation boundary).
  - ``BackendStatus`` — five-state lifecycle (planned / in_progress /
    validated / trusted / deprecated).
  - ``BackendMetadata`` — Pydantic-validated entry shape.
  - approval tokens for human-only promotions, mirroring Phase 7.
  - ``ExternalSimulatorAdapter`` — abstract base for Phase 8F.
"""

from __future__ import annotations

from .approval import (
    BackendApprovalError,
    backend_approval_path,
    backend_approvals_root,
    consume_backend_approval,
    grant_backend_approval,
)
from .external import ExternalSimulatorAdapter
from .lifecycle import (
    AGENT_ALLOWED,
    ALLOWED_TRANSITIONS,
    BackendLifecycleError,
    BackendStatus,
    can_transition,
    require_backend_transition,
)
from .metadata import (
    BackendDependencies,
    BackendMetadata,
    BackendSupports,
    load_backends_yaml,
)
from .registry import (
    BackendRegistry,
    BackendRegistryError,
    RegisteredBackend,
)

__all__ = [
    "AGENT_ALLOWED",
    "ALLOWED_TRANSITIONS",
    "BackendApprovalError",
    "BackendDependencies",
    "BackendLifecycleError",
    "BackendMetadata",
    "BackendRegistry",
    "BackendRegistryError",
    "BackendStatus",
    "BackendSupports",
    "ExternalSimulatorAdapter",
    "RegisteredBackend",
    "backend_approval_path",
    "backend_approvals_root",
    "can_transition",
    "consume_backend_approval",
    "grant_backend_approval",
    "load_backends_yaml",
    "require_backend_transition",
]
