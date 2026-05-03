"""Phase 6 — Sandboxed Agentic Code Generation.

Public API::

    from simworkbench.codegen import (
        CodeGenerator, CodeGenerationResult, CodeGenerationError,
        TestGenerator,
        ValidationRunner,
        SandboxViolation,
    )

The generator emits Python experiment code, configs, diagnostic stubs,
generated tests, and a README under ``<capsule>/src/generated/``. The
sandbox guards every write so ``user_edits/``, ``paper_sources/``, and
``provenance/`` stay untouched. The validation runner executes the
freshly-generated experiment and writes a per-capsule validation summary.

Plan §Phase 6 gate: "an agent can generate a runnable, reviewable,
editable, exportable simulation from a ModelSpec inside a capsule."
"""

from __future__ import annotations

from .generator import (
    CodeGenerationError,
    CodeGenerationResult,
    CodeGenerator,
)
from .sandbox import SandboxViolation, sandboxed_write
from .test_generation import TestGenerator
from .validation_run import ValidationRunner

__all__ = [
    "CodeGenerationError",
    "CodeGenerationResult",
    "CodeGenerator",
    "SandboxViolation",
    "TestGenerator",
    "ValidationRunner",
    "sandboxed_write",
]
