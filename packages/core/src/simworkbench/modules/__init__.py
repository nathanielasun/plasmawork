"""Phase 7 — Validated Physics Module Registry.

Public API::

    from simworkbench.modules import (
        ModuleMetadata, ModuleStatus,
        ModuleRegistry, RegisteredModule, ModuleRegistryError,
        ModuleLifecycleError,
        load_module_yaml, write_module_yaml,
    )

Plan §Phase 7 / 7A: extends the Phase-1 ``module.yaml`` shape with
Registry v1 fields — dependencies, benchmarks, compatibility — and
adds a lifecycle (draft / candidate / validated / trusted / deprecated)
mirroring the Phase-3 tool registry.

Promotions to ``validated`` and ``trusted`` are human-only. The HTTP
API consumes a single-use approval token under
``<repo>/local_cache/module_approvals/`` (the analogue of Phase 6's
tool-approval flow). Carries
`agent_error_patterns.md` "Trusting a client-supplied actor identity
for a privileged check" forward into Phase 7.
"""

from __future__ import annotations

from .approval import (
    ModuleApprovalError,
    consume_module_approval,
    grant_module_approval,
    module_approval_path,
    module_approvals_root,
)
from .lifecycle import (
    AGENT_ALLOWED,
    ALLOWED_TRANSITIONS,
    ModuleLifecycleError,
    ModuleStatus,
    can_transition,
    require_module_transition,
)
from .metadata import (
    BenchmarkRef,
    Dependency,
    ModuleCompatibility,
    ModuleMetadata,
    load_module_yaml,
    write_module_yaml,
)
from .registry import (
    ModuleRegistry,
    ModuleRegistryError,
    RegisteredModule,
)

__all__ = [
    "AGENT_ALLOWED",
    "ALLOWED_TRANSITIONS",
    "BenchmarkRef",
    "Dependency",
    "ModuleApprovalError",
    "ModuleCompatibility",
    "ModuleLifecycleError",
    "ModuleMetadata",
    "ModuleRegistry",
    "ModuleRegistryError",
    "ModuleStatus",
    "RegisteredModule",
    "can_transition",
    "consume_module_approval",
    "grant_module_approval",
    "load_module_yaml",
    "module_approval_path",
    "module_approvals_root",
    "require_module_transition",
    "write_module_yaml",
]
