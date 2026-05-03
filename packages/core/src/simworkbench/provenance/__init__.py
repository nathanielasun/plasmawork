"""Phase 2B — Provenance system.

Public API for the provenance writer set:

- ``ProvenanceLock`` + ``write_lock`` / ``load_lock`` (TOML).
- ``capture_environment`` + ``write_environment`` / ``load_environment``
  (YAML pip-freeze + platform snapshot).
- ``AgentTraceWriter`` — append-only ``agent_trace.md``; refuses writes
  targeting ``<capsule>/src/user_edits/`` per `agent_error_patterns.md`
  *Overwriting `<capsule>/src/user_edits/` during regeneration*.
- ``SourceRegistry`` — SHA-256 hashes of `model/`, `configs/`, `src/` for
  capsule identity (used as the parent_capsule_hash on forks).
"""

from __future__ import annotations

from .agent_trace import AgentTraceError, AgentTraceWriter, TraceEntry
from .environment import capture_environment, load_environment, write_environment
from .lock import ProvenanceLock, load_lock, write_lock
from .sources import DEFAULT_SUBTREES, FileHash, SourceRegistry

__all__ = [
    "DEFAULT_SUBTREES",
    "AgentTraceError",
    "AgentTraceWriter",
    "FileHash",
    "ProvenanceLock",
    "SourceRegistry",
    "TraceEntry",
    "capture_environment",
    "load_environment",
    "load_lock",
    "write_environment",
    "write_lock",
]
