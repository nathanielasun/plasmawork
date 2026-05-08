"""Phase 3 — Internal Tool SDK + Registry public API.

Imports::

    from simworkbench.tools import (
        BaseTool, ToolInput, ToolOutput,
        ToolMetadata, ToolStatus,
        ToolRegistry, RegisteredTool,
    )

This module is the canonical surface; ``simworkbench.tools`` (under
``packages/core/``) re-exports the same symbols so user-facing imports
match plan §9.4's ``from simworkbench.tools import BaseTool, ...``
example verbatim.
"""

from __future__ import annotations

from .approval import (
    ApprovalError,
    approval_path,
    approvals_root,
    consume_approval,
    grant_approval,
)
from .authoring import (
    ToolAuthoringError,
    ToolAuthoringNotFound,
    ToolAuthoringService,
)
from .base_tool import BaseTool
from .binding import ToolBindingError, apply_tools
from .io import ToolInput, ToolIOError, ToolOutput
from .lifecycle import (
    AGENT_ALLOWED,
    ALLOWED_TRANSITIONS,
    ORDER,
    LifecycleError,
    ToolStatus,
    can_transition,
    require_transition,
)
from .metadata import (
    ToolArtifactDeclaration,
    ToolArtifacts,
    ToolInputGroup,
    ToolIOContract,
    ToolMetadata,
    ToolOutputView,
    ToolPermissions,
    ToolPort,
    ToolRequires,
    ToolUI,
    ToolValidation,
    load_tool_yaml,
    write_tool_yaml,
)
from .registry import RegisteredTool, ToolRegistry, ToolRegistryError
from .run_manager import ToolPreview, ToolRun, ToolRunManager, ToolRunStatus
from .schema import (
    ToolSchemaError,
    artifact_for_output,
    normalize_tool_schema,
    planned_artifacts,
    validate_tool_run_request,
)

__all__ = [
    "AGENT_ALLOWED",
    "ALLOWED_TRANSITIONS",
    "ApprovalError",
    "BaseTool",
    "LifecycleError",
    "ORDER",
    "RegisteredTool",
    "ToolAuthoringError",
    "ToolAuthoringNotFound",
    "ToolAuthoringService",
    "ToolBindingError",
    "ToolArtifactDeclaration",
    "ToolArtifacts",
    "ToolIOContract",
    "ToolIOError",
    "ToolInputGroup",
    "ToolInput",
    "ToolMetadata",
    "ToolOutputView",
    "ToolOutput",
    "ToolPermissions",
    "ToolPort",
    "ToolPreview",
    "ToolRegistry",
    "ToolRegistryError",
    "ToolRequires",
    "ToolRun",
    "ToolRunManager",
    "ToolRunStatus",
    "ToolSchemaError",
    "ToolStatus",
    "ToolUI",
    "ToolValidation",
    "apply_tools",
    "artifact_for_output",
    "approval_path",
    "approvals_root",
    "can_transition",
    "consume_approval",
    "grant_approval",
    "load_tool_yaml",
    "normalize_tool_schema",
    "planned_artifacts",
    "require_transition",
    "validate_tool_run_request",
    "write_tool_yaml",
]
