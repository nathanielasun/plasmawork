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
    ToolMetadata,
    ToolPort,
    ToolRequires,
    ToolValidation,
    load_tool_yaml,
    write_tool_yaml,
)
from .registry import RegisteredTool, ToolRegistry, ToolRegistryError

__all__ = [
    "AGENT_ALLOWED",
    "ALLOWED_TRANSITIONS",
    "ApprovalError",
    "BaseTool",
    "LifecycleError",
    "ORDER",
    "RegisteredTool",
    "ToolBindingError",
    "ToolIOError",
    "ToolInput",
    "ToolMetadata",
    "ToolOutput",
    "ToolPort",
    "ToolRegistry",
    "ToolRegistryError",
    "ToolRequires",
    "ToolStatus",
    "ToolValidation",
    "apply_tools",
    "approval_path",
    "approvals_root",
    "can_transition",
    "consume_approval",
    "grant_approval",
    "load_tool_yaml",
    "require_transition",
    "write_tool_yaml",
]
